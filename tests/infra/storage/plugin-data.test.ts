import assert from "node:assert/strict";
import { test } from "node:test";

import { emptyState } from "@/core/sync/queue";
import { defaultSettings } from "@/core/sync/settings";
import type { IngestEvent, StoredData } from "@/core/sync/types";
import { PluginDataStore } from "@/infra/storage/plugin-data";

test("a data file with only settings gets an empty queue", async () => {
  const { data } = _store({ settings: { endpoint: "https://x.test" } });
  const loaded = await data.load();

  assert.deepEqual(loaded.queue, emptyState());
  assert.equal(loaded.settings.endpoint, "https://x.test");
});

test("settings missing newer keys get the defaults", async () => {
  const { data } = _store({ settings: { token: "t" } });
  const loaded = await data.load();

  assert.deepEqual(loaded.settings, { ...defaultSettings(), token: "t" });
});

test("no data file at all loads defaults and an empty queue", async () => {
  const { data } = _store(null);

  assert.deepEqual(await data.load(), {
    settings: defaultSettings(),
    queue: emptyState(),
  });
});

test("two loads never share the default folder list", async () => {
  const first = await _store(null).data.load();
  const second = await _store(null).data.load();

  first.settings.inScopeFolders.push("A");

  assert.deepEqual(second.settings.inScopeFolders, []);
  assert.deepEqual(defaultSettings().inScopeFolders, []);
});

test("a stored queue holding a protocol 1 upsert loads unchanged", async () => {
  const event = {
    type: "upsert",
    path: "a.md",
    content: "# text",
  } as unknown as IngestEvent;
  const queue = { events: [event], attemptCount: 2, nextAttemptAt: 99 };
  const { data } = _store({ settings: {}, queue });

  assert.deepEqual((await data.load()).queue, queue);
});

for (const [label, queue] of [
  ["an object without events", {}],
  ["a string", "broken"],
  [
    "events that are not objects",
    { events: [null], attemptCount: 0, nextAttemptAt: 0 },
  ],
  ["a missing attempt count", { events: [], nextAttemptAt: 0 }],
] as const) {
  test(`a stored queue that is ${label} loads as an empty queue, settings kept`, async () => {
    const { data } = _store({ settings: { token: "t" }, queue });
    const loaded = await data.load();

    assert.deepEqual(loaded.queue, emptyState());
    assert.equal(loaded.settings.token, "t");
  });
}

test("save writes settings and queue exactly", async () => {
  const { data, saved } = _store(null);
  const value: StoredData = {
    settings: { ...defaultSettings(), token: "t" },
    queue: emptyState(),
  };

  await data.save(value);

  assert.deepEqual(saved, [{ settings: value.settings, queue: value.queue }]);
  assert.deepEqual(Object.keys(saved[0] as object), ["settings", "queue"]);
});

function _store(initial: unknown) {
  const saved: unknown[] = [];
  const data = new PluginDataStore(
    async () => initial,
    async (value) => void saved.push(value),
  );

  return { data, saved };
}
