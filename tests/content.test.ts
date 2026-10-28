import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import type { TFile } from "obsidian";
import type { ResolvedAttachment } from "@/attachments";
import {
  buildContentBody,
  ContentRequestQueue,
  type ContentQueueDeps,
  type ContentReadResult,
} from "@/content";
import { HttpError } from "@/network";
import type { ContentMissing, ContentNote, ContentResponse } from "@/types";
import { readNoteContent } from "@/vault-metadata";
import {
  createFixtureVault,
  DAILY,
  DAILY_CONTENT,
  MOC,
  PDF,
  TEMPLATE,
  VAULT_ENVELOPE,
} from "./fixture-vault";
import { createVault, type TestVault } from "./vault";

const FIXTURE = "tests/fixtures/obsidian/content_v2.json";

type Sent = { notes: ContentNote[]; missing: ContentMissing[] };

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function reader(vault: TestVault, scope: (path: string) => boolean) {
  return async (path: string): Promise<ContentReadResult<ResolvedAttachment>> => {
    const file = vault.app.vault.getAbstractFileByPath(path) as TFile | null;
    if (!file || file.extension !== "md") return { kind: "missing", reason: "not_found" };
    if (!scope(path)) return { kind: "missing", reason: "out_of_scope" };
    const read = await readNoteContent(vault.app, file);
    return { kind: "note", note: read.note, resolved: read.resolved };
  };
}

function harness(
  vault: TestVault,
  overrides: Partial<ContentQueueDeps<ResolvedAttachment>> = {},
  scope: (path: string) => boolean = () => true,
) {
  const sent: Sent[] = [];
  const uploads: string[][] = [];
  const timers: Array<() => void> = [];
  let response: ContentResponse = { accepted: 0, rejected: [], attachmentsNeeded: [] };

  const queue = new ContentRequestQueue<ResolvedAttachment>({
    read: reader(vault, scope),
    send: async (notes, missing) => {
      sent.push({ notes, missing });
      return response;
    },
    uploadAttachments: async (hashes) => {
      uploads.push(hashes);
    },
    onTokenRejected: () => {},
    setTimer: (fn) => timers.push(fn),
    clearTimer: () => {},
    ...overrides,
  });

  return {
    queue,
    sent,
    uploads,
    timers,
    respond: (r: ContentResponse) => {
      response = r;
    },
  };
}

function bigVault(count: number): TestVault {
  return createVault({
    notes: Array.from({ length: count }, (_, i) => ({
      path: `Notas/nota-${String(i).padStart(3, "0")}.md`,
      content: `Texto da nota ${i}.\n`,
      ctime: 1,
      mtime: 1,
    })),
  });
}

test("a request for 10 notes sends exactly those 10", async () => {
  const vault = bigVault(120);
  const h = harness(vault);
  const wanted = Array.from({ length: 10 }, (_, i) => `Notas/nota-${String(i * 7).padStart(3, "0")}.md`);

  h.queue.request("req-1", wanted);
  await h.queue.run();

  assert.equal(h.sent.length, 1);
  assert.deepEqual(
    h.sent[0].notes.map((n) => n.path),
    wanted,
  );
  assert.ok(h.sent[0].notes.every((n) => n.requestId === "req-1"));
  assert.deepEqual(h.sent[0].missing, []);
  assert.equal(h.queue.size, 0);
});

test("requests go out in batches of 50", async () => {
  const vault = bigVault(120);
  const h = harness(vault);

  h.queue.request("req-1", vault.markdownFiles().map((f) => f.path));
  await h.queue.run();

  assert.deepEqual(
    h.sent.map((s) => s.notes.length),
    [50, 50, 20],
  );
});

const EDITED = "Dia longo, muita coisa.\n";

test("a note edited after the request goes with its new hash", async () => {
  const vault = createFixtureVault();
  const h = harness(vault);

  // The request lands, the note changes before the plugin reads it.
  h.queue.request("req-1", [DAILY]);
  vault.edit(DAILY, EDITED, 1761700000000);
  await h.queue.run();
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].notes[0].content, EDITED);
  assert.equal(h.sent[0].notes[0].hash, sha256(EDITED));
  assert.notEqual(EDITED, DAILY_CONTENT);
});

test("deleted and out-of-scope notes are reported as missing, never sent", async () => {
  const vault = createFixtureVault();
  vault.remove(DAILY);
  const h = harness(vault, {}, (path) => !path.startsWith("Templates/"));

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

test("a path asked twice is sent once, under the newest request id", async () => {
  const vault = bigVault(3);
  const h = harness(vault);
  const paths = vault.markdownFiles().map((f) => f.path);

  h.queue.request("old", [paths[0], paths[1]]);
  h.queue.request("new", [paths[1], paths[2]]);
  await h.queue.run();
  await new Promise((r) => setTimeout(r, 0));

  const all = h.sent.flatMap((s) => s.notes.map((n) => `${n.requestId}:${n.path}`));
  assert.deepEqual(all, [`old:${paths[0]}`, `new:${paths[1]}`, `new:${paths[2]}`]);
});

test("attachments the server asks for are uploaded after the batch", async () => {
  const vault = createFixtureVault();
  const h = harness(vault);
  const pdfHash = createHash("sha256").update("%PDF-1.7 fixture").digest("hex");

  h.respond({ accepted: 1, rejected: [], attachmentsNeeded: [pdfHash] });
  h.queue.request("req-1", [MOC]);
  await h.queue.run();

  assert.deepEqual(h.sent[0].notes[0].attachments.map((a) => a.path), [PDF]);
  assert.deepEqual(h.uploads, [[pdfHash]]);
});

test("a network failure keeps the batch for a retry", async () => {
  const vault = bigVault(2);
  let fail = true;
  const sent: string[] = [];
  const h = harness(vault, {
    send: async (notes) => {
      if (fail) throw new Error("offline");
      sent.push(...notes.map((n) => n.path));
      return undefined;
    },
  });

  h.queue.request("req-1", vault.markdownFiles().map((f) => f.path));
  await h.queue.run();

  assert.equal(sent.length, 0);
  assert.equal(h.queue.size, 2);
  assert.equal(h.timers.length, 1);

  fail = false;
  h.timers[0]();
  // The retry runs on its own; wait for it to drain (hashing is async).
  for (let i = 0; i < 100 && h.queue.size > 0; i++) {
    await new Promise((r) => setTimeout(r, 5));
  }

  assert.equal(sent.length, 2);
  assert.equal(h.queue.size, 0);
});

test("a refused batch (409) is dropped, not retried", async () => {
  const vault = bigVault(2);
  const h = harness(vault, {
    send: async () => {
      throw new HttpError(409);
    },
  });

  h.queue.request("req-1", vault.markdownFiles().map((f) => f.path));
  await h.queue.run();

  assert.equal(h.queue.size, 0);
  assert.equal(h.timers.length, 0);
});

test("content body matches the contract fixture byte for byte", async () => {
  const vault = createFixtureVault();
  vault.remove(DAILY);
  const h = harness(vault);

  h.queue.request("6f1c2b9e-0d4a-4c1e-9a57-2b8e3f0c1d22", [MOC, DAILY]);
  await h.queue.run();

  const body = buildContentBody(
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
