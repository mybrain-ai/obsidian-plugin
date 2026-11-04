import assert from "node:assert/strict";
import { test } from "node:test";

import { TOKEN_REJECTED_NOTICE } from "@/core/constants";
import { HttpError, TokenRejectedError } from "@/core/errors";
import { FullSync } from "@/core/sync/full-sync";
import { envelope, manifestV1Body, manifestV2Body } from "@/core/sync/payloads";
import { SyncState } from "@/core/sync/sync-state";

import { deferred, settle, syncHarness } from "@test/support/fakes";
import type { FakeNote, SyncHarness } from "@test/support/types";

const NOTES: FakeNote[] = [
  { path: "a.md", content: "Alpha" },
  { path: "b.md", content: "Beta" },
];

test("a protocol 2 manifest accepted: protocol 2, lastSyncAt set, one save", async () => {
  const h = _setup();

  assert.equal(await h.fullSync.push({ initial: false }), true);

  assert.deepEqual(h.api.paths(), ["/manifest"]);
  assert.deepEqual(
    h.api.calls[0].body,
    manifestV2Body(
      _snapshots(h),
      [],
      { templatesFolder: null, dailyNotesFolder: null, dailyNotesFormat: null },
      { ..._env(h), pluginVersion: "1.1.0" },
    ),
  );
  assert.equal(h.settings.serverProtocol, 2);
  assert.equal(h.settings.lastSyncAt, h.now.value);
  assert.equal(h.saves(), 1);
  assert.deepEqual(h.notifier.messages, []);
});

test("a protocol 2 manifest refused: the protocol 1 manifest goes from the same reads", async () => {
  const h = _setup();

  _refuseV2(h);

  assert.equal(await h.fullSync.push({ initial: false }), true);

  assert.deepEqual(h.api.paths(), ["/manifest", "/manifest"]);
  assert.deepEqual(
    h.api.calls[1].body,
    manifestV1Body(_snapshots(h), [], _env(h)),
  );
  assert.deepEqual(h.vault.reads, ["a.md", "b.md"]);
  assert.equal(h.settings.serverProtocol, 1);
  assert.equal(h.settings.lastSyncAt, h.now.value);
});

test("a probe sends nothing after a refusal and keeps lastSyncAt", async () => {
  const h = _setup(NOTES, { lastSyncAt: 7 });

  _refuseV2(h);

  assert.equal(
    await h.fullSync.push({ initial: false, fallbackToV1: false }),
    false,
  );

  assert.deepEqual(h.api.paths(), ["/manifest"]);
  assert.equal(h.settings.serverProtocol, 1);
  assert.equal(h.settings.lastSyncAt, 7);
  assert.equal(h.saves(), 1);
});

test("the protocol 1 manifest uploads the attachments the server asks for", async () => {
  const ref = { path: "pic.png", ext: "png", size: 3, mtime: 1, hash: "h" };
  const h = _setup([
    { path: "a.md", content: "![[pic.png]]", attachments: [ref] },
  ]);

  h.api.respond = (call) => {
    if (call.body.protocol === 2) throw new HttpError(422);

    return { accepted: 1, rejected: [], attachmentsNeeded: ["h"] };
  };

  await h.fullSync.push({ initial: false });

  assert.deepEqual([...h.uploader.remembered.keys()], ["h"]);
  assert.deepEqual(h.uploader.uploads, [["h"]]);
});

test("the protocol 2 manifest remembers no attachment", async () => {
  const ref = { path: "pic.png", ext: "png", size: 3, mtime: 1, hash: "h" };
  const h = _setup([
    { path: "a.md", content: "![[pic.png]]", attachments: [ref] },
  ]);

  await h.fullSync.push({ initial: false });

  assert.equal(h.uploader.remembered.size, 0);
  assert.deepEqual(h.uploader.uploads, []);
});

test("an initial sync counts the notes that could not be read", async () => {
  const h = _setup([...NOTES, { path: "c.md", content: "Gamma" }]);

  h.vault.unreadable.add("c.md");

  await h.fullSync.push({ initial: true });

  assert.deepEqual(h.notifier.messages, [
    "MyBrain: syncing 3 notes...",
    "MyBrain: synced 2 notes; 1 could not be read",
  ]);
});

test("a sync that went out is reported as done even when saving afterwards fails", async () => {
  const h = _setup();

  h.deps.save = () => Promise.reject(new Error("disk full"));

  assert.equal(await h.fullSync.push({ initial: true }), true);
  assert.deepEqual(h.notifier.messages, [
    "MyBrain: syncing 2 notes...",
    "MyBrain: synced 2 notes",
  ]);
});

test("an initial sync reports success and failure", async () => {
  const ok = _setup();

  await ok.fullSync.push({ initial: true });

  assert.deepEqual(ok.notifier.messages, [
    "MyBrain: syncing 2 notes...",
    "MyBrain: synced 2 notes",
  ]);

  const failed = _setup();

  failed.api.respond = () => {
    throw new HttpError(500);
  };

  assert.equal(await failed.fullSync.push({ initial: true }), false);
  assert.deepEqual(failed.notifier.messages, [
    "MyBrain: syncing 2 notes...",
    "MyBrain: sync failed. Try Resync full vault in settings.",
  ]);
  assert.equal(failed.saves(), 0);
});

test("a full sync needs an endpoint and a token", async () => {
  const h = _setup(NOTES, { token: "" });

  assert.equal(await h.fullSync.push({ initial: true }), false);
  assert.equal(await h.fullSync.push({ initial: false }), false);

  assert.deepEqual(h.notifier.messages, [
    "MyBrain: set endpoint and token first",
  ]);
  assert.deepEqual(h.api.calls, []);
  assert.equal(h.state.isSyncing(), false);
});

test("a rejected token is flagged with one notice", async () => {
  const h = _setup();

  h.api.respond = () => {
    throw new TokenRejectedError();
  };

  assert.equal(await h.fullSync.push({ initial: false }), false);
  assert.equal(h.deps.auth.rejected, true);
  assert.deepEqual(h.notifier.messages, [TOKEN_REJECTED_NOTICE]);
});

test("overlapping pushes keep isSyncing() true until both end", async () => {
  const h = _setup();
  const replies = [deferred<undefined>(), deferred<undefined>()];
  let changes = 0;

  h.api.respond = () => replies[h.api.calls.length - 1].promise;
  h.state.onChange(() => {
    changes += 1;
  });

  const first = h.fullSync.push({ initial: false });
  const second = h.fullSync.push({ initial: false });

  assert.equal(h.state.isSyncing(), true);
  assert.equal(changes, 1);

  await settle(1);
  replies[0].resolve(undefined);
  await first;

  assert.equal(h.state.isSyncing(), true);

  replies[1].resolve(undefined);
  await second;

  assert.equal(h.state.isSyncing(), false);
  assert.equal(changes, 2);
});

function _setup(
  notes: FakeNote[] = NOTES,
  settings: Parameters<typeof syncHarness>[1] = {},
) {
  const h = syncHarness(notes, settings);
  const state = new SyncState();

  return { ...h, state, fullSync: new FullSync(h.deps, state) };
}

function _snapshots(h: SyncHarness) {
  return Array.from(h.vault.notes.values());
}

function _env(h: SyncHarness) {
  return envelope("vault-1", "Vault", new Date(h.now.value));
}

function _refuseV2(h: SyncHarness): void {
  h.api.respond = (call) => {
    if (call.body.protocol === 2) throw new HttpError(422);

    return undefined;
  };
}
