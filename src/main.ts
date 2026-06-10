import {
  Notice,
  Plugin,
  TAbstractFile,
  TFile,
  debounce,
  type CachedMetadata,
} from "obsidian";
import {
  resolveAttachments,
  uploadAttachments,
  type ResolvedAttachment,
} from "@/attachments";
import {
  BATCH_SIZE,
  DEBOUNCE_MS,
  DRAIN_INTERVAL_MS,
  TOKEN_REJECTED_NOTICE,
} from "@/constants";
import { sha256 } from "@/hash";
import { getJson, postJson, TokenRejectedError, type Auth } from "@/network";
import { registerInstallProtocolHandler } from "@/protocol";
import {
  ackBatch,
  emptyState,
  enqueue,
  failBatch,
  nextBatch,
  type QueueState,
} from "@/queue";
import {
  DEFAULT_SETTINGS,
  MyBrainSettingTab,
  type MyBrainSettings,
} from "@/settings";
import {
  API_VERSION,
  type IngestEvent,
  type IngestResponse,
  type UpsertEvent,
} from "@/types";
import { extractLinks } from "@/util";
import { ObsidianWebSocketManager } from "@/websocket";

type FileSnapshot = Omit<
  UpsertEvent,
  "op" | "wikilinks" | "mdLinks" | "attachments"
>;
type ManifestFile = Omit<UpsertEvent, "op" | "wikilinks" | "mdLinks">;

type ReadFile = {
  content: string;
  frontmatter: Record<string, unknown> | null;
  hash: string;
};

type StoredData = {
  settings: MyBrainSettings;
  queue: QueueState;
};

const WS_RESTART_DEBOUNCE_MS = 500;

export default class MyBrainPlugin extends Plugin {
  settings!: MyBrainSettings;
  private queue: QueueState = emptyState();
  private readonly resolvedAttachments = new Map<string, ResolvedAttachment>();
  private readonly pendingFlushTimers = new Map<string, number>();
  // Skip enqueueing an upsert whose content hash matches the last one we
  // already enqueued — Obsidian fires `modify` for autosave even when the
  // file is byte-identical to disk.
  private readonly lastEnqueuedHashes = new Map<string, string>();
  private draining = false;
  private tokenRejected = false;
  private unloaded = false;
  private readonly wsManager = new ObsidianWebSocketManager();

  private readonly debouncedWsRestart = debounce(
    () => this.doRestartWebSocket(),
    WS_RESTART_DEBOUNCE_MS,
    true,
  );

  async onload() {
    await this.loadAll();

    this.addSettingTab(new MyBrainSettingTab(this.app, this));
    registerInstallProtocolHandler(this);

    let dirty = false;

    if (!this.settings.vaultId) {
      this.settings.vaultId = crypto.randomUUID();
      dirty = true;
    }

    if (!this.settings.vaultName) {
      this.settings.vaultName = this.app.vault.getName();
      dirty = true;
    }

    if (dirty) await this.saveSettings();

    this.app.workspace.onLayoutReady(() => {
      this.registerVaultEvents();
      this.startWebSocket();

      if (this.canSync()) {
        if (this.settings.lastSyncAt) {
          void this.catchUpSinceLastSync();
        } else {
          void this.pushManifest({ initial: true });
        }
      }

      this.registerInterval(
        globalThis.setInterval(() => void this.drain(), DRAIN_INTERVAL_MS),
      );

      void this.drain();
    });
  }

  onunload() {
    this.unloaded = true;
    this.pendingFlushTimers.forEach((id) => globalThis.clearTimeout(id));
    this.pendingFlushTimers.clear();
    this.wsManager.stop();
    // Best-effort final persistence so events queued in the last second
    // aren't lost. `onunload` isn't awaited, but on a single-threaded loop
    // this still completes before the runtime tears down.
    void this.saveAll();
  }

