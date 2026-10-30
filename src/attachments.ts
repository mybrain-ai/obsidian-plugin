import { getLinkpath, Platform, TFile, type App } from "obsidian";
import { sha256 } from "@/hash";
import { postMultipart, type Auth } from "@/network";
import type { AttachmentRef } from "@/types";

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  mp4: "video/mp4",
  mov: "video/quicktime",
};

const UPLOAD_CONCURRENCY = 3;
const RESOLVE_CONCURRENCY = 4;

export type ResolvedAttachment = {
  ref: AttachmentRef;
  file: TFile;
};

/** Content hashes of attachment files, kept while a file's mtime and size
 * stay the same, so a file embedded by many notes is read once. */
export class AttachmentHashCache {
  private readonly entries = new Map<
    string,
    { mtime: number; size: number; hash: string }
  >();

  async hash(app: App, file: TFile): Promise<string> {
    const { mtime, size } = file.stat;
    const cached = this.entries.get(file.path);

    if (cached && cached.mtime === mtime && cached.size === size) {
      return cached.hash;
    }

    const hash = await sha256(await app.vault.readBinary(file));

    this.entries.set(file.path, { mtime, size, hash });

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

/** The non-markdown files a note embeds, with their content hash. Bytes are
 * read only to hash them and not kept: `uploadAttachments` reads them again
 * if the server asks for the upload. */
export async function resolveAttachments(
  app: App,
  file: TFile,
  hashes: AttachmentHashCache = new AttachmentHashCache(),
  targets: TFile[] = resolveEmbedTargets(app, file),
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
    file: target,
  }));
}

/** Upload attachments the server says it doesn't have. `refsByHash` is the
 * in-memory lookup from upsert resolution; bytes are re-read from the vault
 * here so we don't retain them between resolve and upload. */
export async function uploadAttachments(
  app: App,
  auth: Auth,
  vaultId: string,
  refsByHash: Map<string, ResolvedAttachment>,
  hashes: string[],
  syncAttachmentsOnMobile: boolean,
): Promise<{ uploaded: string[]; skipped: string[] }> {
  if (Platform.isMobile && !syncAttachmentsOnMobile) {
    return { uploaded: [], skipped: hashes };
  }

  const tasks = hashes.map((hash) => ({
    hash,
    resolved: refsByHash.get(hash),
  }));

  const uploaded: string[] = [];
  const skipped: string[] = [];

  await mapWithConcurrency(tasks, UPLOAD_CONCURRENCY, async (task) => {
    if (!task.resolved) {
      skipped.push(task.hash);
      return;
    }

    const bytes = await app.vault.readBinary(task.resolved.file);

    await postMultipart({
      auth,
      path: "/attachments",
      fields: {
        vaultId,
        hash: task.resolved.ref.hash,
        path: task.resolved.ref.path,
        ext: task.resolved.ref.ext,
        size: String(task.resolved.ref.size),
      },
      file: {
        name: task.resolved.file.name,
        bytes,
        contentType: guessContentType(task.resolved.ref.ext),
      },
    });

    uploaded.push(task.hash);
  });

  return { uploaded, skipped };
}

function guessContentType(ext: string): string {
  return CONTENT_TYPES[ext.toLowerCase()] ?? "application/octet-stream";
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);

  let next = 0;

  const worker = async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  };

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    worker,
  );

  await Promise.all(workers);

  return results;
}
