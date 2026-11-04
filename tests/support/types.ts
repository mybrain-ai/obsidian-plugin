import type { App, TFile as AppFile } from "obsidian";

import type { AttachmentFile, SyncDeps } from "@/core/ports";
import type { EditSync } from "@/core/sync/edit-sync";
import type {
  AttachmentRef,
  ContentMissing,
  ContentNote,
  IngestResponse,
  MyBrainSettings,
  StoredData,
} from "@/core/sync/types";
import type { LatestPluginRelease } from "@/core/update/types";

import type {
  FakeApi,
  FakeFailedUploads,
  FakeNotifier,
  FakeTimers,
  FakeUploader,
  FakeVault,
} from "@test/support/fakes";

/** A note for the fake vault; only the path and text are required. */
export type FakeNote = {
  path: string;
  content: string;
  mtime?: number;
  attachments?: AttachmentRef[];
};

/** One call the fake API received, with a copy of its body. */
export type ApiCall = { path: string; body: Record<string, unknown> };

/** How the fake API answers a call; it may throw to act out a failure. */
export type Responder = (
  call: ApiCall,
) => Promise<IngestResponse | undefined> | IngestResponse | undefined;

/** The sync deps over the fakes, with the fakes themselves for assertions. */
export type SyncHarness = {
  deps: SyncDeps;
  vault: FakeVault;
  api: FakeApi;
  uploader: FakeUploader;
  failedUploads: FakeFailedUploads;
  notifier: FakeNotifier;
  timers: FakeTimers;
  settings: MyBrainSettings;
  saves: () => number;
  now: { value: number };
};

/** A note of the in-memory Obsidian vault, with the metadata Obsidian would
 * have parsed from it. */
export type NoteSpec = {
  path: string;
  content: string;
  ctime: number;
  mtime: number;
  frontmatter?: Record<string, unknown>;
  bodyTags?: string[];
  embeds?: string[];
  resolvedLinks?: Record<string, number>;
  unresolvedLinks?: Record<string, number>;
};

/** A non-note file of the in-memory vault. */
export type BinarySpec = {
  path: string;
  bytes: Uint8Array;
  ctime: number;
  mtime: number;
};

/** Everything the in-memory vault starts with. */
export type VaultSpec = {
  notes: NoteSpec[];
  binaries?: BinarySpec[];
  folders?: string[];
  config?: Record<string, string>;
};

/** The in-memory vault as an Obsidian `App`, plus controls to change it. */
export type TestVault = {
  app: App;
  file(path: string): AppFile;
  markdownFiles(): AppFile[];
  edit(path: string, content: string, mtime: number): void;
  remove(path: string): void;
  /** Moves the file the way Obsidian does: the same TFile, a new path. */
  rename(path: string, newPath: string): void;
  /** Calls the handlers registered with `vault.on(name, ...)`. */
  emit(name: string, ...args: unknown[]): void;
};

/** A request as the `requestUrl` stub receives it. */
export type FakeRequest = {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string | ArrayBuffer;
  throw?: boolean;
};

/** What the fake server answers; `json` undefined means an empty body. */
export type FakeResponse = { status: number; json?: unknown };

/** Stands in for the network behind the `requestUrl` stub. */
export type FakeServer = (
  request: FakeRequest,
) => FakeResponse | Promise<FakeResponse>;

/** How a test's fake server answers one request, by path and parsed body. */
export type ServerResponder = (
  path: string,
  body: Record<string, unknown>,
) => FakeResponse | Promise<FakeResponse>;

/** A `/content` call as the content queue made it. */
export type SentContent = { notes: ContentNote[]; missing: ContentMissing[] };

/** An attachment upload as the API port received it. */
export type PostedUpload = {
  fields: Record<string, string>;
  file: AttachmentFile;
};

/** A timer the fake timers hold until the test fires it. */
export type HeldTimer = { fn: () => void; ms: number };

/** An update prompt the fake recorded instead of showing. */
export type ShownPrompt = { installed: string; release: LatestPluginRelease };

/** A promise with its resolve, to hold work until the test lets it go. */
export type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

/** The options the stub's elements take when one is created. */
export type ElementOptions = { text?: string; cls?: string };

/** The part of a plugin manifest the stub's `Plugin` keeps. */
export type StubManifest = { id: string; version: string };

/** The parts of Obsidian's metadata cache the stub's `getAllTags` reads. */
export type TagCache = {
  frontmatter?: Record<string, unknown>;
  tags?: { tag: string }[];
};

/** A `/ingest` event as the fake server reads its attachment hashes. */
export type IngestedEvent = { attachments?: { hash: string }[] };

/** A manifest body as a test reads its client time. */
export type ClientTimeBody = { clientTime: string };

/** The sync harness plus the edit sync built on it. */
export type EditSyncHarness = SyncHarness & { edits: EditSync };

/** Options for building the update check under test. */
export type UpdateCheckSetup = { canSync?: boolean; installed?: string };

/** What a test records each time the plugin saves `data.json`. */
export type SavedData = { data: StoredData; socketClosed: boolean[] };
