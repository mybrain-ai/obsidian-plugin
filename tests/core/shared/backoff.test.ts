import assert from "node:assert/strict";
import { test } from "node:test";

import { nextBackoffDelay } from "@/core/shared/backoff";

const schedule = [100, 200, 400];

test("returns the schedule entry for the attempt", () => {
  assert.equal(nextBackoffDelay(0, schedule), 100);
  assert.equal(nextBackoffDelay(1, schedule), 200);
});

test("an attempt past the schedule clamps to the last delay", () => {
  assert.equal(nextBackoffDelay(99, schedule), 400);
});

test("a negative attempt clamps to the first delay", () => {
  assert.equal(nextBackoffDelay(-3, schedule), 100);
});

test("with jitter the delay lies in [base, base * 1.5)", () => {
  for (let i = 0; i < 200; i++) {
    const delay = nextBackoffDelay(1, schedule, { jitter: true });

    assert.ok(delay >= 200 && delay < 300, String(delay));
  }
});
