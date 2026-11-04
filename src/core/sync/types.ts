import type { NativeNoteSettings } from "@/core/notes/types";

/** While `rejected` is set, edits stop draining; a successful ping, an
 * answered manifest push, an install link or a saved token clears it. */
export type AuthState = { rejected: boolean };

export type FolderNode = { path: string; name: string; parent: string | null };

/** A file's size and modification time, enough to tell it was edited. */
export type FileStat = { size: number; mtime: number };

/** A note's path with its modification time. */
export type NoteStamp = { path: string; mtime: number };

/** What `GET /ping` answers: the token's state. */
export type PingReply = { status?: string };

export type AttachmentRef = {
  path: string;
  ext: string;
  size: number;
  mtime: number;
  hash: string;
};

/** A vault file as the uploader sees it; `name` and `path` are read when
 * used, so a rename since it was found is followed. */
export type BinaryFile = {
  readonly name: string;
  readonly path: string;
  /** Null once the file is no longer in the vault. */
  stat(): FileStat | null;
  readBinary(): Promise<ArrayBuffer>;
};

/** An attachment as read with its note: the ref that is sent, and a handle to
 * the file it was read from. */
export type ResolvedAttachment = {
  ref: AttachmentRef;
  file: BinaryFile;
};

/** What became of each hash the server asked to have uploaded. */
export type UploadResult = {
  uploaded: string[];
  skipped: string[];
  failed: UploadFailure[];
};

/** One upload that failed, with the error that ended it. */
export type UploadFailure = { resolved: ResolvedAttachment; error: unknown };

/** `retrying`: quick schedule; `given-up`: reported, tried hourly; `stuck`:
 * refused, or unreadable for a day, and waits for a manual retry. */
export type PendingUploadState = "retrying" | "given-up" | "stuck";

/** What one retry of a waiting upload came to; `newly-waiting` failed while
 * retrying and just ran out of quick retries or was refused. */
export type RetryOutcome =
  "uploaded" | "failed" | "newly-waiting" | "rejected" | "dropped" | "stopped";

/** How many uploads a retry run sent, failed again, or dropped as deleted or
 * changed. */
export type RetryRun = { uploaded: number; failing: number; dropped: number };

/** A failed upload kept on this device until it goes through; `path` is where
 * the file was last seen, which a rename can move away from `ref.path`. */
export type PendingUpload = {
  readonly ref: AttachmentRef;
  readonly path: string;
  readonly state: PendingUploadState;
  readonly attempts: number;
  readonly nextAttemptAt: number;
  /** When the upload first failed; a file that can't be read stops being
   * retried a day after this. */
  readonly firstFailedAt: number;
  readonly lastError: string;
};

/** Protocol 1 upsert, with the note text. May sit in a queue saved by an
 * older plugin version. */
export type UpsertEvent = {
  op: "upsert";
  path: string;
  name: string;
  ext: "md";
  content: string;
  frontmatter: Record<string, unknown> | null;
  mtime: number;
  size: number;
  hash: string;
  wikilinks: string[];
  mdLinks: string[];
  attachments: AttachmentRef[];
};

/** A note in the protocol 1 manifest: an upsert without the link lists. */
export type ManifestFile = Omit<UpsertEvent, "op" | "wikilinks" | "mdLinks">;

type DeleteEvent = { op: "delete"; path: string };
type RenameEvent = { op: "rename"; oldPath: string; newPath: string };

/** Protocol 2 metadata for one note: everything the server needs to triage it,
 * without the note text. */
export type NoteMetadata = {
  path: string;
  name: string;
  ext: "md";
  size: number;
  ctime: number;
  mtime: number;
  hash: string;
  words: number;
  frontmatter: Record<string, unknown> | null;
  tags: string[];
  links: string[];
  unresolved: string[];
  embeds: string[];
  attachments: AttachmentRef[];
};

/** Protocol 2 upsert: the same metadata as the manifest, never the text. */
export type UpsertEventV2 = { op: "upsert" } & NoteMetadata;

/** A queued event; the queue may hold upserts of either protocol. */
export type IngestEvent =
  UpsertEvent | UpsertEventV2 | DeleteEvent | RenameEvent;

/** An event as sent under protocol 1: upserts carry the text. */
export type IngestEventV1 = UpsertEvent | DeleteEvent | RenameEvent;

/** An event as sent under protocol 2: upserts never carry the text. */
export type IngestEventV2 = UpsertEventV2 | DeleteEvent | RenameEvent;

/** Rebuild a queued note's upsert from the vault in either protocol's shape;
 * null when the note is gone or out of scope. */
export type UpsertRebuilders = {
  v1(path: string): Promise<UpsertEvent | null>;
  v2(path: string): Promise<UpsertEventV2 | null>;
};

/** Protocol the server accepted on the last manifest push: 2 = metadata first,
 * text on request; 1 = a server that predates protocol 2. */
