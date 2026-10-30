import assert from "node:assert/strict";
import { test } from "node:test";
import { HttpError } from "@/network";
import { materializeEvents, pushNegotiatedManifest } from "@/sync-protocol";
import type { IngestEvent, UpsertEvent, UpsertEventV2 } from "@/types";

function recorder() {
  const calls: string[] = [];
  const logs: string[] = [];
  return { calls, logs, log: (m: string) => logs.push(m) };
}

test("a server with protocol 2 gets only the metadata manifest", async () => {
  const r = recorder();

  const outcome = await pushNegotiatedManifest({
    sendV2: async () => void r.calls.push("v2"),
    sendV1: async () => void r.calls.push("v1"),
    fallbackToV1: true,
    log: r.log,
  });

  assert.deepEqual(outcome, { protocol: 2, sent: true });
  assert.deepEqual(r.calls, ["v2"]);
});

for (const status of [400, 422]) {
  test(`an old server (${status} on v2) falls back to the v1 manifest and logs it`, async () => {
    const r = recorder();

    const outcome = await pushNegotiatedManifest({
      sendV2: async () => {
        r.calls.push("v2");
        throw new HttpError(status);
      },
      sendV1: async () => void r.calls.push("v1"),
      fallbackToV1: true,
      log: r.log,
    });

    assert.deepEqual(outcome, { protocol: 1, sent: true });
    assert.deepEqual(r.calls, ["v2", "v1"]);
    assert.equal(r.logs.length, 1);
  });
}

test("probing without fallback learns protocol 1 and sends no text", async () => {
  const r = recorder();

  const outcome = await pushNegotiatedManifest({
    sendV2: async () => {
      throw new HttpError(422);
    },
    sendV1: async () => void r.calls.push("v1"),
    fallbackToV1: false,
    log: r.log,
  });

  assert.deepEqual(outcome, { protocol: 1, sent: false });
  assert.deepEqual(r.calls, []);
});

test("a server error is not mistaken for an old server", async () => {
  const r = recorder();

  await assert.rejects(
    pushNegotiatedManifest({
      sendV2: async () => {
        throw new HttpError(500);
      },
      sendV1: async () => void r.calls.push("v1"),
      fallbackToV1: true,
      log: r.log,
    }),
    HttpError,
  );
  assert.deepEqual(r.calls, []);
});

const v2 = (path: string): UpsertEventV2 => ({
  op: "upsert",
  path,
  name: path,
  ext: "md",
  size: 1,
  ctime: 1,
  mtime: 1,
  hash: `v2-${path}`,
  words: 1,
  frontmatter: null,
  tags: [],
  links: [],
  unresolved: [],
  embeds: [],
  attachments: [],
});

const v1 = (path: string): UpsertEvent => ({
  op: "upsert",
  path,
  name: path,
  ext: "md",
  content: `text of ${path}`,
  frontmatter: null,
  mtime: 1,
  size: 1,
  hash: `v1-${path}`,
  wikilinks: [],
  mdLinks: [],
  attachments: [],
});

const rebuild = {
  v1: async (path: string) => (path === "gone.md" ? null : v1(path)),
  v2: async (path: string) => (path === "gone.md" ? null : v2(path)),
};

test("protocol 2: queued text from 1.0.x is rebuilt as metadata", async () => {
  const queued: IngestEvent[] = [
    v1("old.md"),
    v2("new.md"),
    { op: "delete", path: "x.md" },
    { op: "rename", oldPath: "a.md", newPath: "b.md" },
    v1("gone.md"),
  ];

  const out = await materializeEvents(queued, 2, rebuild);

  assert.deepEqual(out, [
    v2("old.md"),
    v2("new.md"),
    { op: "delete", path: "x.md" },
    { op: "rename", oldPath: "a.md", newPath: "b.md" },
  ]);
  assert.equal(JSON.stringify(out).includes("text of"), false);
});

test("protocol 1: metadata events get their text back for an old server", async () => {
  const out = await materializeEvents([v2("n.md"), v1("m.md")], 1, rebuild);

  assert.deepEqual(out, [v1("n.md"), v1("m.md")]);
});