  /** Public — called by the settings UI on endpoint/token edits. Debounced
   * so keystroke-by-keystroke editing doesn't open+close the socket per
   * character. */
  restartWebSocket(): void {
    this.debouncedWsRestart();
  }

  /** Public — called by `protocol.ts` when a deep-link installs new
   * settings. Encapsulates the assign + persist + reconnect so the protocol
   * handler doesn't poke private state. */
  async applyDeepLinkSettings(incoming: {
    token: string;
    endpoint: string | null;
    vaultId: string | null;
    vaultName: string | null;
  }): Promise<void> {
    this.settings.token = incoming.token;

    if (incoming.endpoint) this.settings.endpoint = incoming.endpoint;

    if (incoming.vaultId) this.settings.vaultId = incoming.vaultId;

    if (incoming.vaultName) this.settings.vaultName = incoming.vaultName;

    this.tokenRejected = false;

    await this.saveSettings();

    this.restartWebSocket();
  }

  private doRestartWebSocket(): void {
    this.wsManager.stop();
    this.startWebSocket();
  }

  private startWebSocket(): void {
    if (!this.canSync()) return;

    this.wsManager.start({
      endpoint: this.settings.endpoint,
      token: this.settings.token,
      onManifestRequest: async () => {
        await this.pushManifest({ initial: false });
      },
      onTokenRejected: () => {
        this.tokenRejected = true;
      },
    });
  }

  async loadAll(): Promise<void> {
    const data = ((await this.loadData()) as StoredData | null) ?? null;

    this.settings = { ...DEFAULT_SETTINGS, ...data?.settings };

    this.queue = data?.queue ?? emptyState();
  }

  async saveSettings(): Promise<void> {
    await this.saveAll();
  }

  async saveAll(): Promise<void> {
    const data: StoredData = { settings: this.settings, queue: this.queue };
    await this.saveData(data);
  }

  async testConnection(): Promise<string> {
    if (!this.canSync()) {
      return "endpoint or token not set";
    }

    try {
      const body = await getJson<{ status?: string }>(this.auth(), "/ping");

      this.tokenRejected = false;

      return body.status === "active"
        ? "token active"
        : "token pending — POST to activate";
    } catch (e) {
      if (e instanceof TokenRejectedError) return "token rejected";
      return e instanceof Error ? e.message : String(e);
    }
  }

  async initialScan(): Promise<boolean> {
    return await this.pushManifest({ initial: true });
  }

  async pushManifest({ initial }: { initial: boolean }): Promise<boolean> {
    if (!this.canSync()) {
      if (initial) new Notice("MyBrain: set endpoint and token first");
      return false;
    }

    const files = this.app.vault
      .getMarkdownFiles()
      .filter((f) => !this.isExcluded(f.path));

    if (initial) new Notice(`MyBrain: syncing ${files.length} notes...`);

    const manifest: ManifestFile[] = [];

    for (const file of files) {
      try {
        manifest.push(await this._buildManifestFile(file));
      } catch (e) {
        console.error("MyBrain: failed to read", file.path, e);
      }
    }

    try {
      const response = await postJson<IngestResponse>(
        this.auth(),
        "/manifest",
        {
          apiVersion: API_VERSION,
          vaultId: this.settings.vaultId,
          vaultName: this.settings.vaultName || this.app.vault.getName(),
          clientTime: new Date().toISOString(),
          files: manifest,
        },
      );

      this.tokenRejected = false;
      this.settings.lastSyncAt = Date.now();

      await this.saveAll();

      if (response.attachmentsNeeded.length > 0) {
        await this.uploadAttachmentsForBatch(response.attachmentsNeeded);
      }

      if (initial) new Notice(`MyBrain: synced ${manifest.length} notes`);
      return true;
    } catch (e) {
      if (e instanceof TokenRejectedError) {
        this.markTokenRejected();
        return false;
      }
      console.warn("MyBrain: manifest push failed", e);
      if (initial) new Notice("MyBrain: manifest push failed (see console)");
      return false;
    }
  }

