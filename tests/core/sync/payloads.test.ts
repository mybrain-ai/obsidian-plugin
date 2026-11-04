import assert from "node:assert/strict";
import { test } from "node:test";

import {
  contentBody,
  contentNoteFields,
  envelope,
  ingestBody,
  manifestFileV1,
  manifestV1Body,
  upsertV1,
  upsertV2,
} from "@/core/sync/payloads";
import type { AttachmentRef, NoteSnapshot } from "@/core/sync/types";

import { resolved } from "@test/support/fakes";

const REF: AttachmentRef = {
  path: "Files/a.pdf",
  ext: "pdf",
  size: 3,
  mtime: 4,
  hash: "ah",
};

const SNAPSHOT: NoteSnapshot = {
  path: "A/b.md",
  basename: "b",
  ctime: 1,
  mtime: 2,
  size: 5,
  content: "hello [[c]]",
  hash: "h",
  frontmatter: { title: "T" },
  frontmatterEnd: 10,
  tags: ["x"],
  resolvedLinks: { "c.md": 1 },
  unresolvedLinks: {},
  wikilinks: ["c"],
  mdLinks: ["d.md"],
  embeds: ["Files/a.pdf"],
  attachments: [resolved(REF)],
};

const ENV = { vaultId: "v1", vaultName: "Vault", clientTime: "t" };

test("envelope stamps the client time from the given date", () => {
  assert.deepEqual(envelope("v1", "Vault", new Date(0)), {
    vaultId: "v1",
    vaultName: "Vault",
    clientTime: "1970-01-01T00:00:00.000Z",
  });
  assert.deepEqual(Object.keys(envelope("v1", "Vault", new Date(0))), [
    "vaultId",
    "vaultName",
    "clientTime",
  ]);
});

test("a protocol 2 ingest body starts with the protocol key", () => {
  const json = JSON.stringify(ingestBody([], 2, ENV));

  assert.ok(json.startsWith('{"protocol":2,"apiVersion":1,"vaultId"'));
  assert.deepEqual(Object.keys(ingestBody([], 2, ENV)), [
    "protocol",
    "apiVersion",
    "vaultId",
    "vaultName",
    "clientTime",
    "events",
  ]);
});

test("a protocol 1 ingest body has no protocol key", () => {
  assert.deepEqual(Object.keys(ingestBody([], 1, ENV)), [
    "apiVersion",
    "vaultId",
    "vaultName",
    "clientTime",
    "events",
  ]);
});

test("upsertV1 carries the text and every frontmatter key", () => {
  const event = upsertV1(SNAPSHOT);

  assert.equal(event.content, "hello [[c]]");
  assert.deepEqual(event.frontmatter, { title: "T" });
  assert.deepEqual(Object.keys(event), [
    "op",
    "path",
    "name",
    "ext",
    "content",
    "frontmatter",
    "mtime",
    "size",
    "hash",
    "wikilinks",
    "mdLinks",
    "attachments",
  ]);
});

test("upsertV1 keeps a null frontmatter null", () => {
  assert.equal(upsertV1({ ...SNAPSHOT, frontmatter: null }).frontmatter, null);
});

test("upsertV2 never carries the text", () => {
  const event = upsertV2(SNAPSHOT);

  assert.equal("content" in event, false);
  assert.equal(event.op, "upsert");
});

test("a protocol 1 manifest file has the upsert fields without the links", () => {
  assert.deepEqual(Object.keys(manifestFileV1(SNAPSHOT)), [
    "path",
    "name",
    "ext",
    "content",
    "frontmatter",
    "mtime",
    "size",
    "hash",
    "attachments",
  ]);
});

test("a protocol 1 manifest body keeps the key order", () => {
  const folders = [{ path: "A", name: "A", parent: null }];
  const body = manifestV1Body([SNAPSHOT], folders, ENV);

  assert.deepEqual(Object.keys(body), [
    "apiVersion",
    "vaultId",
    "vaultName",
    "clientTime",
    "files",
    "folders",
  ]);
  assert.deepEqual(body.files, [manifestFileV1(SNAPSHOT)]);
  assert.equal(body.folders, folders);
});

test("a content body keeps the key order", () => {
  assert.deepEqual(Object.keys(contentBody(ENV, [], [])), [
    "protocol",
    "vaultId",
    "vaultName",
    "clientTime",
    "notes",
    "missing",
  ]);
});

test("a requested note keeps the text as read and the key order", () => {
  const note = { requestId: "req-1", ...contentNoteFields(SNAPSHOT) };

  assert.deepEqual(Object.keys(note), [
    "requestId",
    "path",
    "hash",
    "content",
    "attachments",
  ]);
  assert.equal(note.requestId, "req-1");
  assert.equal(note.content, "hello [[c]]");
});
