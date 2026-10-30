import assert from "node:assert/strict";
import { test } from "node:test";

import { ContentRequestQueue } from "@/core/content/content-queue";
import type { ContentReadResult } from "@/core/content/types";
import { HttpError, TokenRejectedError } from "@/core/errors";
import type { ContentQueueDeps } from "@/core/ports";
import type { IngestResponse } from "@/core/sync/types";

import { FakeTimers, settle } from "@test/support/fakes";
import type { SentContent } from "@test/support/types";

test("a request for 10 notes sends exactly those 10", async () => {
  const paths = _notePaths(120);
  const h = _harness(_fakeRead(paths));
  const wanted = Array.from(
    { length: 10 },
    (_, i) => `Notas/nota-${String(i * 7).padStart(3, "0")}.md`,
  );

  h.queue.request("req-1", wanted);
  await h.queue.run();

  assert.equal(h.sent.length, 1);
  assert.deepEqual(
    h.sent[0].notes.map((n) => n.path),
    wanted,
  );
  assert.ok(h.sent[0].notes.every((n) => n.requestId === "req-1"));
  assert.deepEqual(h.sent[0].missing, []);
  assert.equal(h.queue.size, 0);
});

test("requests go out in batches of 50", async () => {
  const paths = _notePaths(120);
  const h = _harness(_fakeRead(paths));

  h.queue.request("req-1", paths);
  await h.queue.run();

  assert.deepEqual(
    h.sent.map((s) => s.notes.length),
    [50, 50, 20],
  );
});

test("a path asked twice is sent once, under the newest request id", async () => {
  const paths = _notePaths(3);
  const h = _harness(_fakeRead(paths));

  h.queue.request("old", [paths[0], paths[1]]);
  h.queue.request("new", [paths[1], paths[2]]);
  await h.queue.run();
  await settle(1);

  const all = h.sent.flatMap((s) =>
    s.notes.map((n) => `${n.requestId}:${n.path}`),
  );

  assert.deepEqual(all, [
    `old:${paths[0]}`,
    `new:${paths[1]}`,
    `new:${paths[2]}`,
  ]);
});

test("a network failure keeps the batch for a retry", async () => {
  const paths = _notePaths(2);
  let fail = true;
  const sent: string[] = [];
  const h = _harness(_fakeRead(paths), {
    send: async (notes) => {
      if (fail) throw new Error("offline");

      sent.push(...notes.map((n) => n.path));

      return undefined;
    },
  });

  h.queue.request("req-1", paths);
  await h.queue.run();

  assert.equal(sent.length, 0);
  assert.equal(h.queue.size, 2);
  assert.equal(h.timers.delays.length, 1);

  fail = false;
  await h.retry();

  assert.equal(sent.length, 2);
  assert.equal(h.queue.size, 0);
});

test("retries wait 1 s, 5 s, 30 s and 2 min, then give up until the next reconnect", async () => {
  const paths = _notePaths(2);
  const h = _harness(_fakeRead(paths), {
    send: async () => {
      throw new Error("offline");
    },
  });

  h.queue.request("req-1", paths);
  await h.queue.run();

  for (let i = 0; i < 4; i++) await h.retry();

  assert.deepEqual(h.timers.delays, [1_000, 5_000, 30_000, 120_000]);
  assert.equal(h.queue.size, 0);
});

test("a note that fails to read stays queued for the retry, never reported as not found", async () => {
  const paths = _notePaths(2);
  const [broken, fine] = paths;
  let failing = true;
  const h = _harness(_fakeRead(paths), {
    read: async (path) => {
      if (path === broken && failing) throw new Error("disk busy");

      return await _fakeRead(paths)(path);
    },
  });

  h.queue.request("req-1", [broken, fine]);
  await h.queue.run();

  assert.deepEqual(
    h.sent.map((s) => s.notes.map((n) => n.path)),
    [[fine]],
  );
  assert.deepEqual(h.sent[0].missing, []);
  assert.equal(h.queue.size, 1);

  failing = false;
  await h.retry();

  assert.deepEqual(
    h.sent[1].notes.map((n) => n.path),
    [broken],
  );
  assert.equal(h.queue.size, 0);
});

