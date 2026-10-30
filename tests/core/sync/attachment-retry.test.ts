import assert from "node:assert/strict";
import { test } from "node:test";

import {
  NOT_CONFIGURED_NOTICE,
  PENDING_UPLOADS_KEY,
  TOKEN_REJECTED_NOTICE,
} from "@/core/constants";
import { FileReadError, HttpError, TokenRejectedError } from "@/core/errors";
import { AttachmentRetry } from "@/core/sync/attachment-retry";
import type {
  AttachmentRef,
  PendingUpload,
  ResolvedAttachment,
} from "@/core/sync/types";

import {
  FakeBinaryFile,
  FakeNotifier,
  FakeTimers,
  FakeUploadPrompt,
  FakeUploader,
  FakeVault,
  MemoryDeviceStore,
  deferred,
  resolved,
  settle,
} from "@test/support/fakes";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

const A: AttachmentRef = {
  path: "Files/a.pdf",
  ext: "pdf",
  size: 3,
  mtime: 1,
  hash: "h-a",
};
const B: AttachmentRef = { ...A, path: "Files/b.png", ext: "png", hash: "h-b" };

const NETWORK = new Error("network down");

test("a failed upload is retried after 10 s, 30 s and 2 min, then hourly, and leaves the list once it goes through", async () => {
  const h = _setup();
  const a = resolved(A);

  h.uploader.failWith.set(A.hash, NETWORK);
  h.retry.record([{ resolved: a, error: NETWORK }]);

  assert.equal(h.timers.delays.at(-1), 10 * SECOND);
  assert.equal(_only(h).state, "retrying");

  await _tick(h, 10 * SECOND);
  assert.equal(h.uploader.sent.length, 1);
  assert.equal(h.timers.delays.at(-1), 30 * SECOND);
  assert.deepEqual(h.prompt.shown, []);

  await _tick(h, 30 * SECOND);
  assert.equal(h.uploader.sent.length, 2);
  assert.equal(h.timers.delays.at(-1), 2 * MINUTE);
  assert.deepEqual(h.prompt.shown, []);

  await _tick(h, 2 * MINUTE);
  assert.equal(h.uploader.sent.length, 3);
  assert.equal(_only(h).state, "given-up");
  assert.equal(_only(h).lastError, "couldn't reach MyBrain");
  assert.deepEqual(h.prompt.shown, [1]);
  assert.equal(h.timers.delays.at(-1), HOUR);

  h.uploader.failWith.delete(A.hash);
  await _tick(h, HOUR);

  assert.equal(h.uploader.sent.length, 4);
  assert.equal(h.uploader.sent[3].file, a.file);
  assert.deepEqual(h.retry.pending(), []);
  assert.equal(h.prompt.open, false);
  assert.equal(h.device.load(PENDING_UPLOADS_KEY), "[]");
  assert.equal(h.timers.pending.size, 0);
});

test("an upload the server refused is stuck at once: a notice, and no automatic retry", async () => {
  const h = _setup();

  h.retry.record([{ resolved: resolved(A), error: new HttpError(409) }]);

  assert.equal(_only(h).state, "stuck");
  assert.deepEqual(h.prompt.shown, [1]);
  assert.equal(h.timers.pending.size, 0);

  await _tick(h, HOUR);
  assert.deepEqual(h.uploader.sent, []);
});

test("a rate limit or timeout answer is retried like a network error", () => {
  const h = _setup();

  h.retry.record([
    { resolved: resolved(A), error: new HttpError(429) },
    { resolved: resolved(B), error: new HttpError(408) },
  ]);

  assert.deepEqual(
    h.retry.pending().map((p) => p.state),
    ["retrying", "retrying"],
  );
  assert.deepEqual(h.prompt.shown, []);
});

