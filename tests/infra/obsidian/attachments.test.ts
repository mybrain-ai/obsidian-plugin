import assert from "node:assert/strict";
import { test } from "node:test";

import { AttachmentHashCache } from "@/infra/obsidian/attachments";

import { PDF, createFixtureVault } from "@test/support/fixture-vault";

test("the hash cache reads a file once while its mtime and size stay the same", async () => {
  const vault = createFixtureVault();
  const file = vault.file(PDF);
  let reads = 0;
  const readBinary = vault.app.vault.readBinary.bind(vault.app.vault);

  vault.app.vault.readBinary = async (f) => {
    reads += 1;

    return await readBinary(f);
  };

  const cache = new AttachmentHashCache();
  const first = await cache.hash(vault.app, file);

  assert.equal(await cache.hash(vault.app, file), first);
  assert.equal(reads, 1);

  file.stat = { ...file.stat, mtime: file.stat.mtime + 1 };
  await cache.hash(vault.app, file);

  assert.equal(reads, 2);
});
