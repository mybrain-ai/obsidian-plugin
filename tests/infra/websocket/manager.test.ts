import assert from "node:assert/strict";
import { test } from "node:test";

import { TOKEN_REJECTED_NOTICE } from "@/core/constants";
import { serverEventHandlers } from "@/core/sync/server-events";
import type { WsClientMessage } from "@/core/sync/types";
import { ObsidianWebSocketManager } from "@/infra/websocket/manager";

import { FakeSocket, installFakeSocket } from "@test/support/fake-socket";
import {
  FakeNotifier,
  FakeTimers,
  settle,
  syncHarness,
} from "@test/support/fakes";

const HELLO: WsClientMessage = {
  type: "hello",
  protocol: 2,
  pluginVersion: "1.1.0",
};

const CONNECTION = {
  endpoint: "http://localhost:8000/integrations/obsidian",
  token: "abc123",
};

test("open runs the open handler and content_requested reaches its handler", async () => {
  _withFakeSocket();
  const events: string[] = [];
  const manager = _newManager();

  manager.start(_managerOptions(events));
  const [ws] = FakeSocket.all;

  ws.emit("open");
  manager.send(HELLO);
  ws.emit("message", {
    data: JSON.stringify({
      type: "content_requested",
      request_id: "r1",
      paths: ["a.md"],
    }),
  });
  await settle(1);

  assert.deepEqual(events, ["open", "content:r1:a.md"]);
  assert.deepEqual(ws.sent, [JSON.stringify(HELLO)]);
  manager.stop();
});

test("a late close from the replaced socket leaves the new one alone", async () => {
  const { timers } = _withFakeSocket();
  const events: string[] = [];
  const manager = _newManager(new FakeNotifier(), timers);

  manager.start(_managerOptions(events));
  const [old] = FakeSocket.all;

  manager.start(_managerOptions(events));
  const [, current] = FakeSocket.all;

  current.emit("open");

  old.emit("close", { code: 1006, reason: "" });
  old.emit("message", { data: '{"type":"manifest_request"}' });
  manager.send(HELLO);
  await settle(1);

  assert.equal(FakeSocket.all.length, 2);
  assert.equal(timers.delays.length, 0);
  assert.deepEqual(current.sent, [JSON.stringify(HELLO)]);
  assert.deepEqual(events, ["open"]);
  manager.stop();
});

test("a message the plugin can't parse is logged", async () => {
  _withFakeSocket();
  const warnings: unknown[][] = [];
  const warn = console.warn;

  console.warn = (...args: unknown[]) => void warnings.push(args);
  const manager = _newManager();

  try {
    manager.start(_managerOptions([]));
    FakeSocket.all[0].emit("message", {
      data: '{"type":"content_requested","paths":"x"}',
    });
    await settle(1);
  } finally {
    console.warn = warn;
    manager.stop();
  }

  assert.equal(warnings.length, 1);
});

test("4401 reports a rejected token and leaves the notice to its handler, no reconnect", () => {
  const { timers } = _withFakeSocket();
  const events: string[] = [];
  const notifier = new FakeNotifier();
  const manager = _newManager(notifier, timers);

  manager.start(_managerOptions(events));
  FakeSocket.all[0].emit("close", { code: 4401, reason: "" });

  assert.deepEqual(events, ["token_rejected"]);
  assert.deepEqual(notifier.messages, []);
  assert.equal(timers.delays.length, 0);
});

test("4401 through the real server-event handlers shows exactly one notice and flags the token", () => {
  const { timers } = _withFakeSocket();
  const h = syncHarness([]);
  const manager = _newManager(h.notifier, timers);

  manager.start(
    serverEventHandlers({
      ...h.deps,
      channel: manager,
      fullSync: { push: async () => true },
      contentQueue: { request: () => {} },
    }),
  );
  FakeSocket.all[0].emit("close", { code: 4401, reason: "" });

  assert.deepEqual(h.notifier.messages, [TOKEN_REJECTED_NOTICE]);
  assert.equal(h.deps.auth.rejected, true);
  assert.equal(timers.delays.length, 0);
});