test("a rejected token flags it once, keeps the entry as it was and pauses the retries", async () => {
  const h = _setup();

  h.retry.record([
    { resolved: resolved(A), error: NETWORK },
    { resolved: resolved(B), error: NETWORK },
  ]);
  h.uploader.failWith.set(A.hash, new TokenRejectedError());
  h.uploader.failWith.set(B.hash, new TokenRejectedError());

  await _tick(h, 10 * SECOND);

  assert.equal(h.tokenRejections(), 1);
  assert.deepEqual(
    h.retry.pending().map((p) => [p.state, p.attempts]),
    [
      ["retrying", 0],
      ["retrying", 0],
    ],
  );
  assert.equal(h.timers.delays.at(-1), MINUTE);

  await _tick(h, MINUTE);
  assert.equal(h.uploader.sent.length, 2);

  h.auth.rejected = false;
  h.uploader.failWith.clear();
  await _tick(h, MINUTE);

  assert.equal(h.uploader.sent.length, 4);
  assert.deepEqual(h.retry.pending(), []);
});

test("one notice when uploads are given up; later ones update its count; it closes when the list empties", async () => {
  const h = _setup();

  h.uploader.failWith.set(A.hash, NETWORK);
  h.uploader.failWith.set(B.hash, NETWORK);
  h.retry.record([{ resolved: resolved(A), error: NETWORK }]);
  await _tick(h, 10 * SECOND);
  await _tick(h, 30 * SECOND);
  await _tick(h, 2 * MINUTE);

  assert.deepEqual(h.prompt.shown, [1]);

  h.retry.record([{ resolved: resolved(B), error: new HttpError(400) }]);

  assert.deepEqual(h.prompt.shown, [1]);
  assert.equal(h.prompt.count, 2);

  h.uploader.failWith.clear();
  h.prompt.retry?.();
  await settle();

  assert.deepEqual(h.retry.pending(), []);
  assert.equal(h.prompt.open, false);
});

test("a new failure of an upload already waiting keeps its place in the schedule", async () => {
  const h = _setup();

  h.uploader.failWith.set(A.hash, NETWORK);
  h.retry.record([{ resolved: resolved(A), error: NETWORK }]);
  await _tick(h, 10 * SECOND);

  h.retry.record([{ resolved: resolved(A), error: NETWORK }]);

  assert.equal(h.retry.pending().length, 1);
  assert.equal(_only(h).attempts, 1);
});

test("the list survives a restart, due uploads go out, and earlier give-ups don't bring the notice back", async () => {
  const first = _setup();

  first.uploader.failWith.set(A.hash, NETWORK);
  first.retry.record([{ resolved: resolved(A), error: NETWORK }]);
  await _tick(first, 10 * SECOND);
  await _tick(first, 30 * SECOND);
  await _tick(first, 2 * MINUTE);
  first.retry.record([{ resolved: resolved(B), error: NETWORK }]);
  first.retry.stop();

  const second = _setup(first.device, first.now.value);

  second.vault.binaries.set(A.path, _file(A));
  second.vault.binaries.set(B.path, _file(B));
  second.retry.start();

  assert.deepEqual(
    second.retry.pending().map((p) => [p.ref.hash, p.state]),
    [
      [A.hash, "given-up"],
      [B.hash, "retrying"],
    ],
  );

  await _tick(second, 10 * SECOND);

  assert.deepEqual(
    second.uploader.sent.map((s) => s.ref.hash),
    [B.hash],
  );
  assert.deepEqual(second.prompt.shown, []);

  await _tick(second, HOUR);

  assert.deepEqual(
    second.uploader.sent.map((s) => s.ref.hash),
    [B.hash, A.hash],
  );
  assert.deepEqual(second.retry.pending(), []);
});

test("after a restart a file that is gone or was edited is dropped without an upload", async () => {
  const C: AttachmentRef = { ...A, path: "Files/c.jpg", hash: "h-c" };
  const D: AttachmentRef = { ...A, path: "Files/d.jpg", hash: "h-d" };
  const first = _setup();

  first.retry.record(
    [A, B, C, D].map((ref) => ({ resolved: resolved(ref), error: NETWORK })),
  );
  first.retry.stop();

  const second = _setup(first.device, first.now.value);
  const newerMtime = _file(B);
  const newerSize = _file(D);

  newerMtime.mtime = 99;
  newerSize.size = 99;
  second.vault.binaries.set(B.path, newerMtime);
  second.vault.binaries.set(C.path, _file(C));
  second.vault.binaries.set(D.path, newerSize);
  second.retry.start();
  await _tick(second, 10 * SECOND);

  assert.deepEqual(
    second.uploader.sent.map((s) => s.ref.hash),
    [C.hash],
  );
  assert.deepEqual(second.retry.pending(), []);
});

