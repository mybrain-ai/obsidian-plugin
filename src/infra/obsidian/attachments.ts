import { type App, type TFile, getLinkpath } from "obsidian";

import { mapWithConcurrency } from "@/core/shared/concurrency";
import { sha256 } from "@/core/shared/hash";
import type { BinaryFile, ResolvedAttachment } from "@/core/sync/types";
import type { HashedFile } from "@/infra/obsidian/types";

const RESOLVE_CONCURRENCY = 4;

/** Content hashes of attachment files, kept while a file's mtime and size
 * stay the same, so a file embedded by many notes is read once. */
export class AttachmentHashCache {
  private readonly _entries = new Map<string, HashedFile>();

  /** The file's content hash, read again only when it changed. */
  async hash(app: App, file: TFile): Promise<string> {
    const { mtime, size } = file.stat;
    const cached = this._entries.get(file.path);

    if (cached && cached.mtime === mtime && cached.size === size) {
      return cached.hash;
    }

    const hash = await sha256(await app.vault.readBinary(file));

    this._entries.set(file.path, { mtime, size, hash });

    return hash;
  }
}

/** Files a note embeds (`![[...]]`), each once, in order. The `#heading`,
 * `#page=N` or `^block` part of a link is dropped before resolving it. */
export function resolveEmbedTargets(app: App, file: TFile): TFile[] {
  const cache = app.metadataCache.getFileCache(file);
  const seen = new Set<string>();
  const targets: TFile[] = [];

  for (const embed of cache?.embeds ?? []) {
    const linkpath = getLinkpath(embed.link);

    // `![[#heading]]` embeds part of the note itself, not another file.
    if (linkpath === "") continue;

    const target = app.metadataCache.getFirstLinkpathDest(linkpath, file.path);

    if (!target || seen.has(target.path)) continue;

    seen.add(target.path);
    targets.push(target);
  }

  return targets;
}

/** The embedded files that are not notes, as refs with handles. Bytes are
 * read only to hash; the uploader reads them again if the server asks. */
export async function resolveAttachments(
  app: App,
  targets: readonly TFile[],
  hashes: AttachmentHashCache,
): Promise<ResolvedAttachment[]> {
  const files = targets.filter((target) => target.extension !== "md");

  return mapWithConcurrency(files, RESOLVE_CONCURRENCY, async (target) => ({
    ref: {
      path: target.path,
      ext: target.extension,
      size: target.stat.size,
      mtime: target.stat.mtime,
      hash: await hashes.hash(app, target),
    },
    file: binaryFileHandle(app, target),
  }));
}

/** The file as Obsidian tracks it: a rename updates its name and path, and a
 * deleted one has no stat and throws on read. */
export function binaryFileHandle(app: App, file: TFile): BinaryFile {
  return {
    get name() {
      return file.name;
    },
    get path() {
      return file.path;
    },
    stat: () =>
      app.vault.getAbstractFileByPath(file.path) === file
        ? { size: file.stat.size, mtime: file.stat.mtime }
        : null,
    readBinary: () => app.vault.readBinary(file),
  };
}