test("1008, 1011 and 4403 stop reconnecting with a notice", () => {
  for (const code of [1008, 1011, 4403]) {
    const { timers } = _withFakeSocket();
    const notifier = new FakeNotifier();
    const manager = _newManager(notifier, timers);

    manager.start(_managerOptions([]));
    FakeSocket.all[0].emit("close", { code, reason: "" });

    assert.deepEqual(notifier.messages, [
      `MyBrain: WebSocket rejected (code ${code}). Will retry on next plugin restart.`,
    ]);
    assert.equal(timers.delays.length, 0);
  }
});

test("an ordinary close schedules a reconnect that opens a new socket", () => {
  const { timers } = _withFakeSocket();
  const manager = _newManager(new FakeNotifier(), timers);

  manager.start(_managerOptions([]));
  FakeSocket.all[0].emit("close", { code: 1006, reason: "" });

  assert.equal(timers.delays.length, 1);
  timers.fireAll();
  assert.equal(FakeSocket.all.length, 2);
  manager.stop();
});

test("the socket opens with the bearer subprotocol on the ws url", () => {
  _withFakeSocket();
  const manager = _newManager();

  manager.start(_managerOptions([]));

  assert.equal(
    FakeSocket.all[0].url,
    "ws://localhost:8000/integrations/obsidian/ws",
  );
  assert.equal(FakeSocket.all[0].protocol, "bearer.abc123");
  manager.stop();
});

test("a token with invalid characters never connects", () => {
  _withFakeSocket();
  const warn = console.warn;

  console.warn = () => {};

  try {
    const manager = _newManager(undefined, undefined, () => ({
      ...CONNECTION,
      token: "bad token",
    }));

    manager.start(_managerOptions([]));
  } finally {
    console.warn = warn;
  }

  assert.equal(FakeSocket.all.length, 0);
});

test("restarting reads the connection again", () => {
  _withFakeSocket();
  let token = "first";
  const manager = _newManager(undefined, undefined, () => ({
    endpoint: CONNECTION.endpoint,
    token,
  }));

  manager.start(_managerOptions([]));
  token = "second";
  manager.stop();
  manager.start(_managerOptions([]));

  assert.deepEqual(
    FakeSocket.all.map((s) => s.protocol),
    ["bearer.first", "bearer.second"],
  );
  manager.stop();
});

test("a reconnect keeps the connection captured at start", () => {
  const { timers } = _withFakeSocket();
  let token = "first";
  const manager = _newManager(undefined, timers, () => ({
    endpoint: CONNECTION.endpoint,
    token,
  }));

  manager.start(_managerOptions([]));
  FakeSocket.all[0].emit("close", { code: 1006, reason: "" });
  token = "second";
  timers.fireAll();

  assert.equal(FakeSocket.all[1].protocol, "bearer.first");
  manager.stop();
});

test("an invalid endpoint opens no socket and logs a warning", () => {
  _withFakeSocket();
  const warnings: unknown[][] = [];
  const warn = console.warn;

  console.warn = (...args: unknown[]) => void warnings.push(args);

  try {
    const manager = _newManager(undefined, undefined, () => ({
      endpoint: "ftp://nope",
      token: "abc123",
    }));

    manager.start(_managerOptions([]));
  } finally {
    console.warn = warn;
  }

  assert.equal(FakeSocket.all.length, 0);
  assert.deepEqual(warnings, [["MyBrain WS: invalid endpoint", "ftp://nope"]]);
});

function _withFakeSocket() {
  installFakeSocket();

  return { timers: new FakeTimers() };
}

function _newManager(
  notifier = new FakeNotifier(),
  timers = new FakeTimers(),
  connection = () => CONNECTION,
) {
  return new ObsidianWebSocketManager(connection, notifier, timers);
}

function _managerOptions(events: string[]) {
  return {
    onManifestRequest: () => void events.push("manifest_request"),
    onScopeChanged: (folders: string[]) =>
      void events.push(`scope:${folders.join(",")}`),
    onTokenRejected: () => void events.push("token_rejected"),
    onContentRequested: (id: string, paths: string[]) =>
      void events.push(`content:${id}:${paths.join(",")}`),
    onOpen: () => void events.push("open"),
  };
}
