import assert from "node:assert/strict";
import { test } from "node:test";

import { FileReadError } from "@/core/errors";
import { AttachmentUpload } from "@/core/sync/attachment-upload";
import type { AttachmentRef, ResolvedAttachment } from "@/core/sync/types";

import { FakeBinaryFile } from "@test/support/fakes";
import type { PostedUpload } from "@test/support/types";

const PDF = "Files/report.pdf";
const BYTES = new Uint8Array([7, 8, 9]);

const REF: AttachmentRef = {
  path: PDF,
  ext: "pdf",
  size: BYTES.byteLength,
  mtime: 1,
  hash: "h-pdf",
};

test("a hash that was never remembered is skipped", async () => {
  const { uploader, posted } = _setup();

  assert.deepEqual(await uploader.upload(["nope"]), {
    uploaded: [],
    skipped: ["nope"],
    failed: [],
  });
  assert.deepEqual(posted, []);
});

test("a remembered attachment is posted once and then forgotten", async () => {
  const { uploader, posted, resolved } = _setup();

  uploader.remember([resolved]);

  assert.deepEqual(await uploader.upload([REF.hash]), {
    uploaded: [REF.hash],
    skipped: [],
    failed: [],
  });
  assert.equal(posted.length, 1);
  assert.deepEqual(Object.keys(posted[0].fields), [
    "vaultId",
    "hash",
    "path",
    "ext",
    "size",
  ]);
  assert.deepEqual(posted[0].fields, {
    vaultId: "vault-1",
    hash: REF.hash,
    path: PDF,
    ext: "pdf",
    size: String(BYTES.byteLength),
  });
  assert.equal(posted[0].file.name, "report.pdf");
  assert.equal(posted[0].file.contentType, "application/pdf");
  assert.deepEqual(
    Array.from(new Uint8Array(posted[0].file.bytes)),
    Array.from(BYTES),
  );

  assert.deepEqual(await uploader.upload([REF.hash]), {
    uploaded: [],
    skipped: [REF.hash],
    failed: [],
  });
  assert.equal(posted.length, 1);
});

test("a file renamed after the read goes up under its new name, from the same handle", async () => {
  const { uploader, posted, file, resolved } = _setup();

  uploader.remember([resolved]);
  file.name = "renamed.pdf";

  assert.deepEqual(await uploader.upload([REF.hash]), {
    uploaded: [REF.hash],
    skipped: [],
    failed: [],
  });
  assert.equal(posted[0].file.name, "renamed.pdf");
  // The fields keep the path the note referenced when it was read.
  assert.equal(posted[0].fields.path, PDF);
  assert.equal(file.reads, 1);
});

test("a file deleted after the read is reported as failed, with its error", async () => {
  const { uploader, posted, file, resolved } = _setup();

  uploader.remember([resolved]);
  file.gone = true;

  const result = await uploader.upload([REF.hash]);

  assert.deepEqual(result.uploaded, []);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].resolved, resolved);
  assert.ok(result.failed[0].error instanceof FileReadError);
  assert.match(String(result.failed[0].error.cause), /file is gone/);
  assert.deepEqual(posted, []);
});

test("one failed upload doesn't stop or hide the others", async () => {
  const { uploader, posted, resolved, failFor } = _setup();
  const others = ["h1", "h2", "h3", "h4"].map((hash) => ({
    ...resolved,
    ref: { ...REF, hash },
  }));

  failFor.add("h2");
  uploader.remember(others);

  const result = await uploader.upload(["h1", "h2", "h3", "h4"]);

  assert.deepEqual(result.uploaded.sort(), ["h1", "h3", "h4"]);
  assert.deepEqual(
    result.failed.map((f) => f.resolved.ref.hash),
    ["h2"],
  );
  assert.equal(posted.length, 3);
});

test("a failed upload is forgotten here, since the retry list holds it, until a note references it again", async () => {
  const { uploader, resolved, failFor } = _setup();

  failFor.add(REF.hash);
  uploader.remember([resolved]);

  const first = await uploader.upload([REF.hash]);

  assert.deepEqual(
    first.failed.map((f) => f.resolved.ref.hash),
    [REF.hash],
  );

  failFor.clear();

  assert.deepEqual((await uploader.upload([REF.hash])).skipped, [REF.hash]);

  uploader.remember([resolved]);

  assert.deepEqual((await uploader.upload([REF.hash])).uploaded, [REF.hash]);
});

test("the skipped list is a copy of the hashes asked for", async () => {
  const { uploader, mobile } = _setup(false);
  const hashes = ["a", "b"];

  mobile.value = true;

  const { skipped } = await uploader.upload(hashes);

  assert.deepEqual(skipped, hashes);
  assert.notEqual(skipped, hashes);
});

test("a file that can't be read fails with a FileReadError, not a network error", async () => {
  const { uploader, resolved, file } = _setup();

  file.gone = true;

  await assert.rejects(uploader.send(resolved), FileReadError);
});

test("send uploads one attachment and throws when it fails", async () => {
  const { uploader, posted, resolved, failFor } = _setup();

  await uploader.send(resolved);
  assert.equal(posted.length, 1);
  assert.equal(posted[0].fields.hash, REF.hash);

  failFor.add(REF.hash);
  await assert.rejects(uploader.send(resolved), /refused/);
});

test("uploads run on desktop, and on mobile only when allowed", () => {
  const off = _setup(false);
  const on = _setup(true);

  assert.equal(off.uploader.canUpload(), true);

  off.mobile.value = true;
  on.mobile.value = true;

  assert.equal(off.uploader.canUpload(), false);
  assert.equal(on.uploader.canUpload(), true);
});

test("on mobile with attachment sync off every hash is skipped and nothing is posted", async () => {
  const { uploader, posted, mobile, resolved } = _setup(false);

  mobile.value = true;
  uploader.remember([resolved]);

  assert.deepEqual(await uploader.upload([REF.hash]), {
    uploaded: [],
    skipped: [REF.hash],
    failed: [],
  });
  assert.deepEqual(posted, []);
});

test("every hash is looked up before the first upload starts", async () => {
  const { uploader, posted, file } = _setup();
  const originals = ["h1", "h2", "h3", "h4"].map((hash) => ({
    ref: { ...REF, hash },
    file,
  }));

  uploader.remember(originals);

  const done = uploader.upload(originals.map((r) => r.ref.hash));

  // Remembered after the upload started: a later worker must not see it.
  uploader.remember([
    { ref: { ...originals[3].ref, path: "Other/x.pdf" }, file },
  ]);

  await done;

  assert.equal(posted.length, 4);
  assert.deepEqual(
    posted.map((p) => p.fields.path),
    [PDF, PDF, PDF, PDF],
  );
});

function _setup(syncAttachmentsOnMobile = false) {
  const posted: PostedUpload[] = [];
  const failFor = new Set<string>();
  const mobile = { value: false };
  const file = new FakeBinaryFile("report.pdf", BYTES);
  const uploader = new AttachmentUpload({
    api: {
      uploadAttachment: async (fields, upload) => {
        if (failFor.has(fields.hash)) throw new Error("refused");

        posted.push({ fields, file: upload });
      },
    },
    settings: () => ({ vaultId: "vault-1", syncAttachmentsOnMobile }),
    isMobile: () => mobile.value,
  });
  const resolved: ResolvedAttachment = { ref: REF, file };

  return { posted, uploader, mobile, file, resolved, failFor };
}
