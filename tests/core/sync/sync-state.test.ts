import assert from "node:assert/strict";
import { test } from "node:test";

import { SyncState } from "@/core/sync/sync-state";

test("listeners hear the first begin and the last end only", () => {
  const state = new SyncState();
  const seen: boolean[] = [];

  state.onChange(() => seen.push(state.isSyncing()));

  state.begin();
  state.begin();
  state.end();

  assert.deepEqual(seen, [true]);
  assert.equal(state.isSyncing(), true);

  state.end();

  assert.deepEqual(seen, [true, false]);
  assert.equal(state.isSyncing(), false);
});

test("an extra end never drops the counter below idle", () => {
  const state = new SyncState();

  state.end();
  state.begin();

  assert.equal(state.isSyncing(), true);
});

test("a failing sync-state listener does not stop the others", async () => {
  const state = new SyncState();
  let called = false;

  state.onChange(() => {
    throw new Error("boom");
  });

  const off = state.onChange(() => {
    called = true;
  });

  state.begin();

  assert.equal(called, true);

  called = false;
  off();
  state.end();

  assert.equal(called, false);
  assert.equal(state.isSyncing(), false);
});
