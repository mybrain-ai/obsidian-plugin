import assert from "node:assert/strict";
import { test } from "node:test";

import type { PendingUpload } from "@/core/sync/types";
import {
  pendingUploadLines,
  pendingUploadsSummary,
  uploadFailureNoticeText,
} from "@/ui/upload-texts";

test("the notice counts attachments in the right number", () => {
  assert.equal(
    uploadFailureNoticeText(1),
    "MyBrain: 1 attachment could not be uploaded.",
  );
  assert.equal(
    uploadFailureNoticeText(3),
    "MyBrain: 3 attachments could not be uploaded.",
  );
});

test("the settings summary counts attachments in the right number", () => {
  assert.equal(
    pendingUploadsSummary(1),
    "1 attachment is waiting to upload. It is retried automatically, unless MyBrain refused it; then it waits for Retry now.",
  );
  assert.equal(
    pendingUploadsSummary(3),
    "3 attachments are waiting to upload. They are retried automatically; ones MyBrain refused wait for Retry now.",
  );
});

test("the settings row lists ten uploads with their last error, then how many more", () => {
  const pending = Array.from({ length: 14 }, (_, i) => _pending(`F/${i}.pdf`));
  const { lines, more } = pendingUploadLines(pending);

  assert.equal(lines.length, 10);
  assert.equal(lines[0], "F/0.pdf — network down");
  assert.equal(more, "and 4 more");
  assert.equal(pendingUploadLines(pending.slice(0, 10)).more, null);
});

function _pending(path: string): PendingUpload {
  return {
    ref: { path, ext: "pdf", size: 1, mtime: 1, hash: path },
    path,
    state: "given-up",
    attempts: 3,
    nextAttemptAt: 0,
    firstFailedAt: 0,
    lastError: "network down",
  };
}
