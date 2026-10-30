import { getAllTags, TFile, type App, type CachedMetadata } from "obsidian";
import {
  AttachmentHashCache,
  mapWithConcurrency,
  resolveAttachments,
  resolveEmbedTargets,
  type ResolvedAttachment,
} from "@/attachments";
import type { ContentReadResult } from "@/content";
import { sha256 } from "@/hash";
import { buildNoteMetadata } from "@/metadata";
import { readNativeNoteSettings } from "@/native-settings";
import { enumerateVaultTree } from "@/scope";
import { API_VERSION, type ManifestV2Body, type NoteMetadata } from "@/types";

const READ_CONCURRENCY = 4;

/** One read of a note: its text and hash, its metadata cache, and what it
 * embeds. Every protocol's payload for the note is built from this, so they
 * all agree on the hash. */
export type NoteRead = {
  file: TFile;
  content: string;
  hash: string;
  cache: CachedMetadata | null;
  embeds: string[];
  resolved: ResolvedAttachment[];
};

export async function readNote(
  app: App,
  file: TFile,
  hashes: AttachmentHashCache = new AttachmentHashCache(),
): Promise<NoteRead> {
  const content = await app.vault.cachedRead(file);
  const targets = resolveEmbedTargets(app, file);

  return {
    file,
    content,
    hash: await sha256(content),
    cache: app.metadataCache.getFileCache(file),
    embeds: targets.map((target) => target.path),
    resolved: await resolveAttachments(app, file, hashes, targets),
  };
}

/** `files` read a few at a time. A note that fails to read is left out (and
 * logged without its path). */
export async function readNotes(
  app: App,
  files: readonly TFile[],
  hashes: AttachmentHashCache = new AttachmentHashCache(),
): Promise<NoteRead[]> {
  const reads = await mapWithConcurrency(
    files,
    READ_CONCURRENCY,
    async (file) => {
      try {
        return await readNote(app, file, hashes);
      } catch (e) {
        console.error("MyBrain: failed to read a note", e);
        return null;
      }
    },
  );

  return reads.filter((read): read is NoteRead => read !== null);
}

/** Protocol 2 metadata of a note, from the public metadata-cache API only.
 * The text was read to hash it and count its words, and never leaves here. */
export function noteMetadata(app: App, read: NoteRead): NoteMetadata {
  const { file, cache } = read;

  return buildNoteMetadata({
    path: file.path,
    basename: file.basename,
    stat: file.stat,
    content: read.content,
    hash: read.hash,
    frontmatter: cache?.frontmatter,
    frontmatterEnd: cache?.frontmatterPosition?.end.offset ?? null,
    tags: cache ? getAllTags(cache) : null,
    resolvedLinks: app.metadataCache.resolvedLinks[file.path],
    unresolvedLinks: app.metadataCache.unresolvedLinks[file.path],
    embeds: read.embeds,
    attachments: read.resolved.map((r) => r.ref),
  });
}

/** Fields every request body carries. */
export type RequestEnvelope = {
  vaultId: string;
  vaultName: string;
  clientTime: string;
};

export type ManifestEnvelope = RequestEnvelope & { pluginVersion: string };

/** The protocol 2 manifest body for notes already read. */
export async function manifestV2Body(
  app: App,
  reads: readonly NoteRead[],
  envelope: ManifestEnvelope,
): Promise<ManifestV2Body> {
  const files = reads.map((read) => noteMetadata(app, read));
  const native = await readNativeNoteSettings(
    app.vault.adapter,
    app.vault.configDir,
  );

  return {
    protocol: 2,
    apiVersion: API_VERSION,
    ...envelope,
    ...native,
    folders: enumerateVaultTree(app),
    files,
  };
}

/** The protocol 2 manifest body for `files`. */
export async function collectManifestV2(
  app: App,
  files: readonly TFile[],
  envelope: ManifestEnvelope,
): Promise<ManifestV2Body> {
  return await manifestV2Body(app, await readNotes(app, files), envelope);
}

/** A note the server asked for, read as it is now. Its text is never read
 * for a note outside the folders the user chose, even when asked for. */
export async function readRequestedNote(
  app: App,
  path: string,
  isInScope: (path: string) => boolean,
  hashes: AttachmentHashCache = new AttachmentHashCache(),
): Promise<ContentReadResult<ResolvedAttachment>> {
  const file = app.vault.getAbstractFileByPath(path);

  if (!(file instanceof TFile) || file.extension !== "md") {
    return { kind: "missing", reason: "not_found" };
  }

  if (!isInScope(file.path)) return { kind: "missing", reason: "out_of_scope" };

  const read = await readNote(app, file, hashes);

  return {
    kind: "note",
    note: {
      path: file.path,
      hash: read.hash,
      content: read.content,
      attachments: read.resolved.map((r) => r.ref),
    },
    resolved: read.resolved,
  };
}
