import assert from "node:assert/strict";
import { test } from "node:test";

import { TOKEN_REJECTED_NOTICE } from "@/core/constants";
import { HttpError, TokenRejectedError } from "@/core/errors";
import { EditSync } from "@/core/sync/edit-sync";
import { FullSync } from "@/core/sync/full-sync";
import { envelope, ingestBody, upsertV1, upsertV2 } from "@/core/sync/payloads";
import { emptyState } from "@/core/sync/queue";
import { SyncState } from "@/core/sync/sync-state";
import type {
  IngestBody,
  IngestEvent,
  IngestEventV1,
  IngestEventV2,
  QueueState,
} from "@/core/sync/types";

import { deferred, settle, syncHarness } from "@test/support/fakes";
import type {
  EditSyncHarness,
  FakeNote,
  SyncHarness,
} from "@test/support/types";

const NOTE = "In/a.md";
const ATTACHMENT = {
  path: "In/pic.png",
  ext: "png",
  size: 3,
  mtime: 1,
  hash: "h",
};

test("an autosave of an unchanged note sends one ingest only", async () => {
  const h = _setup([{ path: NOTE, content: "Hello there.\n" }]);

  await _edited(h);
  await _edited(h);

  assert.deepEqual(h.api.paths(), ["/ingest"]);
  assert.deepEqual(
    h.api.calls[0].body,
    _expectedIngest(h, [upsertV2(h.vault.notes.get(NOTE)!)], 2),
  );
});

test("an autosave of an unchanged note does not read the note again", async () => {
  const h = _setup([{ path: NOTE, content: "Hello there.\n" }]);

  await _edited(h);
  await _edited(h);

  assert.deepEqual(h.vault.reads, [NOTE]);
});

test("edits are debounced per path", async () => {
  const h = _setup([{ path: NOTE, content: "Hello there.\n" }]);

  h.edits.onUpsert({ path: NOTE });
  h.edits.onUpsert({ path: NOTE });

  assert.equal(h.timers.pending.size, 1);
  assert.equal([...h.timers.pending.values()][0].ms, 1500);
});

test("a protocol 1 upsert saved by 1.0.x goes without its text under protocol 2", async () => {
  const legacy = upsertV1({
    ...syncHarness([{ path: NOTE, content: "old text" }]).vault.notes.get(
      NOTE,
    )!,
  });
  const h = _setup(
    [{ path: NOTE, content: "Hello there.\n" }],
    {},
    _queueOf([legacy]),
  );

  await h.edits.drain();

  assert.deepEqual(h.api.paths(), ["/ingest"]);
  assert.deepEqual(
    h.api.calls[0].body,
    _expectedIngest(h, [upsertV2(h.vault.notes.get(NOTE)!)], 2),
  );
  assert.equal(JSON.stringify(h.api.calls).includes("old text"), false);
  assert.equal(JSON.stringify(h.api.calls).includes("Hello there."), false);
});

test("a protocol 1 upsert saved by 1.0.x goes as stored under protocol 1", async () => {
  const legacy = upsertV1({
    ...syncHarness([{ path: NOTE, content: "old text" }]).vault.notes.get(
      NOTE,
    )!,
  });
  const h = _setup(
    [{ path: NOTE, content: "Hello there.\n" }],
    { serverProtocol: 1 },
    _queueOf([legacy]),
  );

  await h.edits.drain();

  assert.deepEqual(h.api.calls[0].body, _expectedIngest(h, [legacy], 1));
  assert.deepEqual(h.edits.queued().events, []);
});

test("a protocol 2 edit uploads nothing even when the reply lists attachments", async () => {
  const h = _setup([
    { path: NOTE, content: "![[pic.png]]", attachments: [ATTACHMENT] },
  ]);

  h.api.respond = () => ({
    accepted: 1,
    rejected: [],
    attachmentsNeeded: ["h"],
  });

  await _edited(h);

  assert.deepEqual(h.api.paths(), ["/ingest"]);
  assert.deepEqual(
    h.api.calls[0].body,
    _expectedIngest(h, [upsertV2(h.vault.notes.get(NOTE)!)], 2),
  );
  assert.equal(h.uploader.remembered.size, 0);
  assert.deepEqual(h.uploader.uploads, [["h"]]);
});

test("a rename with only the old path in scope is queued", async () => {
  const h = _setup([{ path: "Out/a.md", content: "x" }], {
    inScopeFolders: ["In"],
  });

  h.edits.onRename({ path: "Out/a.md" }, NOTE);
  h.timers.fireAll();
  await settle();

  assert.deepEqual(h.api.paths(), ["/ingest"]);
  assert.deepEqual(
    h.api.calls[0].body,
    _expectedIngest(
      h,
      [{ op: "rename", oldPath: NOTE, newPath: "Out/a.md" }],
      2,
    ),
  );
});

