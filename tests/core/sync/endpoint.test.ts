import assert from "node:assert/strict";
import { test } from "node:test";

import { parseHttpsEndpoint } from "@/core/sync/endpoint";

test("an https endpoint loses its trailing slash", () => {
  assert.equal(
    parseHttpsEndpoint("https://api.example/obsidian/")?.href,
    "https://api.example/obsidian",
  );
});

test("http is accepted only for loopback hosts", () => {
  assert.notEqual(parseHttpsEndpoint("http://localhost:8000"), null);
  assert.notEqual(parseHttpsEndpoint("http://127.0.0.1:8000"), null);
  assert.equal(parseHttpsEndpoint("http://api.example"), null);
});

test("other protocols and junk are refused", () => {
  assert.equal(parseHttpsEndpoint("ftp://api.example"), null);
  assert.equal(parseHttpsEndpoint("not a url"), null);
});
