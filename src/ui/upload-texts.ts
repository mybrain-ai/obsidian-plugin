import { plural } from "@/core/shared/text";
import type { PendingUpload } from "@/core/sync/types";
import type { PendingUploadLines } from "@/ui/types";

const LISTED_UPLOADS = 10;

/** The notice shown once uploads keep failing. */
export function uploadFailureNoticeText(count: number): string {
  return `MyBrain: ${plural(count, "attachment")} could not be uploaded.`;
}

/** The first line of the settings row for uploads still waiting. */
export function pendingUploadsSummary(count: number): string {
  return count === 1
    ? "1 attachment is waiting to upload. It is retried automatically, unless MyBrain refused it; then it waits for Retry now."
    : `${count} attachments are waiting to upload. They are retried automatically; ones MyBrain refused wait for Retry now.`;
}

/** One line per waiting upload, up to `LISTED_UPLOADS`, then how many more
 * there are. */
export function pendingUploadLines(
  pending: readonly PendingUpload[],
): PendingUploadLines {
  const rest = pending.length - LISTED_UPLOADS;

  return {
    lines: pending
      .slice(0, LISTED_UPLOADS)
      .map((p) => `${p.path} — ${p.lastError}`),
    more: rest > 0 ? `and ${rest} more` : null,
  };
}
