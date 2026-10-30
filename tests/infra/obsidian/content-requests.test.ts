import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { test } from "node:test";

import { ContentRequestQueue } from "@/core/content/content-queue";
import { readRequestedNote } from "@/core/content/read-requested-note";
import type { ContentReadResult } from "@/core/content/types";
import { contentBody } from "@/core/sync/payloads";
import type { IngestResponse } from "@/core/sync/types";
import { ObsidianVault } from "@/infra/obsidian/vault";

import { FakeTimers, settle } from "@test/support/fakes";
import {
  DAILY,
  DAILY_CONTENT,
  MOC,
  PDF,
  TEMPLATE,
  VAULT_ENVELOPE,
  createFixtureVault,
} from "@test/support/fixture-vault";
import type { SentContent, TestVault } from "@test/support/types";

const FIXTURE = "tests/fixtures/obsidian/content_v2.json";
const EDITED = "Dia longo, muita coisa.\n";

test("a note edited after the request goes with its new hash", async () => {
  const vault = createFixtureVault();
  const h = _harness(_reader(vault, () => true));

  // The request lands, the note changes before the plugin reads it.
  h.queue.request("req-1", [DAILY]);
  vault.edit(DAILY, EDITED, 1761700000000);
  await h.queue.run();
  await settle(1);

  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].notes[0].content, EDITED);
  assert.equal(h.sent[0].notes[0].hash, _sha256(EDITED));
  assert.notEqual(EDITED, DAILY_CONTENT);
});

test("deleted and out-of-scope notes are reported as missing, never sent", async () => {
  const vault = createFixtureVault();

  vault.remove(DAILY);
  const h = _harness(_reader(vault, (path) => !path.startsWith("Templates/")));

  h.queue.request("req-9", [DAILY, TEMPLATE, MOC]);
  await h.queue.run();

  assert.deepEqual(
    h.sent[0].notes.map((n) => n.path),
    [MOC],
  );
  assert.deepEqual(h.sent[0].missing, [
    { requestId: "req-9", path: DAILY, reason: "not_found" },
    { requestId: "req-9", path: TEMPLATE, reason: "out_of_scope" },
  ]);
});

test("attachments the server asks for are uploaded after the batch", async () => {
  const vault = createFixtureVault();
  const h = _harness(_reader(vault, () => true));
  const pdfHash = _sha256("%PDF-1.7 fixture");

  h.respond({ accepted: 1, rejected: [], attachmentsNeeded: [pdfHash] });
  h.queue.request("req-1", [MOC]);
  await h.queue.run();

  assert.deepEqual(
    h.sent[0].notes[0].attachments.map((a) => a.path),
    [PDF],
  );
  assert.deepEqual(h.uploads, [[pdfHash]]);
});

test("content body matches the contract fixture byte for byte", async () => {
  const vault = createFixtureVault();

  vault.remove(DAILY);
  const h = _harness(_reader(vault, () => true));

  h.queue.request("6f1c2b9e-0d4a-4c1e-9a57-2b8e3f0c1d22", [MOC, DAILY]);
  await h.queue.run();

  const body = contentBody(
    {
      vaultId: VAULT_ENVELOPE.vaultId,
      vaultName: VAULT_ENVELOPE.vaultName,
      clientTime: VAULT_ENVELOPE.clientTime,
    },
    h.sent[0].notes,
    h.sent[0].missing,
  );
  const json = `${JSON.stringify(body, null, 2)}\n`;

  if (process.env.UPDATE_FIXTURES === "1") writeFileSync(FIXTURE, json);

  assert.equal(json, readFileSync(FIXTURE, "utf8"));
});

function _sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function _reader(vault: TestVault, scope: (path: string) => boolean) {
  return (path: string): Promise<ContentReadResult> =>
    readRequestedNote(new ObsidianVault(vault.app), path, scope);
}

function _harness(read: (path: string) => Promise<ContentReadResult>) {
  const sent: SentContent[] = [];
  const uploads: string[][] = [];
  let response: IngestResponse = {
    accepted: 0,
    rejected: [],
    attachmentsNeeded: [],
  };

  const queue = new ContentRequestQueue({
    read,
    send: async (notes, missing) => {
      sent.push({ notes, missing });

      return response;
    },
    uploadAttachments: async (hashes) => {
      uploads.push(hashes);
    },
    onTokenRejected: () => {},
    timers: new FakeTimers(),
  });

  return {
    queue,
    sent,
    uploads,
    respond: (r: IngestResponse) => {
      response = r;
    },
  };
}
