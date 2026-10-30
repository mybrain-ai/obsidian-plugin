import assert from "node:assert/strict";
import { test } from "node:test";

import { TOKEN_REJECTED_NOTICE } from "@/core/constants";
import { TokenRejectedError } from "@/core/errors";
import {
  isInScope,
  markTokenRejected,
  requestEnvelope,
  uploadAttachments,
  uploadNeeded,
} from "@/core/sync/sync-steps";
import type { AttachmentRef } from "@/core/sync/types";

import { resolved, syncHarness } from "@test/support/fakes";

test("scope follows the live settings and never takes the config folder", () => {
  const h = syncHarness([], { inScopeFolders: ["Work"] });

  assert.equal(isInScope(h.deps, "Work/a.md"), true);
  assert.equal(isInScope(h.deps, "Home/a.md"), false);

  h.settings.inScopeFolders = [];

  assert.equal(isInScope(h.deps, "Home/a.md"), true);
  assert.equal(isInScope(h.deps, ".obsidian/a.md"), false);
});

test("the envelope falls back to the vault's own name", () => {
  const h = syncHarness([], { vaultName: "" });

  assert.deepEqual(requestEnvelope(h.deps), {
    vaultId: "vault-1",
    vaultName: "Fake vault",
    clientTime: new Date(h.now.value).toISOString(),
  });
});

test("a rejected token is flagged before the notice", () => {
  const h = syncHarness([]);
  const seen: boolean[] = [];

  h.notifier.notice = () => void seen.push(h.deps.auth.rejected);
  markTokenRejected(h.deps);

  assert.deepEqual(seen, [true]);
});

test("a token already flagged as rejected shows no second notice", () => {
  const h = syncHarness([]);

  markTokenRejected(h.deps);
  markTokenRejected(h.deps);

  assert.deepEqual(h.notifier.messages, [TOKEN_REJECTED_NOTICE]);
});

test("a retry list that throws while recording is contained", async () => {
  const h = syncHarness([]);

  h.uploader.remember([resolved(_ref("h1"))]);
  h.uploader.failWith.set("h1", new Error("network down"));
  h.failedUploads.record = () => {
    throw new Error("storage broke");
  };

  await uploadAttachments(h.deps, ["h1"]);

  assert.deepEqual(h.notifier.messages, []);
});

test("a response asking for no attachments uploads nothing", async () => {
  const h = syncHarness([]);

  await uploadNeeded(h.deps, undefined);
  await uploadNeeded(h.deps, {
    accepted: 1,
    rejected: [],
    attachmentsNeeded: [],
  });

  assert.deepEqual(h.uploader.uploads, []);
});

test("failed uploads are handed to the retry list; the rest are not", async () => {
  const h = syncHarness([]);
  const error = new Error("network down");

  h.uploader.remember([resolved(_ref("h1")), resolved(_ref("h2"))]);
  h.uploader.failWith.set("h2", error);

  await uploadAttachments(h.deps, ["h1", "h2"]);

  assert.deepEqual(
    h.failedUploads.recorded.map((batch) =>
      batch.map((f) => [f.resolved.ref.hash, f.error]),
    ),
    [[["h2", error]]],
  );
  assert.deepEqual(h.notifier.messages, []);
});

test("a rejected token during uploads is flagged once, and the uploads are kept for later", async () => {
  const h = syncHarness([]);

  h.uploader.remember([resolved(_ref("h1")), resolved(_ref("h2"))]);
  h.uploader.failWith.set("h1", new TokenRejectedError());
  h.uploader.failWith.set("h2", new TokenRejectedError());

  await uploadAttachments(h.deps, ["h1", "h2"]);

  assert.equal(h.deps.auth.rejected, true);
  assert.deepEqual(h.notifier.messages, [TOKEN_REJECTED_NOTICE]);
  assert.equal(h.failedUploads.recorded[0].length, 2);
});

test("an upload that throws outright is logged, not thrown", async () => {
  const h = syncHarness([]);

  h.uploader.upload = () => Promise.reject(new Error("broken"));

  await uploadAttachments(h.deps, ["h1"]);

  assert.deepEqual(h.failedUploads.recorded, []);
});

test("all uploads going through records nothing", async () => {
  const h = syncHarness([]);

  h.uploader.remember([resolved(_ref("h1"))]);
  await uploadAttachments(h.deps, ["h1"]);

  assert.deepEqual(h.failedUploads.recorded, []);
});

function _ref(hash: string): AttachmentRef {
  return { path: `Files/${hash}.pdf`, ext: "pdf", size: 3, mtime: 1, hash };
}
