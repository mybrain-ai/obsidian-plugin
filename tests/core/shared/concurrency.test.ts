import assert from "node:assert/strict";
import { test } from "node:test";

import { mapWithConcurrency } from "@/core/shared/concurrency";

test("mapWithConcurrency keeps the input order", async () => {
  const out = await mapWithConcurrency([30, 1, 10], 2, async (ms) => {
    await new Promise((resolve) => setTimeout(resolve, ms));

    return ms;
  });

  assert.deepEqual(out, [30, 1, 10]);
});
