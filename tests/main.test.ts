// The plugin's own wiring around the protocol: what `main.ts` sends for an
// edit, against a fake server, and what a normal load and unload do.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";

import type { PluginManifest } from "obsidian";

import type {
  MyBrainSettings,
  PendingUpload,
  ServerProtocol,
  StoredData,
} from "@/core/sync/types";
import MyBrainPlugin, { composeServices } from "@/main";

import { setFakeServer } from "@test/stubs/obsidian";
import { FakeSocket, installFakeSocket } from "@test/support/fake-socket";
import {
  FakePluginData,
  deferred,
  initialData,
  settle,
} from "@test/support/fakes";
import type {
  ApiCall,
  ClientTimeBody,
  FakeRequest,
  FakeResponse,
  IngestedEvent,
  SavedData,
  ServerResponder,
  TestVault,
} from "@test/support/types";
import { createVault } from "@test/support/vault";

const NOTE = "Notes/a.md";
const OTHER = "Notes/c.md";
const PDF = "Notes/scan.pdf";
const MANIFEST = { id: "mybrain-ai", version: "1.1.0" } as PluginManifest;

const CONNECTED: Partial<MyBrainSettings> = {
  endpoint: "https://api.test",
  token: "test-token",
  vaultId: "vault-1",
  vaultName: "Vault",
  serverProtocol: 2,
  lastSyncAt: 5,
};

const ACK = { accepted: 1, rejected: [], attachmentsNeeded: [] };

// Timers fire when the test says so; intervals never do.
const pendingTimers = new Map<number, () => void>();
let nextTimerId = 1;

(globalThis as Record<string, unknown>).window = {
  setTimeout: (fn: () => void) => {
    const id = nextTimerId++;

    pendingTimers.set(id, fn);

    return id;
  },
  clearTimeout: (id: number) => void pendingTimers.delete(id),
  setInterval: () => 0,
};

beforeEach(() => {
  pendingTimers.clear();
  installFakeSocket();
});

afterEach(() => setFakeServer(null));

test("unloading after a failed load does not throw", async () => {
  const plugin = new MyBrainPlugin(createVault({ notes: [] }).app, MANIFEST);

  plugin.loadData = () => Promise.reject(new Error("unreadable data.json"));

  await assert.rejects(plugin.onload(), /unreadable data\.json/);
  assert.doesNotThrow(() => plugin.onunload());
});

test("an autosave of an unchanged note sends nothing", async () => {
  const { services, vault, sent } = _setup(2, true);

  await _edited(services, vault);
  await _edited(services, vault);

  assert.deepEqual(
    sent.map((s) => s.path),
    ["/ingest"],
  );
});

test("first edit after updating from 1.0.x: the probe learns protocol 2 and the edit carries no text", async () => {
  const { services, vault, sent } = _setup(null, true);

  await _edited(services, vault);

  assert.deepEqual(
    sent.map((s) => s.path),
    ["/manifest", "/ingest"],
  );
  assert.equal(sent[0].body.protocol, 2);
  assert.equal(sent[1].body.protocol, 2);
  assert.equal(JSON.stringify(sent).includes("Hello there."), false);
  assert.equal(services.settings.serverProtocol, 2);
});

test("first edit against an old server: the probe sends no text, the edit goes as 1.0.x", async () => {
  const { services, vault, sent } = _setup(null, false);

  await _edited(services, vault);

  assert.deepEqual(
    sent.map((s) => s.path),
    ["/manifest", "/ingest"],
  );
  assert.equal(JSON.stringify(sent[0].body).includes("Hello there."), false);
  assert.equal(sent[1].body.protocol, undefined);
  assert.equal(JSON.stringify(sent[1].body).includes("Hello there."), true);
  assert.equal(services.settings.serverProtocol, 1);
});

test("a refused protocol 2 edit is never re-sent as protocol 1 with its text", async () => {
  const { services, vault, sent } = _setup(2, false);

  await _edited(services, vault);

  assert.deepEqual(
    sent.map((s) => s.path),
    ["/ingest"],
  );
  assert.equal(JSON.stringify(sent).includes("Hello there."), false);
  assert.equal(services.settings.serverProtocol, 2);
});