test("a rename carries the last hash, so an unchanged upsert of the new path sends nothing", async () => {
  const h = _setup([{ path: NOTE, content: "same" }], {
    inScopeFolders: ["In"],
  });

  await _edited(h);

  h.vault.remove(NOTE);
  h.vault.put({ path: "In/b.md", content: "same" });
  h.edits.onRename({ path: "In/b.md" }, NOTE);
  h.timers.fireAll();
  await settle();

  await _edited(h, "In/b.md");

  assert.deepEqual(h.api.paths(), ["/ingest", "/ingest"]);
  assert.deepEqual(
    h.api.calls[1].body,
    _expectedIngest(
      h,
      [{ op: "rename", oldPath: NOTE, newPath: "In/b.md" }],
      2,
    ),
  );
});

test("a delete of a note outside the scope queues nothing", async () => {
  const h = _setup([], { inScopeFolders: ["In"] });

  h.edits.onDelete({ path: "Out/a.md" });

  assert.equal(h.timers.pending.size, 0);
  await settle();
  assert.deepEqual(h.edits.queued().events, []);
  assert.deepEqual(h.api.calls, []);
});

test("a delete in scope is queued and sent", async () => {
  const h = _setup([], { inScopeFolders: ["In"] });

  h.edits.onDelete({ path: NOTE });
  h.timers.fireAll();
  await settle();

  assert.deepEqual(
    h.api.calls[0].body,
    _expectedIngest(h, [{ op: "delete", path: NOTE }], 2),
  );
});

test("the path is read when the debounce fires, so a rename in between is followed", async () => {
  const h = _setup([{ path: NOTE, content: "text" }]);
  const note = { path: NOTE };

  h.edits.onUpsert(note);
  h.vault.remove(NOTE);
  h.vault.put({ path: "In/b.md", content: "text" });
  note.path = "In/b.md";
  h.timers.fireAll();
  await settle();

  assert.deepEqual(
    h.api.calls[0].body,
    _expectedIngest(h, [upsertV2(h.vault.notes.get("In/b.md")!)], 2),
  );
});

test("after stop no request goes out for a pending debounce", async () => {
  const h = _setup([{ path: NOTE, content: "text" }]);

  h.edits.onUpsert({ path: NOTE });
  h.edits.stop();

  assert.equal(h.timers.pending.size, 0);
  h.timers.fireAll();
  await settle();
  assert.deepEqual(h.api.calls, []);
});

test("after stop a drain sends nothing, even with events queued", async () => {
  const h = _setup([], {}, _queueOf([{ op: "delete", path: NOTE }]));

  h.edits.stop();
  await h.edits.drain();

  assert.deepEqual(h.api.calls, []);
  assert.equal(h.edits.queued().events.length, 1);
});

test("a drain in progress stops after the current batch on stop", async () => {
  const events: IngestEvent[] = Array.from({ length: 60 }, (_, i) => ({
    op: "delete",
    path: `In/${i}.md`,
  }));
  const h = _setup([], {}, _queueOf(events));
  const reply = deferred<undefined>();

  h.api.respond = () => reply.promise;

  const draining = h.edits.drain();

  await settle();
  h.edits.stop();
  reply.resolve(undefined);
  await draining;

  assert.deepEqual(h.api.paths(), ["/ingest"]);
  assert.equal(h.edits.queued().events.length, 10);
});

test("a 401 on the protocol probe stops the drain until a manifest push succeeds", async () => {
  const h = _setup([{ path: NOTE, content: "text" }], {
    serverProtocol: null,
  });

  h.api.respond = () => {
    throw new TokenRejectedError();
  };

  await _edited(h);

  assert.deepEqual(h.api.paths(), ["/manifest"]);
  assert.deepEqual(h.notifier.messages, [TOKEN_REJECTED_NOTICE]);
  assert.equal(h.deps.auth.rejected, true);
  // Not a send failure: no backoff is set for the batch.
  assert.equal(h.edits.queued().attemptCount, 0);

  await h.edits.drain();
  assert.deepEqual(h.api.paths(), ["/manifest"]);
  assert.equal(h.notifier.messages.length, 1);

  h.api.respond = () => undefined;
  assert.equal(await h.fullSync.push({ initial: false }), true);
  assert.equal(h.deps.auth.rejected, false);

  await h.edits.drain();
  assert.deepEqual(h.api.paths(), ["/manifest", "/manifest", "/ingest"]);
  assert.deepEqual(
    h.api.calls[2].body,
    _expectedIngest(h, [upsertV2(h.vault.notes.get(NOTE)!)], 2),
  );
});

