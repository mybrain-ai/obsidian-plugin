import assert from "node:assert/strict";
import { test } from "node:test";

import { compareVersions } from "@/core/update/version";

test("compares segments numerically", () => {
  assert.equal(compareVersions("1.0.2", "1.0.10"), -1);
  assert.equal(compareVersions("1.0.10", "1.0.2"), 1);
});

test("missing segments count as 0", () => {
  assert.equal(compareVersions("1.2", "1.2.0"), 0);
});

test("non-numeric segments count as 0", () => {
  assert.equal(compareVersions("x", "0"), 0);
});
