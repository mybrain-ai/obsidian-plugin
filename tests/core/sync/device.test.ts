import assert from "node:assert/strict";
import { test } from "node:test";

import { DEVICE_ID_KEY } from "@/core/constants";
import { getOrCreateDeviceId } from "@/core/sync/device";

import { MemoryDeviceStore } from "@test/support/fakes";

test("an existing device id is reused", () => {
  assert.equal(
    getOrCreateDeviceId(new MemoryDeviceStore({ [DEVICE_ID_KEY]: "abc" })),
    "abc",
  );
});

test("a missing device id is created once and saved", () => {
  const store = new MemoryDeviceStore();
  const id = getOrCreateDeviceId(store);

  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.equal(store.load(DEVICE_ID_KEY), id);
  assert.equal(getOrCreateDeviceId(store), id);
});