test("an entry dropped as gone, emptying the list, closes the notice and saves the empty list", async () => {
  const h = _setup();
  const a = resolved(A);

  h.uploader.failWith.set(A.hash, NETWORK);
  h.retry.record([{ resolved: a, error: NETWORK }]);
  await _tick(h, 10 * SECOND);
  await _tick(h, 30 * SECOND);
  await _tick(h, 2 * MINUTE);
  assert.equal(h.prompt.open, true);

  (a.file as FakeBinaryFile).gone = true;
  await _tick(h, HOUR);

  assert.deepEqual(h.retry.pending(), []);
  assert.equal(h.prompt.open, false);
  assert.equal(h.device.load(PENDING_UPLOADS_KEY), "[]");
});

test("a handle whose file is gone falls back to the stored path", async () => {
  const h = _setup();
  const a = resolved(A);

  h.uploader.failWith.set(A.hash, NETWORK);
  h.retry.record([{ resolved: a, error: NETWORK }]);
  (a.file as FakeBinaryFile).gone = true;
  h.vault.binaries.set(A.path, _file(A));
  h.uploader.failWith.clear();
  await _tick(h, 10 * SECOND);

  assert.equal(h.uploader.sent.length, 1);
  assert.notEqual(h.uploader.sent[0].file, a.file);
  assert.deepEqual(h.retry.pending(), []);
});

test("while Obsidian is open a renamed file is still found, and its new path is stored", async () => {
  const h = _setup();
  const a = resolved(A);

  h.uploader.failWith.set(A.hash, NETWORK);
  h.retry.record([{ resolved: a, error: NETWORK }]);
  (a.file as FakeBinaryFile).path = "Files/renamed.pdf";
  await _tick(h, 10 * SECOND);

  assert.equal(h.uploader.sent[0].file, a.file);

  const [stored] = _stored(h);

  assert.equal(stored.path, "Files/renamed.pdf");
  assert.equal(stored.ref.path, A.path);
});

test("the list keeps the newest 1,000 uploads", () => {
  const h = _setup();
  const failures = Array.from({ length: 1001 }, (_, i) => ({
    resolved: resolved({ ...A, hash: `h-${i}` }),
    error: NETWORK,
  }));

  h.retry.record(failures);

  const hashes = h.retry.pending().map((p) => p.ref.hash);

  assert.equal(hashes.length, 1000);
  assert.equal(hashes[0], "h-1");
  assert.equal(hashes.at(-1), "h-1000");
});

test("Retry sends every waiting upload at once, resets their attempts and reports the result", async () => {
  const h = _setup();

  h.retry.record([
    { resolved: resolved(A), error: new HttpError(400) },
    { resolved: resolved(B), error: NETWORK },
  ]);
  h.uploader.failWith.set(B.hash, NETWORK);

  await h.retry.retryNow();

  assert.equal(h.uploader.sent.length, 2);
  assert.deepEqual(h.notifier.messages, [
    "MyBrain: 1 attachment uploaded, 1 still failing",
  ]);
  assert.deepEqual(
    h.retry.pending().map((p) => [p.ref.hash, p.state, p.attempts]),
    [[B.hash, "retrying", 1]],
  );

  h.uploader.failWith.clear();
  await h.retry.retryNow();

  assert.deepEqual(
    h.notifier.messages.at(-1),
    "MyBrain: 1 attachment uploaded",
  );
});

test("Retry reports plural counts", async () => {
  const h = _setup();

  h.retry.record([
    { resolved: resolved(A), error: NETWORK },
    { resolved: resolved(B), error: NETWORK },
  ]);
  await h.retry.retryNow();

  assert.deepEqual(h.notifier.messages, ["MyBrain: 2 attachments uploaded"]);
});

test("after stop nothing is retried or shown, and later failures are only saved", async () => {
  const h = _setup();

  h.retry.record([{ resolved: resolved(A), error: new HttpError(409) }]);
  assert.equal(h.prompt.open, true);

  h.retry.stop();

  assert.equal(h.timers.pending.size, 0);
  assert.equal(h.prompt.open, false);

  h.retry.record([{ resolved: resolved(B), error: new HttpError(409) }]);
  await _tick(h, HOUR);

  assert.deepEqual(h.uploader.sent, []);
  assert.equal(h.prompt.open, false);
  assert.deepEqual(
    _stored(h).map((p) => p.ref.hash),
    [A.hash, B.hash],
  );
});

