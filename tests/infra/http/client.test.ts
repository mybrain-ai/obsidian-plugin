import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { HttpError, TokenRejectedError } from "@/core/errors";
import { getJson, postJson, postMultipart } from "@/infra/http/client";
import type { Connection } from "@/infra/http/types";

import { setFakeServer } from "@test/stubs/obsidian";
import type { FakeRequest } from "@test/support/types";

const AUTH: Connection = {
  endpoint: "https://api.example.test",
  token: "tok-1",
  deviceId: "dev-1",
  pluginVersion: "9.9.9",
};

afterEach(() => setFakeServer(null));

test("every request carries the token, device id and plugin version", async () => {
  const seen = _capture(200, { ok: true });

  await postJson(AUTH, "/ingest", { a: 1 });
  await getJson(AUTH, "/ping");

  assert.equal(seen.length, 2);

  for (const request of seen) {
    assert.equal(request.headers?.Authorization, "Bearer tok-1");
    assert.equal(request.headers?.["X-MyBrain-Device-Id"], "dev-1");
    assert.equal(request.headers?.["X-MyBrain-Plugin-Version"], "9.9.9");
    assert.equal(request.throw, false);
  }

  assert.equal(seen[0].url, "https://api.example.test/ingest");
  assert.equal(seen[0].method, "POST");
  assert.equal(seen[0].headers?.["Content-Type"], "application/json");
  assert.equal(seen[0].body, JSON.stringify({ a: 1 }));
  assert.equal(seen[1].method, "GET");
});

test("a 401 is a token rejection", async () => {
  _capture(401);

  await assert.rejects(postJson(AUTH, "/ingest", {}), TokenRejectedError);
});

test("a 422 is an HttpError carrying the status", async () => {
  _capture(422, { detail: "bad" });

  await assert.rejects(
    getJson(AUTH, "/ping"),
    (e: unknown) => e instanceof HttpError && e.status === 422,
  );
});

test("an empty body reads as undefined", async () => {
  _capture(204);

  assert.equal(await getJson(AUTH, "/ping"), undefined);
});

test("multipart escapes CR/LF in fields and quotes in the file name", async () => {
  const seen = _capture(200);

  await postMultipart({
    connection: AUTH,
    path: "/attachments",
    fields: { "na\r\nme": "va\r\nlue" },
    file: {
      name: 'a"b\\c\r\n.pdf',
      bytes: new Uint8Array([1, 2]).buffer,
      contentType: "application/pdf",
    },
  });

  const text = _decode(seen[0].body);

  assert.match(
    seen[0].headers?.["Content-Type"] ?? "",
    /^multipart\/form-data; boundary=----mybrain-/,
  );
  assert.ok(text.includes('name="name"\r\n\r\nvalue\r\n'));
  assert.ok(text.includes('filename="a\\"b\\\\c.pdf"'));
  assert.ok(text.includes("Content-Type: application/pdf\r\n\r\n"));
});

test("a content type with a control character becomes octet-stream", async () => {
  const seen = _capture(200);

  await postMultipart({
    connection: AUTH,
    path: "/attachments",
    fields: {},
    file: {
      name: "x.bin",
      bytes: new ArrayBuffer(0),
      contentType: "text/plain\u0000x",
    },
  });

  assert.ok(
    _decode(seen[0].body).includes("Content-Type: application/octet-stream"),
  );
});

function _capture(status = 200, json?: unknown) {
  const seen: FakeRequest[] = [];

  setFakeServer((request) => {
    seen.push(request);

    return { status, json };
  });

  return seen;
}

function _decode(body: string | ArrayBuffer | undefined): string {
  return new TextDecoder().decode(body as ArrayBuffer);
}
