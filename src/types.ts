export type FolderNode = { path: string; name: string; parent: string | null };

export type AttachmentRef = {
  path: string;
  ext: string;
  size: number;
  mtime: number;
  hash: string;
};

/** Protocol v1 upsert (plugin 1.0.x): carries the note text. Still built when
 * the server has not accepted protocol 2, and may sit in a queue persisted by
 * an older plugin version. */
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

export type DeleteEvent = { op: "delete"; path: string };
export type RenameEvent = { op: "rename"; oldPath: string; newPath: string };

/** Protocol 2 metadata for one note: everything the server needs to triage it,
 * without the note text (see SPEC-obsidian-protocolo-v2, section 3). */
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

export type IngestEvent = UpsertEvent | UpsertEventV2 | DeleteEvent | RenameEvent;

/** Highest sync protocol this plugin speaks. */
export const PROTOCOL_VERSION = 2;

/** Protocol the server accepted on the last manifest push: 2 = metadata first,
 * text on request; 1 = a server that predates protocol 2. */
export type ServerProtocol = 1 | 2;

/** Configuration of the core Templates and Daily notes plugins. `null` when the
 * plugin is off or its configuration can't be read; `""` is the vault root. */
export type NativeNoteSettings = {
  templatesFolder: string | null;
  dailyNotesFolder: string | null;
  dailyNotesFormat: string | null;
};

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

/** Text of one requested note, sent on `POST /content`. `hash` is computed
 * from the text as read now, so a note edited after the request carries its
 * new hash. */
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

export type ContentResponse = IngestResponse;

export type IngestResponse = {
  accepted: number;
  rejected: Array<{ path: string; reason: string }>;
  attachmentsNeeded: string[];
};

export const API_VERSION = 1;

/** Latest published plugin release, as served by `GET /latest-release`. */
export type LatestPluginRelease = {
  version: string;
  notes: string;
};