test("a stop during a run sends nothing more", async () => {
  const h = _setup();
  const failures = ["1", "2", "3", "4", "5"].map((n) => ({
    resolved: resolved({ ...A, hash: `h-${n}` }),
    error: NETWORK,
  }));

  h.retry.record(failures);

  const running = h.retry.retryNow();

  h.retry.stop();
  await running;

  // The three already in flight finish; the other two never start.
  assert.equal(h.uploader.sent.length, 3);
});

test("with uploads off on this device nothing is retried until they are on", async () => {
  const h = _setup();

  h.uploader.enabled = false;
  h.retry.record([{ resolved: resolved(A), error: NETWORK }]);
  await _tick(h, 10 * SECOND);

  assert.deepEqual(h.uploader.sent, []);
  assert.equal(h.timers.delays.at(-1), MINUTE);

  h.uploader.enabled = true;
  await _tick(h, MINUTE);

  assert.equal(h.uploader.sent.length, 1);
});

test("nothing is retried while the plugin can't sync", async () => {
  const h = _setup();

  h.flags.canSync = false;
  h.retry.record([{ resolved: resolved(A), error: NETWORK }]);
  await _tick(h, 10 * SECOND);

  assert.deepEqual(h.uploader.sent, []);
});

test("a damaged stored list loads empty, and broken entries are left out", () => {
  const damaged = _setup(new MemoryDeviceStore({ [PENDING_UPLOADS_KEY]: "{" }));

  damaged.retry.start();
  assert.deepEqual(damaged.retry.pending(), []);

  const good: PendingUpload = {
    ref: A,
    path: A.path,
    state: "retrying",
    attempts: 0,
    nextAttemptAt: 0,
    firstFailedAt: 0,
    lastError: "x",
  };
  const mixed = _setup(
    new MemoryDeviceStore({
      [PENDING_UPLOADS_KEY]: JSON.stringify([
        good,
        { ...good, state: "lost" },
        { ...good, ref: { ...A, size: "3" } },
        null,
      ]),
    }),
  );

  mixed.retry.start();
  assert.deepEqual(mixed.retry.pending(), [good]);
});

test("listeners hear every change to the list until they unsubscribe", async () => {
  const h = _setup();
  let calls = 0;
  const off = h.retry.onChange(() => calls++);

  h.retry.record([{ resolved: resolved(A), error: NETWORK }]);
  assert.equal(calls, 1);

  await _tick(h, 10 * SECOND);
  assert.equal(calls, 2);

  off();
  h.retry.record([{ resolved: resolved(B), error: NETWORK }]);
  assert.equal(calls, 2);
});

test("a failure recorded while a run is in flight sets no timer until the run ends", async () => {
  const h = _setup();
  const held = deferred();

  h.retry.record([{ resolved: resolved(A), error: NETWORK }]);
  h.uploader.send = async (r) => {
    h.uploader.sent.push(r);
    await held.promise;
  };
  h.now.value += 10 * SECOND;
  h.timers.fireAll();
  await settle();

  h.retry.record([{ resolved: resolved(B), error: NETWORK }]);

  assert.equal(h.timers.pending.size, 0);

  held.resolve();
  await settle();

  assert.equal(h.timers.pending.size, 1);
  assert.equal(h.timers.delays.at(-1), 10 * SECOND);
});

test("Retry during a timed run waits for it, then sends what is left", async () => {
  const h = _setup();
  const held = deferred();

  h.retry.record([{ resolved: resolved(A), error: NETWORK }]);
  h.uploader.failWith.set(A.hash, NETWORK);
  h.uploader.send = async (r) => {
    h.uploader.sent.push(r);
    await held.promise;

    throw NETWORK;
  };
  h.now.value += 10 * SECOND;
  h.timers.fireAll();
  await settle();

  const retrying = h.retry.retryNow();

  assert.equal(h.uploader.sent.length, 1);

  held.resolve();
  await retrying;

  assert.equal(h.uploader.sent.length, 2);
  assert.deepEqual(h.notifier.messages, [
    "MyBrain: 1 attachment still failing",
  ]);
});