test("a rejected token drops the queue and reports it", async () => {
  const paths = _notePaths(2);
  let rejected = 0;
  const h = _harness(_fakeRead(paths), {
    send: async () => {
      throw new TokenRejectedError();
    },
    onTokenRejected: () => {
      rejected += 1;
    },
  });

  h.queue.request("req-1", paths);
  await h.queue.run();

  assert.equal(rejected, 1);
  assert.equal(h.queue.size, 0);
  assert.equal(h.timers.delays.length, 0);
});

test("stop() cancels a pending retry", async () => {
  const paths = _notePaths(1);
  const h = _harness(_fakeRead(paths), {
    send: async () => {
      throw new Error("offline");
    },
  });

  h.queue.request("req-1", [paths[0]]);
  await h.queue.run();
  h.queue.stop();

  assert.deepEqual(h.timers.cleared, [1]);
  assert.equal(h.queue.size, 0);
});

test("clear() drops queued requests and the queue keeps working", async () => {
  const paths = _notePaths(2);
  let fail = true;
  const h = _harness(_fakeRead(paths), {
    send: async (notes, missing) => {
      if (fail) throw new Error("offline");

      h.sent.push({ notes, missing });

      return undefined;
    },
  });
  const [a, b] = paths;

  h.queue.request("req-1", [a]);
  await h.queue.run();
  h.queue.clear();

  assert.deepEqual(h.timers.cleared, [1]);
  assert.equal(h.queue.size, 0);

  fail = false;
  h.queue.request("req-2", [b]);
  await h.queue.run();

  assert.deepEqual(
    h.sent.map((s) => s.notes.map((n) => n.path)),
    [[b]],
  );
});

test("a newer request for a path in flight keeps it queued", async () => {
  const paths = _notePaths(1);
  const [path] = paths;
  let h: ReturnType<typeof _harness>;
  let first = true;

  h = _harness(_fakeRead(paths), {
    send: async (notes, missing) => {
      if (first) {
        first = false;
        h.queue.request("req-2", [path]);
      }

      h.sent.push({ notes, missing });

      return undefined;
    },
  });

  h.queue.request("req-1", [path]);
  await h.queue.run();

  assert.deepEqual(
    h.sent.map((s) => s.notes.map((n) => n.requestId)),
    [["req-1"], ["req-2"]],
  );
  assert.equal(h.queue.size, 0);
});

test("a batch counts notes and missing together, 50 at most", async () => {
  const paths = _notePaths(49);
  const h = _harness(_fakeRead(paths));

  h.queue.request("req-1", [...paths, "gone-1.md", "gone-2.md"]);
  await h.queue.run();

  assert.deepEqual(
    h.sent.map((s) => s.notes.length + s.missing.length),
    [50, 1],
  );
});

test("a refused batch (409) is dropped, not retried", async () => {
  const paths = _notePaths(2);
  const h = _harness(_fakeRead(paths), {
    send: async () => {
      throw new HttpError(409);
    },
  });

  h.queue.request("req-1", paths);
  await h.queue.run();

  assert.equal(h.queue.size, 0);
  assert.equal(h.timers.delays.length, 0);
});

function _harness(
  read: (path: string) => Promise<ContentReadResult>,
  overrides: Partial<ContentQueueDeps> = {},
) {
  const sent: SentContent[] = [];
  const uploads: string[][] = [];
  const timers = new FakeTimers();
  let response: IngestResponse = {
    accepted: 0,
    rejected: [],
    attachmentsNeeded: [],
  };

  const queue = new ContentRequestQueue({
    read,
    send: async (notes, missing) => {
      sent.push({ notes, missing });

      return response;
    },
    uploadAttachments: async (hashes) => {
      uploads.push(hashes);
    },
    onTokenRejected: () => {},
    timers,
    ...overrides,
  });

  return {
    queue,
    sent,
    uploads,
    timers,
    retry: async () => {
      timers.fireAll();
      await queue.run();
    },
    respond: (r: IngestResponse) => {
      response = r;
    },
  };
}

function _notePaths(count: number): string[] {
  return Array.from(
    { length: count },
    (_, i) => `Notas/nota-${String(i).padStart(3, "0")}.md`,
  );
}

/** Reads from a plain list: a listed path is a note, any other is gone. */
function _fakeRead(paths: readonly string[]) {
  return async (path: string): Promise<ContentReadResult> =>
    paths.includes(path)
      ? {
          kind: "note",
          note: { path, hash: `hash-${path}`, content: path, attachments: [] },
          resolved: [],
        }
      : { kind: "missing", reason: "not_found" };
}
