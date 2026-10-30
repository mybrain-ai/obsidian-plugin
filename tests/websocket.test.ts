import assert from "node:assert/strict";
import { test } from "node:test";
import { parseServerMessage } from "@/websocket";

test("content_requested with request_id and a list of paths", () => {
  assert.deepEqual(
    parseServerMessage(
      JSON.stringify({ type: "content_requested", request_id: "r1", paths: ["a.md", "b.md"] }),
    ),
    { type: "content_requested", requestId: "r1", paths: ["a.md", "b.md"] },
  );
});

test("content_requested also takes {path} items and requestId", () => {
  assert.deepEqual(
    parseServerMessage(
      JSON.stringify({
        type: "content_requested",
        requestId: "r2",
        paths: [{ path: "a.md", hash: "x" }, "b.md", 3],
      }),
    ),
    { type: "content_requested", requestId: "r2", paths: ["a.md", "b.md"] },
  );
});

test("content_requested without an id is ignored", () => {
  assert.equal(
    parseServerMessage(JSON.stringify({ type: "content_requested", paths: ["a.md"] })),
    null,
  );
});

test("existing messages still parse", () => {
  assert.deepEqual(parseServerMessage('{"type":"manifest_request"}'), {
    type: "manifest_request",
  });
  assert.deepEqual(parseServerMessage('{"type":"scope_changed","folders":["/"]}'), {
    type: "scope_changed",
    folders: ["/"],
  });
});