test("Retry while the token is rejected says so, and changes nothing", async () => {
  const h = _setup();

  h.retry.record([{ resolved: resolved(A), error: new HttpError(409) }]);
  h.auth.rejected = true;

  await h.retry.retryNow();

  assert.deepEqual(h.notifier.messages, [TOKEN_REJECTED_NOTICE]);
  assert.deepEqual(h.uploader.sent, []);
  assert.equal(_only(h).state, "stuck");
});

test("Retry while the plugin can't sync says so, and changes nothing", async () => {
  const h = _setup();

  h.retry.record([{ resolved: resolved(A), error: new HttpError(409) }]);
  h.flags.canSync = false;

  await h.retry.retryNow();

  assert.deepEqual(h.notifier.messages, [NOT_CONFIGURED_NOTICE]);
  assert.equal(_only(h).state, "stuck");
});

test("Retry while this device doesn't upload says how to turn uploads on, and changes nothing", async () => {
  const h = _setup();

  h.retry.record([{ resolved: resolved(A), error: new HttpError(409) }]);
  h.uploader.enabled = false;

  await h.retry.retryNow();

  assert.deepEqual(h.notifier.messages, [
    "MyBrain: attachment uploads are off on this device; turn on Sync attachments on mobile",
  ]);
  assert.deepEqual(h.uploader.sent, []);
  assert.equal(_only(h).state, "stuck");
});

test("Retry where every file was deleted or changed says nothing is left", async () => {
  const h = _setup();
  const a = resolved(A);

  h.retry.record([{ resolved: a, error: NETWORK }]);
  (a.file as FakeBinaryFile).gone = true;

  await h.retry.retryNow();

  assert.deepEqual(h.notifier.messages, [
    "MyBrain: nothing left to upload; the files were deleted or changed",
  ]);
  assert.deepEqual(h.retry.pending(), []);
});

test("the settings list gets a plain description of each failure", () => {
  const h = _setup();
  const cases: [unknown, string][] = [
    [new HttpError(400), "MyBrain refused the file"],
    [new HttpError(403), "MyBrain refused the file"],
    [
      new HttpError(409),
      "MyBrain refused it (connector not active, or another vault)",
    ],
    [new HttpError(413), "file too large for MyBrain"],
    [new HttpError(408), "MyBrain is busy"],
    [new HttpError(429), "MyBrain is busy"],
    [new HttpError(500), "MyBrain server error"],
    [new HttpError(503), "MyBrain server error"],
    [new TokenRejectedError(), "token rejected"],
    [new FileReadError(new Error("EACCES")), "couldn't read the file"],
    [NETWORK, "couldn't reach MyBrain"],
  ];

  h.retry.record(
    cases.map(([error], i) => ({
      resolved: resolved({ ...A, hash: `h-${i}` }),
      error,
    })),
  );

  assert.deepEqual(
    h.retry.pending().map((p) => p.lastError),
    cases.map(([, text]) => text),
  );
});

test("a rejected token during Retry flags it once and counts the upload as failing", async () => {
  const h = _setup();

  h.retry.record([{ resolved: resolved(A), error: NETWORK }]);
  h.uploader.failWith.set(A.hash, new TokenRejectedError());

  await h.retry.retryNow();

  assert.equal(h.tokenRejections(), 1);
  assert.deepEqual(h.notifier.messages, [
    "MyBrain: 1 attachment still failing",
  ]);
  assert.equal(_only(h).attempts, 0);
});

test("a manual Retry that is refused again brings the notice back", async () => {
  const h = _setup();

  h.uploader.failWith.set(A.hash, new HttpError(409));
  h.retry.record([{ resolved: resolved(A), error: new HttpError(409) }]);
  h.prompt.close();

  await h.retry.retryNow();

  assert.deepEqual(h.prompt.shown, [1, 1]);
  assert.equal(_only(h).state, "stuck");
});