test("an edit goes to /ingest as exactly this JSON", async () => {
  const { services, vault } = _setup(2, true);
  const raw: string[] = [];

  setFakeServer((request: FakeRequest) => {
    raw.push(request.body as string);

    return { status: 200, json: ACK };
  });

  await _edited(services, vault);

  const { clientTime } = JSON.parse(raw[0]) as ClientTimeBody;
  const hash = createHash("sha256").update("Hello there.\n").digest("hex");

  assert.equal(raw.length, 1);
  assert.equal(
    raw[0],
    `{"protocol":2,"apiVersion":1,"vaultId":"vault-1","vaultName":"Test vault","clientTime":"${clientTime}","events":[{"op":"upsert","path":"Notes/a.md","name":"a","ext":"md","size":13,"ctime":1,"mtime":1,"hash":"${hash}","words":2,"frontmatter":null,"tags":[],"links":[],"unresolved":[],"embeds":[],"attachments":[]}]}`,
  );
});

test("save writes the live settings and queue, in that order, and never the device id", async () => {
  const { services, vault, store } = _setup(2, true);
  const warn = console.warn;

  setFakeServer(() => ({ status: 500, json: {} }));
  console.warn = () => {};

  try {
    await _edited(services, vault);
  } finally {
    console.warn = warn;
  }

  await services.save();

  const last = store.saved[store.saved.length - 1];

  assert.deepEqual(Object.keys(last), ["settings", "queue"]);
  assert.deepEqual(last.settings, services.settings);
  assert.deepEqual(last.queue, services.editSync.queued());
  assert.equal(last.queue.attemptCount, 1);
  assert.deepEqual(
    last.queue.events.map((e) => [e.op, "path" in e ? e.path : null]),
    [["upsert", NOTE]],
  );
  assert.equal("deviceId" in last.settings, false);
  assert.equal(JSON.stringify(store.saved).includes("device-1"), false);
});

test("a load fills an empty vault identity and saves it", async () => {
  const { saved } = await _loadPlugin({
    ...CONNECTED,
    vaultId: "",
    vaultName: "",
  });

  assert.equal(saved[0].data.settings.vaultName, "Test vault");
  assert.match(saved[0].data.settings.vaultId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(Object.keys(saved[0].data), ["settings", "queue"]);
});

test("a vault identity that fails to save doesn't stop the plugin from starting", async () => {
  const vault = _testVault();
  const layoutReady: Array<() => void> = [];

  _fakeServer([], _defaultResponder);
  Object.assign(vault.app, {
    workspace: { onLayoutReady: (fn: () => void) => layoutReady.push(fn) },
    loadLocalStorage: () => null,
    saveLocalStorage: () => {},
  });

  const plugin = new MyBrainPlugin(vault.app, MANIFEST);

  plugin.loadData = async () => ({
    settings: { ...CONNECTED, vaultId: "", vaultName: "" },
  });
  plugin.saveData = () => Promise.reject(new Error("disk full"));

  await plugin.onload();

  assert.equal(layoutReady.length, 1);

  layoutReady[0]();
  await settle();

  assert.equal(FakeSocket.all.length, 1);
});

test("after layout ready, note events map to their ingest events and other files are ignored", async () => {
  const { vault, ingested } = await _loadPlugin();
  const pdf = vault.file(PDF);

  vault.emit("modify", vault.file(NOTE));
  vault.emit("modify", pdf);
  vault.emit("create", vault.file(OTHER));
  vault.emit("create", pdf);
  _fireTimers();
  await settle();

  // The two upserts hash concurrently, so their order is not fixed.
  assert.deepEqual(ingested().sort(), [`upsert:${NOTE}`, `upsert:${OTHER}`]);

  vault.rename(NOTE, "Notes/b.md");
  vault.emit("rename", vault.file("Notes/b.md"), NOTE);
  vault.rename(PDF, "Notes/moved.pdf");
  vault.emit("rename", pdf, PDF);
  _fireTimers();
  await settle();

  assert.deepEqual(ingested().slice(2), [`rename:${NOTE}>Notes/b.md`]);

  vault.emit("delete", vault.file(OTHER));
  vault.emit("delete", pdf);
  _fireTimers();
  await settle();

  assert.deepEqual(ingested().slice(3), [`delete:${OTHER}`]);
});

test("the socket opens with the token only when the plugin can sync", async () => {
  await _loadPlugin();

  assert.equal(FakeSocket.all.length, 1);
  assert.equal(FakeSocket.all[0].protocol, "bearer.test-token");

  installFakeSocket();
  await _loadPlugin({ ...CONNECTED, token: "" });

  assert.equal(FakeSocket.all.length, 0);
});

test("a new token restarts the socket and drops content requests made before it", async () => {
  const blocked = deferred<FakeResponse>();
  const { plugin, sent } = await _loadPlugin(CONNECTED, (path) =>
    path === "/content" ? blocked.promise : _defaultResponder(path),
  );
  const [old] = FakeSocket.all;
  const contentSends = () => sent.filter((s) => s.path === "/content").length;

  old.emit("open");
  old.emit("message", {
    data: JSON.stringify({
      type: "content_requested",
      requestId: "r1",
      paths: [NOTE],
    }),
  });
  await settle();
  old.emit("message", {
    data: JSON.stringify({
      type: "content_requested",
      requestId: "r2",
      paths: [OTHER],
    }),
  });
  await settle();

  assert.equal(contentSends(), 1);

  await plugin.saveToken("new-token");
  _fireTimers();
  blocked.resolve({ status: 200, json: ACK });
  await settle();

  assert.equal(old.closed, true);
  assert.equal(FakeSocket.all.length, 2);
  assert.equal(FakeSocket.all[1].protocol, "bearer.new-token");
  // r2 was still queued under the old token: it is gone, not sent.
  assert.equal(contentSends(), 1);

  await plugin.saveToken("");
  _fireTimers();

  assert.equal(FakeSocket.all[1].closed, true);
  assert.equal(FakeSocket.all.length, 2);
});

test("a socket restart still pending at unload never opens a socket", async () => {
  const { plugin } = await _loadPlugin();
  const [old] = FakeSocket.all;

  await plugin.saveToken("new-token");
  plugin.onunload();
  _fireTimers();
  await settle();

  assert.equal(old.closed, true);
  assert.equal(FakeSocket.all.length, 1);
});

test("unloading after a load stops edits, content requests and the socket, then saves once", async () => {
  const { plugin, vault, saved, ingested } = await _loadPlugin();
  const before = saved.length;

  vault.emit("modify", vault.file(NOTE));
  plugin.onunload();
  _fireTimers();
  await settle();

  assert.equal(saved.length, before + 1);
  assert.deepEqual(saved[before].socketClosed, [true]);
  assert.deepEqual(Object.keys(saved[before].data), ["settings", "queue"]);
  assert.deepEqual(ingested(), []);
});

test("an attachment that fails to upload after an edit is kept on the device and retried", async (t) => {
  const uploads: FakeResponse = { status: 500 };
  const { plugin, vault, storage, sent } = await _loadPlugin(
    { ...CONNECTED, serverProtocol: 1 },
    _attachmentServer(uploads),
    _vaultWithEmbed(),
  );
  const attempts = () => sent.filter((s) => s.path === "/attachments").length;

  vault.emit("modify", vault.file(NOTE));
  _fireTimers();
  await settle();

  assert.equal(attempts(), 1);
  assert.deepEqual(
    plugin.pendingUploads().map((p) => [p.path, p.state]),
    [[PDF, "retrying"]],
  );
  assert.equal(
    (JSON.parse(storage.get("mybrain-pending-uploads") ?? "[]") as unknown[])
      .length,
    1,
  );

  // Timers here fire at once, so the clock has to reach the retry time.
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 60_000 });
  uploads.status = 204;
  _fireTimers();
  await settle();

  assert.equal(attempts(), 2);
  assert.deepEqual(plugin.pendingUploads(), []);
});

