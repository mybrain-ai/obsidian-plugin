import assert from "node:assert/strict";
import { test } from "node:test";

import { sha256 } from "@/core/shared/hash";

const ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

test("a string is hashed as UTF-8, in lowercase hex", async () => {
  assert.equal(await sha256("abc"), ABC);
});

test("bytes hash the same as the string they encode", async () => {
  const bytes = new TextEncoder().encode("abc");

  assert.equal(await sha256(bytes.buffer), ABC);
});