test("a refusal during the quick retries or the hourly ones makes the entry stuck, with a notice", async () => {
  const quick = _setup();

  quick.uploader.failWith.set(A.hash, new HttpError(409));
  quick.retry.record([{ resolved: resolved(A), error: NETWORK }]);
  await _tick(quick, 10 * SECOND);

  assert.equal(_only(quick).state, "stuck");
  assert.deepEqual(quick.prompt.shown, [1]);

  const hourly = _setup();

  hourly.uploader.failWith.set(A.hash, NETWORK);
  hourly.retry.record([{ resolved: resolved(A), error: NETWORK }]);
  await _tick(hourly, 10 * SECOND);
  await _tick(hourly, 30 * SECOND);
  await _tick(hourly, 2 * MINUTE);
  hourly.prompt.close();
  hourly.uploader.failWith.set(A.hash, new HttpError(409));
  await _tick(hourly, HOUR);

  assert.equal(_only(hourly).state, "stuck");
  assert.deepEqual(hourly.prompt.shown, [1]);
  assert.equal(hourly.timers.pending.size, 0);
});

test("a new failure of a waiting upload takes the new file details, so it isn't dropped as changed", async () => {
  const h = _setup();
  const edited = { ...A, mtime: 7 };

  h.retry.record([{ resolved: resolved(A), error: NETWORK }]);
  h.retry.record([{ resolved: resolved(edited), error: NETWORK }]);
  await _tick(h, 10 * SECOND);

  assert.equal(h.uploader.sent.length, 1);
  assert.equal(h.uploader.sent[0].ref.mtime, 7);
  assert.deepEqual(h.retry.pending(), []);
});

test("failures recorded before start join the saved list instead of replacing it", () => {
  const first = _setup();

  first.retry.record([{ resolved: resolved(A), error: NETWORK }]);
  first.retry.stop();

  const second = _setup(first.device, first.now.value);

  second.retry.record([{ resolved: resolved(B), error: NETWORK }]);
  second.retry.start();

  assert.deepEqual(
    second.retry.pending().map((p) => p.ref.hash),
    [A.hash, B.hash],
  );
  assert.deepEqual(
    _stored(second).map((p) => p.ref.hash),
    [A.hash, B.hash],
  );
});

test("a saved list over the cap is cut to the newest 1,000 on load", () => {
  const entries: PendingUpload[] = Array.from({ length: 1002 }, (_, i) => ({
    ref: { ...A, hash: `h-${i}` },
    path: A.path,
    state: "retrying",
    attempts: 0,
    nextAttemptAt: 0,
    firstFailedAt: 0,
    lastError: "x",
  }));
  const h = _setup(
    new MemoryDeviceStore({ [PENDING_UPLOADS_KEY]: JSON.stringify(entries) }),
  );
  const hashes = h.retry.pending().map((p) => p.ref.hash);

  assert.equal(hashes.length, 1000);
  assert.equal(hashes[0], "h-2");
});

test("a listener or a save that throws doesn't stop the retries", async () => {
  const h = _setup();

  h.retry.onChange(() => {
    throw new Error("view broke");
  });
  h.device.save = () => {
    throw new Error("storage full");
  };
  h.uploader.failWith.set(A.hash, NETWORK);
  h.retry.record([{ resolved: resolved(A), error: NETWORK }]);

  assert.equal(h.timers.delays.at(-1), 10 * SECOND);

  await _tick(h, 10 * SECOND);

  assert.equal(h.uploader.sent.length, 1);
  assert.equal(h.timers.delays.at(-1), 30 * SECOND);
});

test("a run still in flight at stop saves its result but shows no notice", async () => {
  const h = _setup();
  const held = deferred();

  h.retry.record([{ resolved: resolved(A), error: NETWORK }]);
  h.uploader.send = async () => {
    await held.promise;

    throw new HttpError(409);
  };
  h.now.value += 10 * SECOND;
  h.timers.fireAll();
  await settle();
  h.retry.stop();
  held.resolve();
  await settle();

  assert.equal(h.prompt.open, false);
  assert.deepEqual(h.prompt.shown, []);
  assert.equal(_stored(h)[0].state, "stuck");
  assert.equal(h.timers.pending.size, 0);
});