test("uploads saved on the device before a restart go out after it", async () => {
  const entry: PendingUpload = {
    ref: { path: PDF, ext: "pdf", size: 1, mtime: 1, hash: "h-pdf" },
    path: PDF,
    state: "given-up",
    attempts: 3,
    nextAttemptAt: 0,
    firstFailedAt: 0,
    lastError: "network down",
  };
  const storage = new Map([
    ["mybrain-pending-uploads", JSON.stringify([entry])],
  ]);
  const { plugin, sent } = await _loadPlugin(
    CONNECTED,
    _defaultResponder,
    _vaultWithEmbed(),
    storage,
  );

  _fireTimers();
  await settle();

  assert.equal(sent.filter((s) => s.path === "/attachments").length, 1);
  assert.deepEqual(plugin.pendingUploads(), []);
  assert.equal(storage.get("mybrain-pending-uploads"), "[]");
});

test("after unload a failed upload is not retried", async () => {
  const { plugin, vault, sent } = await _loadPlugin(
    { ...CONNECTED, serverProtocol: 1 },
    _attachmentServer({ status: 500 }),
    _vaultWithEmbed(),
  );

  vault.emit("modify", vault.file(NOTE));
  _fireTimers();
  await settle();
  plugin.onunload();
  _fireTimers();
  await settle();

  assert.equal(sent.filter((s) => s.path === "/attachments").length, 1);
});

/** Asks for every attachment an edit references, and answers uploads with
 * `uploads.status`. */