export type ServerProtocol = 1 | 2;

export type ManifestV1Body = {
  apiVersion: number;
  vaultId: string;
  vaultName: string;
  clientTime: string;
  files: ManifestFile[];
  folders: FolderNode[];
};

/** Body of `POST /ingest` under protocol 1, which names no protocol. */
export type IngestBodyV1 = {
  protocol?: never;
  apiVersion: number;
  vaultId: string;
  vaultName: string;
  clientTime: string;
  events: IngestEventV1[];
};

/** Body of `POST /ingest` under protocol 2. */
export type IngestBodyV2 = {
  protocol: 2;
  apiVersion: number;
  vaultId: string;
  vaultName: string;
  clientTime: string;
  events: IngestEventV2[];
};

export type IngestBody = IngestBodyV1 | IngestBodyV2;

export type ManifestV2Body = {
  protocol: 2;
  apiVersion: number;
  vaultId: string;
  vaultName: string;
  clientTime: string;
  pluginVersion: string;
  folders: FolderNode[];
  files: NoteMetadata[];
} & NativeNoteSettings;

/** `hash` is of the text as read now, so a note edited after the request
 * carries its new hash. */
export type ContentNote = {
  requestId: string;
  path: string;
  hash: string;
  content: string;
  attachments: AttachmentRef[];
};

/** A requested note the plugin will not send: deleted, renamed away, or no
 * longer inside the sync scope. */
export type ContentMissing = {
  requestId: string;
  path: string;
  reason: "not_found" | "out_of_scope";
};

/** Reply to `/ingest`, `/manifest` and `/content`. */
export type IngestResponse = {
  accepted: number;
  rejected: Array<{ path: string; reason: string }>;
  attachmentsNeeded: string[];
};

export type RequestEnvelope = {
  vaultId: string;
  vaultName: string;
  clientTime: string;
};

export type ContentBody = RequestEnvelope & {
  protocol: 2;
  notes: ContentNote[];
  missing: ContentMissing[];
};

export type ManifestEnvelope = RequestEnvelope & { pluginVersion: string };

/** One read of a note as plain data, so every protocol's payload is built from
 * the same text and hash. */
export type NoteSnapshot = {
  path: string;
  basename: string;
  ctime: number;
  mtime: number;
  size: number;
  content: string;
  hash: string;
  /** A copy of the cached frontmatter without Obsidian's `position`. */
  frontmatter: Record<string, unknown> | null;
  frontmatterEnd: number | null;
  /** Empty when the note has none, as are the link maps. */
  tags: string[];
  resolvedLinks: Record<string, number>;
  unresolvedLinks: Record<string, number>;
  wikilinks: string[];
  mdLinks: string[];
  /** Resolved embed target paths. */
  embeds: string[];
  attachments: ResolvedAttachment[];
};

/** The plugin settings, stored under `settings` in `data.json`. */
export interface MyBrainSettings {
  endpoint: string;
  token: string;
  inScopeFolders: string[];
  vaultId: string;
  vaultName: string;
  lastSyncAt: number | null;
  syncAttachmentsOnMobile: boolean;
  /** Protocol the server accepted on the last manifest push; null until known. */
  serverProtocol: ServerProtocol | null;
}

/** The edit queue, stored under `queue` in `data.json`. */
export type QueueState = {
  events: IngestEvent[];
  attemptCount: number;
  nextAttemptAt: number;
};

/** The whole of `data.json`. */
export type StoredData = {
  settings: MyBrainSettings;
  queue: QueueState;
};

/** Settings a `mybrain/install` deep link carries. */
export type DeepLinkSettings = {
  token: string;
  endpoint: string | null;
  vaultId: string | null;
  vaultName: string | null;
};

/** One changed setting, as the deep-link confirmation lists it. */
export type DiffEntry = { label: string; oldValue: string; newValue: string };

/** What the plugin sends on the server channel. */
export type WsClientMessage = {
  type: "hello";
  protocol: number;
  pluginVersion: string;
};

/** The server channel messages the plugin understands. */
export type WsServerMessage =
  | { type: "manifest_request" }
  | { type: "scope_changed"; folders: string[] }
  | { type: "content_requested"; requestId: string; paths: string[] };

/** A note as a vault event hands it over. Its `path` is read again when the
 * debounce fires, so a rename in between is followed. */
export type NoteRef = { readonly path: string };

/** What a full sync is asked to do; `fallbackToV1` defaults to true. */
export type PushOptions = { initial: boolean; fallbackToV1?: boolean };

/** How the manifest push went: the protocol the server took, and whether a
 * manifest went out under it. */
export type ManifestOutcome = {
  protocol: ServerProtocol;
  sent: boolean;
};

/** The two manifest sends a negotiation can make, and how it reports. */
export type ManifestSenders = {
  sendV2(): Promise<void>;
  sendV1(): Promise<void>;
  fallbackToV1: boolean;
  log(message: string): void;
};