test("a file that can't be read is retried, then waits for Retry now a day after it first failed", async () => {
  const h = _setup();
  const unreadable = new FileReadError(new Error("EACCES"));

  h.uploader.failWith.set(A.hash, unreadable);
  h.retry.record([{ resolved: resolved(A), error: unreadable }]);
  await _tick(h, 10 * SECOND);
  await _tick(h, 30 * SECOND);
  await _tick(h, 2 * MINUTE);

  assert.equal(_only(h).state, "given-up");
  assert.deepEqual(h.prompt.shown, [1]);

  for (let hour = 0; hour < 23; hour++) await _tick(h, HOUR);

  assert.equal(_only(h).state, "given-up");

  await _tick(h, HOUR);

  assert.equal(_only(h).state, "stuck");
  assert.equal(h.timers.pending.size, 0);
  assert.deepEqual(h.prompt.shown, [1]);
});

test("a server or network error keeps being retried hourly after a day", async () => {
  const h = _setup();

  h.uploader.failWith.set(A.hash, NETWORK);
  h.retry.record([{ resolved: resolved(A), error: NETWORK }]);
  await _tick(h, 10 * SECOND);
  await _tick(h, 30 * SECOND);
  await _tick(h, 2 * MINUTE);

  for (let hour = 0; hour < 30; hour++) await _tick(h, HOUR);

  assert.equal(_only(h).state, "given-up");
  assert.equal(h.timers.delays.at(-1), HOUR);
});

test("an upload already waiting that a later upload gets refused is marked refused, with a notice", () => {
  const h = _setup();

  h.retry.record([{ resolved: resolved(A), error: NETWORK }]);
  h.retry.record([{ resolved: resolved(A), error: new HttpError(409) }]);

  assert.equal(_only(h).state, "stuck");
  assert.deepEqual(h.prompt.shown, [1]);
});

test("a rejected token during Retry leaves refused uploads refused and the notice open", async () => {
  const h = _setup();

  h.retry.record([{ resolved: resolved(A), error: new HttpError(409) }]);
  h.uploader.failWith.set(A.hash, new TokenRejectedError());

  await h.retry.retryNow();

  assert.equal(_only(h).state, "stuck");
  assert.equal(h.prompt.open, true);
});

test("Retry clicked while uploads can't run brings back the notice it closed", async () => {
  const h = _setup();

  h.retry.record([{ resolved: resolved(A), error: new HttpError(409) }]);
  h.auth.rejected = true;
  h.prompt.close();

  await h.retry.retryNow();

  assert.equal(h.prompt.open, true);
  assert.deepEqual(h.prompt.shown, [1, 1]);
  assert.equal(_only(h).state, "stuck");
});

function _setup(device = new MemoryDeviceStore(), start = 1_000_000) {
  const now = { value: start };
  const timers = new FakeTimers();
  const uploader = new FakeUploader();
  const vault = new FakeVault();
  const prompt = new FakeUploadPrompt();
  const notifier = new FakeNotifier();
  const auth = { rejected: false };
  const flags = { canSync: true };
  let tokenRejections = 0;

  const retry = new AttachmentRetry({
    timers,
    clock: () => now.value,
    auth,
    notifier,
    uploader,
    vault,
    device,
    prompt,
    canSync: () => flags.canSync,
    onTokenRejected: () => {
      tokenRejections += 1;
      auth.rejected = true;
    },
  });

  return {
    retry,
    now,
    timers,
    uploader,
    vault,
    prompt,
    notifier,
    auth,
    flags,
    device,
    tokenRejections: () => tokenRejections,
  };
}

/** Move the clock on and fire the timer that is due. */
async function _tick(h: ReturnType<typeof _setup>, ms: number): Promise<void> {
  h.now.value += ms;
  h.timers.fireAll();
  await settle();
}

function _only(h: ReturnType<typeof _setup>): PendingUpload {
  const pending = h.retry.pending();

  assert.equal(pending.length, 1);

  return pending[0];
}

function _stored(h: ReturnType<typeof _setup>): PendingUpload[] {
  return JSON.parse(
    h.device.load(PENDING_UPLOADS_KEY) ?? "[]",
  ) as PendingUpload[];
}

function _file(ref: AttachmentRef): FakeBinaryFile {
  return (resolved(ref) as ResolvedAttachment & { file: FakeBinaryFile }).file;
}
