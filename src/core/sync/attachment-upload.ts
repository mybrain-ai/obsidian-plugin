import { FileReadError } from "@/core/errors";
import type { AttachmentUploadDeps, AttachmentUploader } from "@/core/ports";
import { mapWithConcurrency } from "@/core/shared/concurrency";
import { attachmentFields } from "@/core/sync/payloads";
import type { ResolvedAttachment, UploadResult } from "@/core/sync/types";

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

/** Uploads the attachments the server asks for, among those a sent payload
 * referenced. Off on mobile unless the user allowed it. */
export class AttachmentUpload implements AttachmentUploader {
  private readonly _remembered = new Map<string, ResolvedAttachment>();

  constructor(private readonly _deps: AttachmentUploadDeps) {}

  /** Keep the attachments a sent payload referenced, by hash. */
  remember(resolved: readonly ResolvedAttachment[]): void {
    for (const r of resolved) this._remembered.set(r.ref.hash, r);
  }

  /** Upload the remembered attachments among `hashes`; the rest are skipped,
   * and a failure is reported without stopping the others. */
  async upload(hashes: readonly string[]): Promise<UploadResult> {
    const result: UploadResult = { uploaded: [], skipped: [], failed: [] };

    if (!this.canUpload()) return { ...result, skipped: [...hashes] };

    const tasks = hashes.map((hash) => ({
      hash,
      resolved: this._remembered.get(hash),
    }));

    await mapWithConcurrency(tasks, UPLOAD_CONCURRENCY, async (task) => {
      const { hash, resolved } = task;

      if (!resolved) {
        result.skipped.push(hash);

        return;
      }

      try {
        await this.send(resolved);
        result.uploaded.push(hash);
      } catch (error) {
        result.failed.push({ resolved, error });
      }
    });

    // A failed one is the retry list's now; a new request re-reads the note.
    const done = [
      ...result.uploaded,
      ...result.failed.map((f) => f.resolved.ref.hash),
    ];

    for (const hash of done) this._remembered.delete(hash);

    return result;
  }

  /** Whether this device uploads attachments now. */
  canUpload(): boolean {
    return (
      !this._deps.isMobile() || this._deps.settings().syncAttachmentsOnMobile
    );
  }

  /** Upload one attachment, reading its bytes now so they aren't kept between
   * the read of its note and the upload. */
  async send(resolved: ResolvedAttachment): Promise<void> {
    let bytes: ArrayBuffer;

    try {
      bytes = await resolved.file.readBinary();
    } catch (e) {
      throw new FileReadError(e);
    }

    await this._deps.api.uploadAttachment(
      attachmentFields(this._deps.settings().vaultId, resolved.ref),
      {
        name: resolved.file.name,
        bytes,
        contentType: _guessContentType(resolved.ref.ext),
      },
    );
  }
}

function _guessContentType(ext: string): string {
  return CONTENT_TYPES[ext.toLowerCase()] ?? "application/octet-stream";
}
