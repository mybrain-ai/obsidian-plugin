import assert from "node:assert/strict";
import { test } from "node:test";

import { TOKEN_REJECTED_NOTICE } from "@/core/constants";
import { createContentQueue } from "@/core/content/content-sync";
import { TokenRejectedError } from "@/core/errors";

import { syncHarness } from "@test/support/fakes";

const NOTE = "In/a.md";
const ATTACHMENT = {
  path: "In/pic.png",
  ext: "png",
  size: 3,
  mtime: 1,
  hash: "h-pic",
};

test("a requested note goes to /content with the envelope, then its asked-for attachments go up", async () => {
  const h = _setup();
  const rememberedAtUpload: boolean[] = [];
  const upload = h.uploader.upload.bind(h.uploader);

  h.uploader.upload = async (hashes) => {
    rememberedAtUpload.push(h.uploader.remembered.has(ATTACHMENT.hash));

    return await upload(hashes);
  };
  h.api.respond = () => ({
    accepted: 1,
    rejected: [],
    attachmentsNeeded: [ATTACHMENT.hash],
  });

  h.queue.request("req-1", [NOTE]);
  await h.queue.run();

  assert.deepEqual(h.api.paths(), ["/content"]);

  const { body } = h.api.calls[0];

  assert.deepEqual(Object.keys(body), [
    "protocol",
    "vaultId",
    "vaultName",
    "clientTime",
    "notes",
    "missing",
  ]);
  assert.deepEqual(body, {
    protocol: 2,
    vaultId: "vault-1",
    // An empty vault name in settings falls back to the vault's own.
    vaultName: "Fake vault",
    clientTime: new Date(h.now.value).toISOString(),
    notes: [
      {
        requestId: "req-1",
        path: NOTE,
        hash: h.vault.notes.get(NOTE)?.hash,
        content: "![[pic.png]]",
        attachments: [ATTACHMENT],
      },
    ],
    missing: [],
  });
  assert.deepEqual(h.uploader.uploads, [[ATTACHMENT.hash]]);
  assert.deepEqual(rememberedAtUpload, [true]);
});

test("a 401 on /content flags the token and shows exactly one notice", async () => {
  const h = _setup();

  h.api.respond = () => {
    throw new TokenRejectedError();
  };

  h.queue.request("req-1", [NOTE]);
  await h.queue.run();

  assert.equal(h.deps.auth.rejected, true);
  assert.deepEqual(h.notifier.messages, [TOKEN_REJECTED_NOTICE]);
  assert.deepEqual(h.uploader.uploads, []);
});

function _setup() {
  const h = syncHarness(
    [{ path: NOTE, content: "![[pic.png]]", attachments: [ATTACHMENT] }],
    { vaultName: "" },
  );

  return { ...h, queue: createContentQueue(h.deps) };
}
