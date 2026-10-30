import { createHash } from "node:crypto";

import type {
  AttachmentUploader,
  ConfigReader,
  DeviceStore,
  FailedUploadRecorder,
  MyBrainApi,
  Notifier,
  PluginDataPort,
  SyncDeps,
  Timers,
  UpdatePrompt,
  UploadFailurePrompt,
  VaultPort,
} from "@/core/ports";
import { emptyState } from "@/core/sync/queue";
import { defaultSettings } from "@/core/sync/settings";
import type {
  AttachmentRef,
  BinaryFile,
  ContentBody,
  FileStat,
  FolderNode,
  IngestResponse,
  MyBrainSettings,
  NoteSnapshot,
  NoteStamp,
  PingReply,
  ResolvedAttachment,
  StoredData,
  UploadFailure,
  UploadResult,
} from "@/core/sync/types";
import type { LatestPluginRelease } from "@/core/update/types";

import type {
  ApiCall,
  Deferred,
  FakeNote,
  HeldTimer,
  Responder,
  ShownPrompt,
  SyncHarness,
} from "@test/support/types";

/** A file handle as the vault adapter hands one out: change `name`/`path` for
 * a rename, `size`/`mtime` for an edit, set `gone` for a delete. */
export class FakeBinaryFile implements BinaryFile {
  gone = false;
  reads = 0;
  size = 3;
  mtime = 1;

  constructor(
    public name: string,
    private readonly _bytes = new Uint8Array([1, 2, 3]),
    public path = name,
  ) {}

  /** The size and mtime, or null once gone. */
  stat(): FileStat | null {
    return this.gone ? null : { size: this.size, mtime: this.mtime };
  }

  /** A fresh copy of the bytes; throws once the file is gone. */
  async readBinary(): Promise<ArrayBuffer> {
    this.reads += 1;

    if (this.gone) throw new Error("ENOENT: file is gone");

    return this._bytes.slice().buffer;
  }
}

/** A ref with a handle to a fake file at its path, matching its size and
 * mtime. */
export function resolved(ref: AttachmentRef): ResolvedAttachment {
  const file = new FakeBinaryFile(_nameOf(ref.path), undefined, ref.path);

  file.size = ref.size;
  file.mtime = ref.mtime;

  return { ref, file };
}

/** A vault of plain snapshots; `unreadable` paths throw on read. `binaries`
 * holds the files that are not notes, by path. */
export class FakeVault implements VaultPort {
  readonly notes = new Map<string, NoteSnapshot>();
  readonly binaries = new Map<string, FakeBinaryFile>();
  readonly unreadable = new Set<string>();
  readonly reads: string[] = [];

  constructor(notes: FakeNote[] = []) {
    for (const note of notes) this.put(note);
  }

  /** Add or replace a note, hashing its text the way the real adapter does. */
  put({ path, content, mtime = 1, attachments = [] }: FakeNote): void {
    this.notes.set(path, {
      path,
      basename: _nameOf(path).replace(/\.md$/, ""),
      ctime: 1,
      mtime,
      size: new TextEncoder().encode(content).byteLength,
      content,
      hash: createHash("sha256").update(content).digest("hex"),
      frontmatter: null,
      frontmatterEnd: null,
      tags: [],
      resolvedLinks: {},
      unresolvedLinks: {},
      wikilinks: [],
      mdLinks: [],
      embeds: attachments.map((a) => a.path),
      attachments: attachments.map(resolved),
    });
  }

  /** Drop a note, as a delete in the vault would. */
  remove(path: string): void {
    this.notes.delete(path);
  }

  /** A fixed vault name. */
  vaultName(): string {
    return "Fake vault";
  }

  /** The default config folder. */
  configDir(): string {
    return ".obsidian";
  }

  /** No core plugin is on, so every native note setting is unknown. */
  configReader(): ConfigReader {
    return { exists: async () => true, read: async () => "[]" };
  }

  /** Every note with its modification time. */
  markdownPaths(): NoteStamp[] {
    return Array.from(this.notes.values()).map((n) => ({
      path: n.path,
      mtime: n.mtime,
    }));
  }

  /** The path itself when it is a note of this vault, else null. */
  notePath(path: string): string | null {
    return this.notes.has(path) ? path : null;
  }

  /** The note's hash; throws when it can't be read. */
  async contentHash(path: string): Promise<string> {
    return this._readable(path).hash;
  }

  /** The note, recording the read; throws when it can't be read. */
  async read(path: string): Promise<NoteSnapshot> {
    this.reads.push(path);

    return this._readable(path);
  }

