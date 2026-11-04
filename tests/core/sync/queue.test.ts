import assert from "node:assert/strict";
import { test } from "node:test";

import {
  QUEUE_CAP,
  ackBatch,
  emptyState,
  enqueue,
  failBatch,
  isQueueState,
  nextBatch,
} from "@/core/sync/queue";
import type { IngestEvent, UpsertEventV2 } from "@/core/sync/types";

test("isQueueState accepts a queue and refuses anything the queue code would crash on", () => {
  assert.equal(isQueueState(emptyState()), true);
  assert.equal(isQueueState(enqueue(emptyState(), _del("a.md"))), true);

  for (const broken of [
    null,
    "queue",
    {},
    { events: {}, attemptCount: 0, nextAttemptAt: 0 },
    { events: [null], attemptCount: 0, nextAttemptAt: 0 },
    { events: ["a.md"], attemptCount: 0, nextAttemptAt: 0 },
    { events: [], nextAttemptAt: 0 },
    { events: [], attemptCount: 0, nextAttemptAt: "0" },
  ]) {
    assert.equal(isQueueState(broken), false, JSON.stringify(broken));
  }
});

test("enqueue keeps only the newest events past the cap", () => {
  let state = emptyState();

  for (let i = 0; i < QUEUE_CAP + 3; i++) state = enqueue(state, _del(`n${i}`));

  assert.equal(QUEUE_CAP, 5000);
  assert.equal(state.events.length, QUEUE_CAP);
  assert.deepEqual(state.events[0], _del("n3"));
  assert.deepEqual(state.events.at(-1), _del(`n${QUEUE_CAP + 2}`));
});

test("enqueue replaces a pending event for the same path and resets backoff", () => {
  let state = enqueue(emptyState(), _del("a.md"));

  state = failBatch(state, 1000);
  state = enqueue(state, _del("b.md"));
  state = enqueue(state, _del("a.md"));

  assert.deepEqual(state.events, [_del("b.md"), _del("a.md")]);
  assert.equal(state.attemptCount, 0);
  assert.equal(state.nextAttemptAt, 0);
});

test("enqueue keeps a rename and only dedupes an identical one", () => {
  const rename: IngestEvent = { op: "rename", oldPath: "a", newPath: "b" };

  let state = enqueue(emptyState(), rename);

  state = enqueue(state, _del("b"));
  state = enqueue(state, rename);

  assert.deepEqual(state.events, [_del("b"), rename]);
});

test("nextBatch returns nothing before nextAttemptAt, then up to size", () => {
  let state = emptyState();

  for (let i = 0; i < 5; i++) state = enqueue(state, _del(`n${i}`));

  state = { ...state, nextAttemptAt: 5000 };

  assert.deepEqual(nextBatch(state, 50, 4999), []);
  assert.equal(nextBatch(state, 50, 5000).length, 5);
  assert.equal(nextBatch(state, 2, 5000).length, 2);
  assert.deepEqual(nextBatch(emptyState(), 50, 0), []);
});

test("failBatch delays follow 1 s, 5 s, 30 s, 5 min, 1 h (with up to 50% jitter)", () => {
  const schedule = [1_000, 5_000, 30_000, 300_000, 3_600_000];

  let state = enqueue(emptyState(), _del("a.md"));

  for (const base of [...schedule, schedule.at(-1) as number]) {
    state = failBatch(state, 0);

    assert.ok(state.nextAttemptAt >= base, `${state.nextAttemptAt} >= ${base}`);
    assert.ok(state.nextAttemptAt < base * 1.5);
  }

  assert.equal(state.attemptCount, 6);
});

test("ackBatch drops the events sent and resets attempts", () => {
  let state = emptyState();

  for (const p of ["a", "b", "c"]) state = enqueue(state, _del(p));

  const sent = nextBatch(state, 2, 0);

  state = failBatch(state, 10);
  state = ackBatch(state, sent);

  assert.deepEqual(state.events, [_del("c")]);
  assert.equal(state.attemptCount, 0);
  assert.equal(state.nextAttemptAt, 0);
});

test("an event queued while its batch is sent outlives the batch's ack", () => {
  let state = enqueue(emptyState(), _upsert("a.md", "v2"));

  state = enqueue(state, _upsert("b.md", "b1"));
  const sent = nextBatch(state, 50, 0);

  // The note is saved again before the server answers.
  state = enqueue(state, _upsert("a.md", "v3"));
  state = ackBatch(state, sent);

  assert.deepEqual(state.events, [_upsert("a.md", "v3")]);
});

function _del(path: string): IngestEvent {
  return { op: "delete", path };
}

function _upsert(path: string, hash: string): UpsertEventV2 {
  return {
    op: "upsert",
    path,
    name: path,
    ext: "md",
    size: 1,
    ctime: 1,
    mtime: 1,
    hash,
    words: 1,
    frontmatter: null,
    tags: [],
    links: [],
    unresolved: [],
    embeds: [],
    attachments: [],
  };
}
