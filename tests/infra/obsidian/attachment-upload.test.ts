// The uploader against attachments as the vault adapter resolves them.
import assert from "node:assert/strict";
import { test } from "node:test";

import { AttachmentUpload } from "@/core/sync/attachment-upload";
import { ObsidianVault } from "@/infra/obsidian/vault";

import {
  MOC,
  PDF,
  PDF_BYTES,
  createFixtureVault,
} from "@test/support/fixture-vault";
import type { PostedUpload } from "@test/support/types";

test("a fixture attachment goes up with its bytes, name and fields", async () => {
  const { uploader, posted, attachments } = await _setup();
  const [{ ref }] = attachments;

  uploader.remember(attachments);

  assert.deepEqual(await uploader.upload([ref.hash]), {
    uploaded: [ref.hash],
    skipped: [],
    failed: [],
  });
  assert.deepEqual(posted[0].fields, {
    vaultId: "vault-1",
    hash: ref.hash,
    path: PDF,
    ext: "pdf",
    size: String(PDF_BYTES.byteLength),
  });
  assert.equal(posted[0].file.name, "relatorio-atlas-2025.pdf");
  assert.deepEqual(
    Array.from(new Uint8Array(posted[0].file.bytes)),
    Array.from(PDF_BYTES),
  );
});

test("renamed after the read, the attachment goes up under its new name", async () => {
  const { fixture, uploader, posted, attachments } = await _setup();
  const [{ ref }] = attachments;

  uploader.remember(attachments);
  fixture.rename(PDF, "Anexos/relatorio-final.pdf");

  assert.deepEqual(await uploader.upload([ref.hash]), {
    uploaded: [ref.hash],
    skipped: [],
    failed: [],
  });
  assert.equal(posted[0].file.name, "relatorio-final.pdf");
  assert.equal(posted[0].fields.path, PDF);
});

test("deleted after the read, the upload is reported as failed", async () => {
  const { fixture, uploader, posted, attachments } = await _setup();
  const [{ ref }] = attachments;

  uploader.remember(attachments);
  fixture.remove(PDF);

  const result = await uploader.upload([ref.hash]);

  assert.deepEqual(
    result.failed.map((f) => f.resolved.ref.hash),
    [ref.hash],
  );
  assert.deepEqual(posted, []);
});

async function _setup() {
  const fixture = createFixtureVault();
  const vault = new ObsidianVault(fixture.app);
  const posted: PostedUpload[] = [];
  const uploader = new AttachmentUpload({
    api: {
      uploadAttachment: async (fields, file) => {
        posted.push({ fields, file });
      },
    },
    settings: () => ({ vaultId: "vault-1", syncAttachmentsOnMobile: false }),
    isMobile: () => false,
  });
  const [moc] = await vault.readMany([MOC]);

  return { fixture, posted, uploader, attachments: moc.attachments };
}