  /** Walk the vault on startup for markdown files whose disk mtime is
   * newer than our last successful sync, and enqueue upserts for them.
   * Catches edits made while the plugin was off (git pull, mobile sync,
   * another vault session). */
  private async catchUpSinceLastSync(): Promise<void> {
    const since = this.settings.lastSyncAt;

    if (since === null) return;

    const stale = this.app.vault
      .getMarkdownFiles()
      .filter((f) => !this.isExcluded(f.path) && f.stat.mtime > since);

    if (stale.length === 0) return;

    for (const file of stale) {
      void this.enqueueUpsertEvent(file);
    }
  }

  private registerVaultEvents(): void {
    this.registerEvent(
      this.app.vault.on("create", (file) => this.handleUpsert(file)),
    );
    this.registerEvent(
      this.app.vault.on("modify", (file) => this.handleUpsert(file)),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => this.handleDelete(file)),
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) =>
        this.handleRename(file, oldPath),
      ),
    );
  }

  private handleUpsert(file: TAbstractFile): void {
    if (!this.isSyncableMarkdown(file)) return;
    this.scheduleFlush(file.path, () => this.enqueueUpsertEvent(file));
  }

  private handleDelete(file: TAbstractFile): void {
    if (!this.isSyncableMarkdown(file)) return;
    this.scheduleFlush(file.path, async () => {
      this.queue = enqueue(this.queue, { op: "delete", path: file.path });
      this.lastEnqueuedHashes.delete(file.path);
      void this.drain();
    });
  }

  private handleRename(file: TAbstractFile, oldPath: string): void {
    if (!(file instanceof TFile) || file.extension !== "md") return;

    if (this.isExcluded(file.path) && this.isExcluded(oldPath)) return;

    this.scheduleFlush(file.path, async () => {
      this.queue = enqueue(this.queue, {
        op: "rename",
        oldPath,
        newPath: file.path,
      });

      const carried = this.lastEnqueuedHashes.get(oldPath);

      this.lastEnqueuedHashes.delete(oldPath);

      if (carried !== undefined) {
        this.lastEnqueuedHashes.set(file.path, carried);
      }

      void this.drain();
    });
  }

  private isSyncableMarkdown(file: TAbstractFile): file is TFile {
    return (
      file instanceof TFile &&
      file.extension === "md" &&
      !this.isExcluded(file.path)
    );
  }

  private async enqueueUpsertEvent(file: TFile): Promise<void> {
    try {
      const event = await this.buildUpsertEvent(file);

      if (this.lastEnqueuedHashes.get(file.path) === event.hash) return;

      this.queue = enqueue(this.queue, event);
      this.lastEnqueuedHashes.set(file.path, event.hash);

      void this.drain();
    } catch (e) {
      console.error("MyBrain: failed to build upsert event", file.path, e);
    }
  }

  private async buildUpsertEvent(file: TFile): Promise<UpsertEvent> {
    const snapshot = await this.buildFileSnapshot(file);

    const cache = this.app.metadataCache.getFileCache(file);

    const resolved = await resolveAttachments(this.app, file);

    for (const r of resolved) {
      this.resolvedAttachments.set(r.ref.hash, r);
    }

    return {
      op: "upsert",
      ...snapshot,
      wikilinks: extractLinks(cache?.links),
      mdLinks: extractLinks(cache?.embeds),
      attachments: resolved.map((r) => r.ref),
    };
  }

  private async buildFileSnapshot(file: TFile): Promise<FileSnapshot> {
    const read = await this.readMarkdownFile(file);

    return {
      path: file.path,
      name: file.basename,
      ext: "md",
      content: read.content,
      frontmatter: read.frontmatter,
      mtime: file.stat.mtime,
      size: file.stat.size,
      hash: read.hash,
    };
  }

  private async _buildManifestFile(file: TFile): Promise<ManifestFile> {
    const snapshot = await this.buildFileSnapshot(file);

    const resolved = await resolveAttachments(this.app, file);

    for (const r of resolved) {
      this.resolvedAttachments.set(r.ref.hash, r);
    }

    return {
      ...snapshot,
      attachments: resolved.map((r) => r.ref),
    };
  }

  private async readMarkdownFile(file: TFile): Promise<ReadFile> {
    const content = await this.app.vault.cachedRead(file);

    const cache: CachedMetadata | null =
      this.app.metadataCache.getFileCache(file);

    const frontmatter = cache?.frontmatter
      ? Object.fromEntries(
          Object.entries(cache.frontmatter).filter(([k]) => k !== "position"),
        )
      : null;

    return { content, frontmatter, hash: await sha256(content) };
  }

  private scheduleFlush(key: string, fn: () => Promise<void>): void {
    const existing = this.pendingFlushTimers.get(key);

    if (existing) globalThis.clearTimeout(existing);

    const timer = globalThis.setTimeout(() => {
      this.pendingFlushTimers.delete(key);
      void fn();
    }, DEBOUNCE_MS);

    this.pendingFlushTimers.set(key, timer);
  }

  private async drain(): Promise<void> {
    if (this.draining || this.unloaded) return;

    if (!this.canSync() || this.tokenRejected) return;

    this.draining = true;

    try {
      while (!this.unloaded) {
        const now = Date.now();
        const batch = nextBatch(this.queue, BATCH_SIZE, now);

        if (batch.length === 0) return;

        const ok = await this.flush(batch);

        if (!ok) return;
      }
    } finally {
      this.draining = false;
    }
  }

  private async flush(batch: IngestEvent[]): Promise<boolean> {
    try {
      const response = await postJson<IngestResponse>(this.auth(), "/ingest", {
        apiVersion: API_VERSION,
        vaultId: this.settings.vaultId,
        vaultName: this.settings.vaultName || this.app.vault.getName(),
        clientTime: new Date().toISOString(),
        events: batch,
      });

      this.queue = ackBatch(this.queue, batch.length);

      // Persist only at the durability boundary: the server has now accepted
      // these events, so saving here is the meaningful checkpoint. Crashes
      // before this point are recovered via `catchUpSinceLastSync` on next
      // start using mtime > lastSyncAt.
      await this.saveAll();

      if (response.attachmentsNeeded.length > 0) {
        await this.uploadAttachmentsForBatch(response.attachmentsNeeded);
      }

      return true;
    } catch (e) {
      if (e instanceof TokenRejectedError) {
        this.markTokenRejected();
        return false;
      }

      console.warn("MyBrain: flush failed, will retry", e);
      this.queue = failBatch(this.queue, Date.now());

      await this.saveAll();

      return false;
    }
  }

  private async uploadAttachmentsForBatch(hashes: string[]): Promise<void> {
    try {
      const result = await uploadAttachments(
        this.app,
        this.auth(),
        this.settings.vaultId,
        this.resolvedAttachments,
        hashes,
        this.settings.syncAttachmentsOnMobile,
      );

      for (const hash of result.uploaded) {
        this.resolvedAttachments.delete(hash);
      }

      if (result.skipped.length > 0) {
        console.warn(`MyBrain: ${result.skipped.length} attachment(s) skipped`);
      }
    } catch (e) {
      if (e instanceof TokenRejectedError) {
        this.markTokenRejected();
        return;
      }
      console.warn("MyBrain: attachment upload failed", e);
    }
  }

  private markTokenRejected(): void {
    this.tokenRejected = true;
    new Notice(TOKEN_REJECTED_NOTICE);
  }

  private auth(): Auth {
    return { endpoint: this.settings.endpoint, token: this.settings.token };
  }

  private canSync(): boolean {
    return Boolean(this.settings.token && this.settings.endpoint);
  }

  private isExcluded(path: string): boolean {
    if (path.startsWith(`${this.app.vault.configDir}/`)) return true;
    return this.settings.excludeFolders.some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`),
    );
  }
}
