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
  ROOT_SCOPE_SENTINEL,
  TOKEN_REJECTED_NOTICE,
  UPDATE_CHECK_TICK_MS,
} from "@/constants";
import {
  buildContentBody,
  ContentRequestQueue,
  type ContentReadResult,
} from "@/content";
import { getOrCreateDeviceId } from "@/device";
import { sha256 } from "@/hash";
import {
  getJson,
  isProtocolRejection,
  postJson,
  TokenRejectedError,
  type Auth,
} from "@/network";
import {
  registerInstallProtocolHandler,
  registerOpenProtocolHandler,
} from "@/protocol";
import { enumerateVaultTree } from "@/scope";
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
import { materializeEvents, pushNegotiatedManifest } from "@/sync-protocol";
import {
  API_VERSION,
  PROTOCOL_VERSION,
  type ContentMissing,
  type ContentNote,
  type ContentResponse,
  type IngestEvent,
  type IngestResponse,
  type LatestPluginRelease,
  type ServerProtocol,
  type UpsertEvent,
  type UpsertEventV2,
} from "@/types";
import { checkForUpdates } from "@/update";
import { extractLinks } from "@/util";
import {
  collectManifestV2,
  readNoteContent,
  readNoteMetadata,
} from "@/vault-metadata";
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
  declare settings: MyBrainSettings;
  private queue: QueueState = emptyState();
  private readonly resolvedAttachments = new Map<string, ResolvedAttachment>();
  private readonly pendingFlushTimers = new Map<string, number>();
  // Skip enqueueing an upsert whose content hash matches the last one we
  // already enqueued — Obsidian fires `modify` for autosave even when the
  // file is byte-identical to disk.
  private readonly lastEnqueuedHashes = new Map<string, string>();
  // Identifies this plugin install to the backend (header on every request).
  // Self-generated per machine and kept in device-local storage — never in
  // `data.json`, which syncs with the vault — so each machine running this
  // vault reports its own installed version.
  private deviceId = "";
  private draining = false;
  private tokenRejected = false;
  private unloaded = false;
  // Number of full-vault syncs (`pushManifest`) in flight. A counter, not a
  // flag, so overlapping pushes (e.g. a deep-link sync plus a server-requested
  // one) don't flip the UI back to idle while another is still running.
  private syncActiveCount = 0;
  private readonly syncListeners = new Set<() => void>();
  private readonly wsManager = new ObsidianWebSocketManager();
  // Notes the server asked for (`content_requested`): the only path by which
  // note text leaves the vault under protocol 2.
  private readonly contentQueue = new ContentRequestQueue<ResolvedAttachment>({
    read: (path) => this.readRequestedNote(path),
    send: (notes, missing) => this.postContent(notes, missing),
    uploadAttachments: async (hashes, resolved) => {
      for (const r of resolved) this.resolvedAttachments.set(r.ref.hash, r);
      await this.uploadAttachmentsForBatch(hashes);
    },
    onTokenRejected: () => this.markTokenRejected(),
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (id) => window.clearTimeout(id),
  });

  private readonly debouncedWsRestart = debounce(
    () => this.doRestartWebSocket(),
    WS_RESTART_DEBOUNCE_MS,
    true,
  );

  async onload() {
    await this.loadAll();

    this.deviceId = getOrCreateDeviceId(this.app);

    this.addSettingTab(new MyBrainSettingTab(this.app, this));
    registerInstallProtocolHandler(this);
    registerOpenProtocolHandler(this);

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
        window.setInterval(() => void this.drain(), DRAIN_INTERVAL_MS),
      );

      void this.drain();

      this.registerInterval(
        window.setInterval(
          () => void checkForUpdates(this, { manual: false }),
          UPDATE_CHECK_TICK_MS,
        ),
      );

      void checkForUpdates(this, { manual: false });
    });
  }

  onunload() {
    this.unloaded = true;
    this.pendingFlushTimers.forEach((id) => window.clearTimeout(id));
    this.pendingFlushTimers.clear();
    this.contentQueue.stop();
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

  /** Whether a full-vault sync is currently uploading. */
  isSyncing(): boolean {
    return this.syncActiveCount > 0;
  }

  /** Subscribe to sync start/stop so the settings UI can reflect it live.
   * Returns an unsubscribe function. */
  onSyncStateChange(listener: () => void): () => void {
    this.syncListeners.add(listener);
    return () => this.syncListeners.delete(listener);
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

    // A deep link (re)configures the connection, so start syncing right away
    // instead of waiting for a server manifest_request or the next reload.
    if (this.canSync()) {
      void this.pushManifest({ initial: true });
    }
  }

  /** Latest published plugin release from the MyBrain backend (which caches
   * it from GitHub server-side). Null when the lookup fails or the release is
   * unknown. The authenticated request also reports this install's version to
   * the backend via the standard headers. */
  async fetchLatestPluginRelease(): Promise<LatestPluginRelease | null> {
    try {
      return (
        (await getJson<LatestPluginRelease | null>(
          this.auth(),
          "/latest-release",
        )) ?? null
      );
    } catch {
      return null;
    }
  }

  /** Whether the plugin is configured to talk to a MyBrain endpoint. */
  canSync(): boolean {
    return Boolean(this.settings.token && this.settings.endpoint);
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
      onScopeChanged: async (folders) => {
        this.settings.inScopeFolders = folders;
        await this.saveSettings();
        await this.pushManifest({ initial: false });
      },
      onTokenRejected: () => {
        this.tokenRejected = true;
      },
      onContentRequested: (requestId, paths) => {
        this.contentQueue.request(requestId, paths);
      },
      // Tells the server this install speaks protocol 2; on (re)connect the
      // server answers with the content requests still open.
      onOpen: () => {
        this.wsManager.send({
          type: "hello",
          protocol: PROTOCOL_VERSION,
          pluginVersion: this.manifest.version,
        });
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

  /** Full sync of the notes in scope. Tries protocol 2 (metadata only) and,
   * when `fallbackToV1` is set, falls back to the protocol 1 manifest (with
   * note text) for a server that predates protocol 2. Without the fallback it
   * only finds out which protocol the server speaks. */
  async pushManifest({
    initial,
    fallbackToV1 = true,
  }: {
    initial: boolean;
    fallbackToV1?: boolean;
  }): Promise<boolean> {
    if (!this.canSync()) {
      if (initial) new Notice("MyBrain: set endpoint and token first");
      return false;
    }

    this._beginSync();

    try {
      return await this._runFullSync(initial, fallbackToV1);
    } finally {
      this._endSync();
    }
  }

  private async _runFullSync(
    initial: boolean,
    fallbackToV1: boolean,
  ): Promise<boolean> {
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((f) => this.isInScope(f.path));

    if (initial) new Notice(`MyBrain: syncing ${files.length} notes...`);

    let sentCount = 0;

    try {
      const outcome = await pushNegotiatedManifest({
        sendV2: async () => {
          sentCount = await this._postManifestV2(files);
        },
        sendV1: async () => {
          sentCount = await this._postManifestV1(files);
        },
        fallbackToV1,
        log: (message) => console.warn(message),
      });

      this.tokenRejected = false;
      this.settings.serverProtocol = outcome.protocol;

      if (outcome.sent) this.settings.lastSyncAt = Date.now();

      await this.saveAll();

      if (initial) new Notice(`MyBrain: synced ${sentCount} notes`);

      return outcome.sent;
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

  /** Protocol 2 manifest: metadata of every note in scope, no text. */
  private async _postManifestV2(files: TFile[]): Promise<number> {
    const body = await collectManifestV2(this.app, files, {
      vaultId: this.settings.vaultId,
      vaultName: this.settings.vaultName || this.app.vault.getName(),
      clientTime: new Date().toISOString(),
      pluginVersion: this.manifest.version,
    });

    // Attachments go up only with the text of a note that embeds them, when
    // the server asks for that note.
    await postJson<unknown>(this.auth(), "/manifest", body);

    return body.files.length;
  }

  /** Protocol 1 manifest (plugin 1.0.x behaviour): every note with its text. */
  private async _postManifestV1(files: TFile[]): Promise<number> {
    const manifest: ManifestFile[] = [];

    for (const file of files) {
      try {
        manifest.push(await this._buildManifestFile(file));
      } catch (e) {
        console.error("MyBrain: failed to read", file.path, e);
      }
    }

    const response = await postJson<IngestResponse | undefined>(
      this.auth(),
      "/manifest",
      {
        apiVersion: API_VERSION,
        vaultId: this.settings.vaultId,
        vaultName: this.settings.vaultName || this.app.vault.getName(),
        clientTime: new Date().toISOString(),
        files: manifest,
        folders: enumerateVaultTree(this.app),
      },
    );

    const attachmentsNeeded = response?.attachmentsNeeded ?? [];

    if (attachmentsNeeded.length > 0) {
      await this.uploadAttachmentsForBatch(attachmentsNeeded);
    }

    return manifest.length;
  }

  /** The protocol the server speaks, found out with a metadata-only manifest
   * push when not known yet (first run after updating from 1.0.x). */
  private async ensureServerProtocol(): Promise<ServerProtocol> {
    if (this.settings.serverProtocol) return this.settings.serverProtocol;

    await this.pushManifest({ initial: false, fallbackToV1: false });

    if (!this.settings.serverProtocol) {
      throw new Error("MyBrain: could not determine the server protocol");
    }

    return this.settings.serverProtocol;
  }

  private _beginSync(): void {
    this.syncActiveCount += 1;

    if (this.syncActiveCount === 1) this._notifySyncStateChange();
  }

  private _endSync(): void {
    this.syncActiveCount = Math.max(0, this.syncActiveCount - 1);

    if (this.syncActiveCount === 0) this._notifySyncStateChange();
  }

  private _notifySyncStateChange(): void {
    for (const listener of this.syncListeners) {
      try {
        listener();
      } catch (e) {
        console.warn("MyBrain: sync-state listener failed", e);
      }
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
      .filter((f) => this.isInScope(f.path) && f.stat.mtime > since);

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

    if (!this.isInScope(file.path) && !this.isInScope(oldPath)) return;

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

  private isSyncableMarkdown(file: TAbstractFile | null): file is TFile {
    return (
      file instanceof TFile &&
      file.extension === "md" &&
      this.isInScope(file.path)
    );
  }

  private async enqueueUpsertEvent(file: TFile): Promise<void> {
    // Re-check scope at flush time: a scope change can land while this file
    // sits in the debounce window, and we must not enqueue a note the new
    // scope excludes.
    if (!this.isInScope(file.path)) return;

    try {
      const event = await this.buildUpsertEventV2(file);

      if (this.lastEnqueuedHashes.get(file.path) === event.hash) return;

      this.queue = enqueue(this.queue, event);
      this.lastEnqueuedHashes.set(file.path, event.hash);

      void this.drain();
    } catch (e) {
      console.error("MyBrain: failed to build upsert event", file.path, e);
    }
  }

  private async buildUpsertEventV2(file: TFile): Promise<UpsertEventV2> {
    const { metadata } = await readNoteMetadata(this.app, file);

    return { op: "upsert", ...metadata };
  }

  private async buildUpsertEventV1(file: TFile): Promise<UpsertEvent> {
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

  /** A queued note rebuilt as it is now, or null when it's gone or out of
   * scope (its delete or rename event is already queued). */
  private async rebuildUpsert<T>(
    path: string,
    build: (file: TFile) => Promise<T>,
  ): Promise<T | null> {
    const file = this.app.vault.getAbstractFileByPath(path);

    if (!this.isSyncableMarkdown(file)) return null;

    return await build(file);
  }

  private async readRequestedNote(
    path: string,
  ): Promise<ContentReadResult<ResolvedAttachment>> {
    const file = this.app.vault.getAbstractFileByPath(path);

    if (!(file instanceof TFile) || file.extension !== "md") {
      return { kind: "missing", reason: "not_found" };
    }

    // Never send the text of a note outside the folders the user chose, even
    // when the server asks for it.
    if (!this.isInScope(file.path)) {
      return { kind: "missing", reason: "out_of_scope" };
    }

    const read = await readNoteContent(this.app, file);

    return { kind: "note", note: read.note, resolved: read.resolved };
  }

  private async postContent(
    notes: ContentNote[],
    missing: ContentMissing[],
  ): Promise<ContentResponse | undefined> {
    return await postJson<ContentResponse | undefined>(
      this.auth(),
      "/content",
      buildContentBody(
        {
          vaultId: this.settings.vaultId,
          vaultName: this.settings.vaultName || this.app.vault.getName(),
          clientTime: new Date().toISOString(),
        },
        notes,
        missing,
      ),
    );
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

    if (existing) {
      window.clearTimeout(existing);
    }

    const timer = window.setTimeout(() => {
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
      const protocol = await this.ensureServerProtocol();

      let response: IngestResponse | undefined;

      try {
        response = await this.postIngest(batch, protocol);
      } catch (e) {
        // The server went back to a version without protocol 2.
        if (protocol !== 2 || !isProtocolRejection(e)) throw e;

        console.warn("MyBrain: server refused protocol 2 events, using protocol 1");
        this.settings.serverProtocol = 1;
        response = await this.postIngest(batch, 1);
      }

      this.queue = ackBatch(this.queue, batch.length);

      // Persist only at the durability boundary: the server has now accepted
      // these events, so saving here is the meaningful checkpoint. Crashes
      // before this point are recovered via `catchUpSinceLastSync` on next
      // start using mtime > lastSyncAt.
      await this.saveAll();

      const attachmentsNeeded = response?.attachmentsNeeded ?? [];

      if (attachmentsNeeded.length > 0) {
        await this.uploadAttachmentsForBatch(attachmentsNeeded);
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

  private async postIngest(
    batch: IngestEvent[],
    protocol: ServerProtocol,
  ): Promise<IngestResponse | undefined> {
    const events = await materializeEvents(batch, protocol, {
      v1: (path) => this.rebuildUpsert(path, (f) => this.buildUpsertEventV1(f)),
      v2: (path) => this.rebuildUpsert(path, (f) => this.buildUpsertEventV2(f)),
    });

    if (events.length === 0) return undefined;

    return await postJson<IngestResponse>(this.auth(), "/ingest", {
      ...(protocol === 2 ? { protocol: 2 } : {}),
      apiVersion: API_VERSION,
      vaultId: this.settings.vaultId,
      vaultName: this.settings.vaultName || this.app.vault.getName(),
      clientTime: new Date().toISOString(),
      events,
    });
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
    return {
      endpoint: this.settings.endpoint,
      token: this.settings.token,
      deviceId: this.deviceId,
      pluginVersion: this.manifest.version,
    };
  }

  private isInScope(path: string): boolean {
    if (path.startsWith(`${this.app.vault.configDir}/`)) return false;

    const scope = this.settings.inScopeFolders;

    if (scope.length === 0) return true;

    return scope.some((prefix) => {
      // The root sentinel matches files directly in the vault root (no folder
      // segment); any other entry is a folder prefix.
      if (prefix === ROOT_SCOPE_SENTINEL) return !path.includes("/");

      return path === prefix || path.startsWith(`${prefix}/`);
    });
  }
}