  /** Each note that can be read; the rest are left out. */
  async readMany(paths: readonly string[]): Promise<NoteSnapshot[]> {
    const out: NoteSnapshot[] = [];

    for (const path of paths) {
      try {
        out.push(await this.read(path));
      } catch {
        // Left out, as the real adapter does.
      }
    }

    return out;
  }

  /** No folders. */
  folderTree(): FolderNode[] {
    return [];
  }

  /** The file in `binaries` at the path, or null. */
  binaryFile(path: string): FakeBinaryFile | null {
    return this.binaries.get(path) ?? null;
  }

  private _readable(path: string): NoteSnapshot {
    const note = this.notes.get(path);

    if (!note || this.unreadable.has(path)) throw new Error("unreadable");

    return note;
  }
}

/** Records every call with a copy of its body, and answers through
 * `respond` (every upsert accepted by default). */
export class FakeApi implements MyBrainApi {
  readonly calls: ApiCall[] = [];
  latest: LatestPluginRelease | null = null;
  latestError: Error | undefined = undefined;
  latestCalls = 0;
  respond: Responder = () => ({
    accepted: 1,
    rejected: [],
    attachmentsNeeded: [],
  });

  /** The paths called so far, in order. */
  paths(): string[] {
    return this.calls.map((c) => c.path);
  }

  /** Records `/manifest`. */
  async postManifest(body: unknown): Promise<IngestResponse | undefined> {
    return await this._call("/manifest", body);
  }

  /** Records `/ingest`. */
  async postIngest(body: unknown): Promise<IngestResponse | undefined> {
    return await this._call("/ingest", body);
  }

  /** Records `/content`. */
  async postContent(body: ContentBody): Promise<IngestResponse | undefined> {
    return await this._call("/content", body);
  }

  /** Records `/attachments` with its fields. */
  async uploadAttachment(fields: Record<string, string>): Promise<void> {
    await this._call("/attachments", fields);
  }

  /** Records `/ping`; the token is always active. */
  async ping(): Promise<PingReply | undefined> {
    await this._call("/ping", {});

    return { status: "active" };
  }

  /** Counts the call and answers with `latest`. */
  async latestRelease(): Promise<LatestPluginRelease | null> {
    this.latestCalls++;

    if (this.latestError !== undefined) throw this.latestError;

    return this.latest;
  }

  private async _call(
    path: string,
    body: unknown,
  ): Promise<IngestResponse | undefined> {
    const call = { path, body: structuredClone(body) as ApiCall["body"] };

    this.calls.push(call);

    return await this.respond(call);
  }
}

/** Uploads the remembered hashes, failing those in `failWith`; `enabled` acts
 * out the mobile setting. */
export class FakeUploader implements AttachmentUploader {
  readonly remembered = new Map<string, ResolvedAttachment>();
  readonly uploads: string[][] = [];
  readonly sent: ResolvedAttachment[] = [];
  readonly failWith = new Map<string, unknown>();
  enabled = true;

  /** Keep the attachments by hash. */
  remember(resolved: readonly ResolvedAttachment[]): void {
    for (const r of resolved) this.remembered.set(r.ref.hash, r);
  }

  /** Remembered hashes are uploaded or fail, the others skipped. */
  async upload(hashes: readonly string[]): Promise<UploadResult> {
    this.uploads.push([...hashes]);

    const result: UploadResult = { uploaded: [], skipped: [], failed: [] };

    for (const hash of hashes) {
      const r = this.remembered.get(hash);

      if (!r) result.skipped.push(hash);
      else if (this.failWith.has(hash)) {
        result.failed.push({ resolved: r, error: this.failWith.get(hash) });
      } else result.uploaded.push(hash);
    }

    return result;
  }

  /** Whether uploads run on this device. */
  canUpload(): boolean {
    return this.enabled;
  }

  /** Record the upload, or throw `failWith` for its hash. */
  async send(resolved: ResolvedAttachment): Promise<void> {
    this.sent.push(resolved);

    if (this.failWith.has(resolved.ref.hash)) {
      throw this.failWith.get(resolved.ref.hash);
    }
  }
}

/** Keeps every batch of failed uploads it is given. */
export class FakeFailedUploads implements FailedUploadRecorder {
  readonly recorded: UploadFailure[][] = [];

  /** Keep the batch. */
  record(failures: readonly UploadFailure[]): void {
    this.recorded.push([...failures]);
  }
}

/** Records what the upload-failure notice would show. `open` is whether it is
 * on screen; `retry` is the last Retry callback. */
export class FakeUploadPrompt implements UploadFailurePrompt {
  readonly shown: number[] = [];
  open = false;
  count = 0;
  retry: (() => void) | undefined;

