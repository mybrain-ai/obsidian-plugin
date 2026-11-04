import { API_VERSION } from "@/core/constants";
import { attachmentRefs, buildNoteMetadata } from "@/core/notes/metadata";
import type { NativeNoteSettings } from "@/core/notes/types";
import type {
  AttachmentRef,
  ContentBody,
  ContentMissing,
  ContentNote,
  FolderNode,
  IngestBody,
  IngestBodyV1,
  IngestBodyV2,
  IngestEventV1,
  IngestEventV2,
  ManifestEnvelope,
  ManifestFile,
  ManifestV1Body,
  ManifestV2Body,
  NoteSnapshot,
  RequestEnvelope,
  ServerProtocol,
  UpsertEvent,
  UpsertEventV2,
} from "@/core/sync/types";

/** The fields every request body starts with. */
export function envelope(
  vaultId: string,
  vaultName: string,
  now: Date,
): RequestEnvelope {
  return { vaultId, vaultName, clientTime: now.toISOString() };
}

/** Body of `POST /ingest`; only protocol 2 names its protocol. */
export function ingestBody(
  events: IngestEventV1[],
  protocol: 1,
  env: RequestEnvelope,
): IngestBodyV1;
export function ingestBody(
  events: IngestEventV2[],
  protocol: 2,
  env: RequestEnvelope,
): IngestBodyV2;
export function ingestBody(
  events: IngestEventV1[] | IngestEventV2[],
  protocol: ServerProtocol,
  env: RequestEnvelope,
): IngestBody {
  return {
    ...(protocol === 2 ? { protocol: 2 } : {}),
    apiVersion: API_VERSION,
    ...env,
    events,
  } as IngestBody;
}

/** Protocol 1 upsert: the note text and its full frontmatter. */
export function upsertV1(s: NoteSnapshot): UpsertEvent {
  return {
    op: "upsert",
    ..._v1Fields(s),
    wikilinks: s.wikilinks,
    mdLinks: s.mdLinks,
    attachments: attachmentRefs(s),
  };
}

/** Body of a protocol 1 `POST /manifest`: every note with its text. */
export function manifestV1Body(
  snapshots: readonly NoteSnapshot[],
  folders: FolderNode[],
  env: RequestEnvelope,
): ManifestV1Body {
  return {
    apiVersion: API_VERSION,
    ...env,
    files: snapshots.map(manifestFileV1),
    folders,
  };
}

/** One note of a protocol 1 manifest. */
export function manifestFileV1(s: NoteSnapshot): ManifestFile {
  return { ..._v1Fields(s), attachments: attachmentRefs(s) };
}

/** Protocol 2 upsert: the metadata of the note, never its text. */
export function upsertV2(s: NoteSnapshot): UpsertEventV2 {
  return { op: "upsert", ...buildNoteMetadata(s) };
}

/** Body of a protocol 2 `POST /manifest`: metadata, folders and native note
 * settings, no text. */
export function manifestV2Body(
  snapshots: readonly NoteSnapshot[],
  folders: FolderNode[],
  native: NativeNoteSettings,
  env: ManifestEnvelope,
): ManifestV2Body {
  return {
    protocol: 2,
    apiVersion: API_VERSION,
    ...env,
    ...native,
    folders,
    files: snapshots.map(buildNoteMetadata),
  };
}

/** Body of `POST /content`: the requested notes and the ones not sent. */
export function contentBody(
  env: RequestEnvelope,
  notes: ContentNote[],
  missing: ContentMissing[],
): ContentBody {
  return { protocol: 2, ...env, notes, missing };
}

/** A requested note as sent, before the request id is added. */
export function contentNoteFields(
  s: NoteSnapshot,
): Omit<ContentNote, "requestId"> {
  return {
    path: s.path,
    hash: s.hash,
    content: s.content,
    attachments: attachmentRefs(s),
  };
}

/** Form fields of `POST /attachments`, in the order the server reads them. */
export function attachmentFields(
  vaultId: string,
  ref: AttachmentRef,
): Record<string, string> {
  return {
    vaultId,
    hash: ref.hash,
    path: ref.path,
    ext: ref.ext,
    size: String(ref.size),
  };
}

function _v1Fields(s: NoteSnapshot): Omit<ManifestFile, "attachments"> {
  return {
    path: s.path,
    name: s.basename,
    ext: "md",
    content: s.content,
    frontmatter: s.frontmatter,
    mtime: s.mtime,
    size: s.size,
    hash: s.hash,
  };
}
