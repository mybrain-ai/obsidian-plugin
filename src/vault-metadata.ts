import { getAllTags, getLinkpath, type App, type TFile } from "obsidian";
import { resolveAttachments, type ResolvedAttachment } from "@/attachments";
import { sha256 } from "@/hash";
import { buildNoteMetadata } from "@/metadata";
import { readNativeNoteSettings } from "@/native-settings";
import { enumerateVaultTree } from "@/scope";
import {
  API_VERSION,
  type ContentNote,
  type ManifestV2Body,
  type NoteMetadata,
} from "@/types";

export type ReadMetadata = {
  metadata: NoteMetadata;
  resolved: ResolvedAttachment[];
};

export type ReadContent = {
  note: Omit<ContentNote, "requestId">;
  resolved: ResolvedAttachment[];
};

/** Protocol 2 metadata of a note, from the public metadata-cache API only.
 * The text is read to hash it and count its words, and never leaves here. */
export async function readNoteMetadata(
  app: App,
  file: TFile,
): Promise<ReadMetadata> {
  const content = await app.vault.cachedRead(file);
  const cache = app.metadataCache.getFileCache(file);
  const resolved = await resolveAttachments(app, file);

  const embeds: string[] = [];

  for (const embed of cache?.embeds ?? []) {
    const target = app.metadataCache.getFirstLinkpathDest(
      getLinkpath(embed.link),
      file.path,
    );

    if (target) embeds.push(target.path);
  }

  const metadata = await buildNoteMetadata({
    path: file.path,
    basename: file.basename,
    stat: file.stat,
    content,
    frontmatter: cache?.frontmatter,
    frontmatterEnd: cache?.frontmatterPosition?.end.offset ?? null,
    tags: cache ? getAllTags(cache) : null,
    resolvedLinks: app.metadataCache.resolvedLinks[file.path],
    unresolvedLinks: app.metadataCache.unresolvedLinks[file.path],
    embeds,
    attachments: resolved.map((r) => r.ref),
  });

  return { metadata, resolved };
}

export type ManifestEnvelope = {
  vaultId: string;
  vaultName: string;
  clientTime: string;
  pluginVersion: string;
};

/** The protocol 2 manifest body for `files`. A note that fails to read is
 * left out (and logged without its path). */
export async function collectManifestV2(
  app: App,
  files: readonly TFile[],
  envelope: ManifestEnvelope,
): Promise<ManifestV2Body> {
  const notes: NoteMetadata[] = [];

  for (const file of files) {
    try {
      notes.push((await readNoteMetadata(app, file)).metadata);
    } catch (e) {
      console.error("MyBrain: failed to read a note", e);
    }
  }

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
    files: notes,
  };
}

/** The text of a note the server asked for, read as it is now. */
export async function readNoteContent(
  app: App,
  file: TFile,
): Promise<ReadContent> {
  const content = await app.vault.cachedRead(file);
  const resolved = await resolveAttachments(app, file);

  return {
    note: {
      path: file.path,
      hash: await sha256(content),
      content,
      attachments: resolved.map((r) => r.ref),
    },
    resolved,
  };
}