  /** Open it, or update the count when open. */
  show(count: number, onRetry: () => void): void {
    this.count = count;
    this.retry = onRetry;

    if (this.open) return;

    this.open = true;
    this.shown.push(count);
  }

  /** Update the count when open. */
  update(count: number): void {
    if (this.open) this.count = count;
  }

  /** Take it off screen. */
  close(): void {
    this.open = false;
  }
}

/** Keeps every notice, in order. */
export class FakeNotifier implements Notifier {
  readonly messages: string[] = [];

  /** Record the message. */
  notice(message: string): void {
    this.messages.push(message);
  }
}

/** Timers that fire only when the test says so. `delays` and `cleared` keep
 * every call, fired or not. */
export class FakeTimers implements Timers {
  readonly pending = new Map<number, HeldTimer>();
  readonly delays: number[] = [];
  readonly cleared: number[] = [];
  private _nextId = 1;

  /** Queue `fn` until `fireAll`. */
  set(fn: () => void, ms: number): number {
    const id = this._nextId++;

    this.pending.set(id, { fn, ms });
    this.delays.push(ms);

    return id;
  }

  /** Drop a pending timer. */
  clear(id: number): void {
    this.pending.delete(id);
    this.cleared.push(id);
  }

  /** Fire every pending timer once; timers they set wait for the next call. */
  fireAll(): void {
    const due = Array.from(this.pending.entries());

    this.pending.clear();

    for (const [, timer] of due) timer.fn();
  }
}

/** Records each prompt shown and keeps the last skip callback. */
export class FakePrompt implements UpdatePrompt {
  readonly shown: ShownPrompt[] = [];
  skip: (() => void) | undefined;

  /** Record the prompt instead of showing it. */
  show(
    installed: string,
    release: LatestPluginRelease,
    onSkip: () => void,
  ): void {
    this.shown.push({ installed, release });
    this.skip = onSkip;
  }
}

/** Device storage in a map. */
export class MemoryDeviceStore implements DeviceStore {
  readonly values: Map<string, string>;

  constructor(initial: Record<string, string> = {}) {
    this.values = new Map(Object.entries(initial));
  }

  /** The stored value, or null. */
  load(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  /** Store a value. */
  save(key: string, value: string): void {
    this.values.set(key, value);
  }
}

/** `data.json` in memory; `saved` keeps a copy of every save. */
export class FakePluginData implements PluginDataPort {
  readonly saved: StoredData[] = [];

  constructor(private _data: StoredData = initialData()) {}

  /** The last saved data, or the initial data. */
  async load(): Promise<StoredData> {
    return this._data;
  }

  /** Keep the data and a copy of it. */
  async save(data: StoredData): Promise<void> {
    this._data = data;
    this.saved.push(structuredClone(data));
  }
}

/** Default settings with the given overrides, and an empty queue. */
export function initialData(
  settings: Partial<MyBrainSettings> = {},
): StoredData {
  return {
    settings: { ...defaultSettings(), ...settings },
    queue: emptyState(),
  };
}

export const CONNECTED: Partial<MyBrainSettings> = {
  endpoint: "https://api.test",
  token: "test-token",
  vaultId: "vault-1",
  vaultName: "Vault",
};

/** Sync deps over fresh fakes, connected unless `settings` says otherwise. */
export function syncHarness(
  notes: FakeNote[],
  settings: Partial<MyBrainSettings> = {},
): SyncHarness {
  const vault = new FakeVault(notes);
  const api = new FakeApi();
  const uploader = new FakeUploader();
  const failedUploads = new FakeFailedUploads();
  const notifier = new FakeNotifier();
  const timers = new FakeTimers();
  const live: MyBrainSettings = {
    ...defaultSettings(),
    ...CONNECTED,
    ...settings,
  };
  const now = { value: 1_000_000 };
  let saves = 0;

  const deps: SyncDeps = {
    vault,
    api,
    attachments: uploader,
    failedUploads,
    notifier,
    timers,
    clock: () => now.value,
    settings: () => live,
    save: async () => {
      saves += 1;
    },
    pluginVersion: "1.1.0",
    auth: { rejected: false },
  };

  return {
    deps,
    vault,
    api,
    uploader,
    failedUploads,
    notifier,
    timers,
    settings: live,
    saves: () => saves,
    now,
  };
}

/** Let fire-and-forget work (drains, reads, hashing) run to the end. */
export async function settle(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** A promise with its resolve, to hold work in flight until the test lets
 * it go. */
export function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });

  return { promise, resolve };
}

function _nameOf(path: string): string {
  return path.split("/").pop() ?? path;
}