function _attachmentServer(uploads: FakeResponse): ServerResponder {
  return (path, body) => {
    if (path === "/attachments") return { status: uploads.status };

    if (path === "/ingest") {
      const events = body.events as IngestedEvent[];

      return {
        status: 200,
        json: {
          ...ACK,
          attachmentsNeeded: events.flatMap((e) =>
            (e.attachments ?? []).map((a) => a.hash),
          ),
        },
      };
    }

    return _defaultResponder(path);
  };
}

function _vaultWithEmbed(): TestVault {
  return createVault({
    notes: [
      {
        path: NOTE,
        content: "![[scan.pdf]]\n",
        ctime: 1,
        mtime: 1,
        embeds: ["scan.pdf"],
      },
    ],
    binaries: [{ path: PDF, bytes: new Uint8Array([1]), ctime: 1, mtime: 1 }],
  });
}

function _fireTimers(): void {
  const due = Array.from(pendingTimers.values());

  pendingTimers.clear();
  due.forEach((fire) => fire());
}

/** Answer every request through `respond` and record it. */
function _fakeServer(sent: ApiCall[], respond: ServerResponder): void {
  setFakeServer((request: FakeRequest) => {
    const path = request.url.replace("https://api.test", "");
    const body = JSON.parse(
      typeof request.body === "string" ? request.body : "{}",
    ) as Record<string, unknown>;

    sent.push({ path, body });

    return respond(path, body);
  });
}

function _defaultResponder(path: string): FakeResponse {
  if (path === "/manifest" || path === "/latest-release")
    return { status: 204 };

  return { status: 200, json: ACK };
}

function _testVault(): TestVault {
  return createVault({
    notes: [
      { path: NOTE, content: "Hello there.\n", ctime: 1, mtime: 1 },
      { path: OTHER, content: "Other.\n", ctime: 1, mtime: 1 },
    ],
    binaries: [{ path: PDF, bytes: new Uint8Array([1]), ctime: 1, mtime: 1 }],
  });
}

function _setup(serverProtocol: ServerProtocol | null, speaksV2: boolean) {
  const vault = _testVault();
  const sent: ApiCall[] = [];

  _fakeServer(sent, (path, body) => {
    if (body.protocol === 2 && !speaksV2) return { status: 422, json: {} };

    return path === "/manifest" ? { status: 204 } : { status: 200, json: ACK };
  });

  Object.assign(vault.app, {
    loadLocalStorage: () => "device-1",
    saveLocalStorage: () => {},
  });

  const initial = initialData({
    endpoint: "https://api.test",
    token: "test-token",
    vaultId: "vault-1",
    serverProtocol,
  });
  const store = new FakePluginData(initial);
  const services = composeServices(
    vault.app,
    MANIFEST,
    store,
    initial,
    () => {},
  );

  return { services, vault, sent, store };
}

/** A `modify` of the note, through the debounce, until its drain is done. */
async function _edited(
  services: ReturnType<typeof _setup>["services"],
  vault: TestVault,
): Promise<void> {
  services.editSync.onUpsert(vault.file(NOTE));
  _fireTimers();
  await settle();
}

/** A plugin through `onload` and `onLayoutReady`, against a fake server. */
async function _loadPlugin(
  settings: Partial<MyBrainSettings> = CONNECTED,
  respond: ServerResponder = _defaultResponder,
  vault: TestVault = _testVault(),
  storage = new Map<string, string>(),
) {
  const sent: ApiCall[] = [];
  const saved: SavedData[] = [];
  const layoutReady: Array<() => void> = [];

  _fakeServer(sent, respond);
  Object.assign(vault.app, {
    workspace: { onLayoutReady: (fn: () => void) => layoutReady.push(fn) },
    loadLocalStorage: (key: string) => storage.get(key) ?? null,
    saveLocalStorage: (key: string, value: string) => storage.set(key, value),
  });

  const plugin = new MyBrainPlugin(vault.app, MANIFEST);

  plugin.loadData = async () => ({ settings });
  plugin.saveData = async (data: unknown) => {
    saved.push({
      data: structuredClone(data) as StoredData,
      socketClosed: FakeSocket.all.map((s) => s.closed),
    });
  };

  await plugin.onload();
  layoutReady.forEach((fn) => fn());
  await settle();

  const ingested = () =>
    sent
      .filter((s) => s.path === "/ingest")
      .flatMap((s) => s.body.events as Array<Record<string, string>>)
      .map((e) =>
        e.op === "rename"
          ? `rename:${e.oldPath}>${e.newPath}`
          : `${e.op}:${e.path}`,
      );

  return { plugin, vault, sent, saved, storage, ingested };
}