test("a save that fails after the server accepted a batch keeps it acked, with no backoff", async () => {
  const h = _setup([{ path: NOTE, content: "text" }]);

  h.deps.save = () => Promise.reject(new Error("disk full"));
  await _edited(h);

  assert.deepEqual(h.api.paths(), ["/ingest"]);
  assert.deepEqual(h.edits.queued().events, []);
  assert.equal(h.edits.queued().attemptCount, 0);
});

test("a save that fails after a refused batch is logged, the batch kept for later", async () => {
  const h = _setup([{ path: NOTE, content: "text" }]);

  h.deps.save = () => Promise.reject(new Error("disk full"));
  h.api.respond = () => {
    throw new Error("server down");
  };

  await _edited(h);

  assert.equal(h.edits.queued().events.length, 1);
  assert.equal(h.edits.queued().attemptCount, 1);
});

test("a refused protocol 2 batch is retried later as protocol 2, never with text", async () => {
  const h = _setup([{ path: NOTE, content: "Hello there.\n" }]);

  h.api.respond = () => {
    throw new HttpError(422);
  };

  await _edited(h);

  assert.deepEqual(h.api.paths(), ["/ingest"]);
  assert.equal(h.edits.queued().attemptCount, 1);
  assert.ok(h.edits.queued().nextAttemptAt > h.now.value);
  assert.equal(h.settings.serverProtocol, 2);

  h.api.respond = () => undefined;
  h.now.value += 60_000;
  await h.edits.drain();

  assert.deepEqual(h.api.paths(), ["/ingest", "/ingest"]);
  assert.deepEqual(
    h.api.calls[1].body,
    _expectedIngest(h, [upsertV2(h.vault.notes.get(NOTE)!)], 2),
  );
  assert.equal(JSON.stringify(h.api.calls).includes("Hello there."), false);
  assert.deepEqual(h.edits.queued().events, []);
});

test("a scope change during the debounce window drops the upsert", async () => {
  const h = _setup([{ path: NOTE, content: "text" }], {
    inScopeFolders: ["In"],
  });

  h.edits.onUpsert({ path: NOTE });
  h.settings.inScopeFolders = ["Other"];
  h.timers.fireAll();
  await settle();

  assert.deepEqual(h.vault.reads, []);
  assert.deepEqual(h.edits.queued().events, []);
  assert.deepEqual(h.api.calls, []);
});

test("catch-up queues the notes in scope changed since the last sync", async () => {
  const h = _setup(
    [
      { path: NOTE, content: "new", mtime: 10 },
      { path: "In/old.md", content: "old", mtime: 5 },
      { path: "Out/new.md", content: "new", mtime: 10 },
    ],
    { inScopeFolders: ["In"], lastSyncAt: 5 },
  );

  await h.edits.catchUp();
  await settle();

  assert.deepEqual(
    h.api.calls.map((c) => c.body.events),
    [[upsertV2(h.vault.notes.get(NOTE)!)]],
  );
});

test("a catch-up that fails rejects its promise instead of throwing to the caller", async () => {
  const h = _setup([{ path: NOTE, content: "new", mtime: 10 }], {
    lastSyncAt: 5,
  });

  h.vault.markdownPaths = () => {
    throw new Error("corrupt scope");
  };

  let caughtUp: Promise<void> | undefined;

  assert.doesNotThrow(() => {
    caughtUp = h.edits.catchUp();
  });
  await assert.rejects(caughtUp!, /corrupt scope/);
});

function _setup(
  notes: FakeNote[],
  settings: Parameters<typeof syncHarness>[1] = {},
  queue: QueueState = emptyState(),
) {
  const h = syncHarness(notes, { serverProtocol: 2, ...settings });
  const fullSync = new FullSync(h.deps, new SyncState());
  const edits = new EditSync(h.deps, fullSync, queue);

  return { ...h, fullSync, edits };
}

function _queueOf(events: IngestEvent[]): QueueState {
  return { events, attemptCount: 0, nextAttemptAt: 0 };
}

function _expectedIngest(
  h: SyncHarness,
  events: IngestEventV1[],
  protocol: 1,
): IngestBody;
function _expectedIngest(
  h: SyncHarness,
  events: IngestEventV2[],
  protocol: 2,
): IngestBody;
function _expectedIngest(
  h: SyncHarness,
  events: IngestEventV1[] | IngestEventV2[],
  protocol: 1 | 2,
): IngestBody {
  const env = envelope("vault-1", "Vault", new Date(h.now.value));

  return protocol === 1
    ? ingestBody(events as IngestEventV1[], 1, env)
    : ingestBody(events as IngestEventV2[], 2, env);
}

async function _edited(h: EditSyncHarness, path = NOTE): Promise<void> {
  h.edits.onUpsert({ path });
  h.timers.fireAll();
  await settle();
}
