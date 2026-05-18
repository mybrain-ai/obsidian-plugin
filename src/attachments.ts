import { Platform, TFile, type App } from "obsidian";
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

/** Inspect the metadata cache for non-markdown embeds, resolve each via
 * `getFirstLinkpathDest`, and compute the bytes-hash. Bytes are read once
 * here (the hash needs them) but not retained — `uploadAttachments` reads
 * them again on demand if the server actually asks for the upload. */
export async function resolveAttachments(
  app: App,
  file: TFile,
): Promise<ResolvedAttachment[]> {
  const cache = app.metadataCache.getFileCache(file);
  const embeds = cache?.embeds ?? [];

  const seen = new Set<string>();
  const files: TFile[] = [];

  for (const embed of embeds) {
    const target = app.metadataCache.getFirstLinkpathDest(
      embed.link,
      file.path,
    );
    
    if (!target || target.extension === "md") continue;
    
    if (seen.has(target.path)) continue;
    
    seen.add(target.path);
    files.push(target);
  }

  return mapWithConcurrency(files, RESOLVE_CONCURRENCY, async (target) => {
    const bytes = await app.vault.readBinary(target);

    return {
      ref: {
        path: target.path,
        ext: target.extension,
        size: target.stat.size,
        mtime: target.stat.mtime,
        hash: await sha256(bytes),
      },
      file: target,
    };
  });
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

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);

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
