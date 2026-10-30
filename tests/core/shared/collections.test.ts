import assert from "node:assert/strict";
import { test } from "node:test";

import { uniq } from "@/core/shared/collections";

test("uniq drops repeats and keeps the first-seen order", () => {
  assert.deepEqual(uniq(["b", "a", "b", "c", "a"]), ["b", "a", "c"]);
  assert.deepEqual(uniq([]), []);
});
