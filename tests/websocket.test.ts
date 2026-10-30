import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ObsidianWebSocketManager,
  parseServerMessage,
  type WsClientMessage,
} from "@/websocket";

const HELLO: WsClientMessage = {
  type: "hello",
  protocol: 2,
  pluginVersion: "1.1.0",
};

class FakeSocket {
  static readonly OPEN = 1;
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  private readonly listeners = new Map<string, Array<(e: unknown) => void>>();

  constructor(
    readonly url: string,
    readonly protocol: string,
  ) {
    FakeSocket.all.push(this);
  }

  addEventListener(type: string, fn: (e: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {}

  emit(type: string, event: unknown = {}): void {
    if (type === "open") this.readyState = FakeSocket.OPEN;
    for (const fn of this.listeners.get(type) ?? []) fn(event);
  }
}

function withFakeSocket() {
  FakeSocket.all = [];
  const timers: Array<() => void> = [];
  const g = globalThis as Record<string, unknown>;
  g.WebSocket = FakeSocket;
  g.window = {
    setTimeout: (fn: () => void) => timers.push(fn),
    clearTimeout: () => {},
  };
  return { timers };
}

function managerOptions(events: string[]) {
  return {
    endpoint: "http://localhost:8000/integrations/obsidian",
    token: "abc123",
    onManifestRequest: () => void events.push("manifest_request"),
    onScopeChanged: (folders: string[]) =>
      void events.push(`scope:${folders.join(",")}`),
    onTokenRejected: () => void events.push("token_rejected"),
    onContentRequested: (id: string, paths: string[]) =>
      void events.push(`content:${id}:${paths.join(",")}`),
    onOpen: () => void events.push("open"),
  };
}

test("open runs the open handler and content_requested reaches its handler", async () => {
  withFakeSocket();
  const events: string[] = [];
  const manager = new ObsidianWebSocketManager();

  manager.start(managerOptions(events));
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
  await new Promise((r) => setTimeout(r, 0));

  assert.deepEqual(events, ["open", "content:r1:a.md"]);
  assert.deepEqual(ws.sent, [JSON.stringify(HELLO)]);
  manager.stop();
});

test("a late close from the replaced socket leaves the new one alone", async () => {
  const { timers } = withFakeSocket();
  const events: string[] = [];
  const manager = new ObsidianWebSocketManager();

  manager.start(managerOptions(events));
  const [old] = FakeSocket.all;
  manager.start(managerOptions(events));
  const [, current] = FakeSocket.all;
  current.emit("open");

  old.emit("close", { code: 1006, reason: "" });
  old.emit("message", { data: '{"type":"manifest_request"}' });
  manager.send(HELLO);
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(FakeSocket.all.length, 2);
  assert.equal(timers.length, 0);
  assert.deepEqual(current.sent, [JSON.stringify(HELLO)]);
  assert.deepEqual(events, ["open"]);
  manager.stop();
});

test("a message the plugin can't parse is logged", async () => {
  withFakeSocket();
  const warnings: unknown[][] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => void warnings.push(args);
  const manager = new ObsidianWebSocketManager();

  try {
    manager.start(managerOptions([]));
    FakeSocket.all[0].emit("message", {
      data: '{"type":"content_requested","paths":"x"}',
    });
    await new Promise((r) => setTimeout(r, 0));
  } finally {
    console.warn = warn;
    manager.stop();
  }

  assert.equal(warnings.length, 1);
});

test("content_requested with no usable paths is ignored", () => {
  assert.equal(
    parseServerMessage(
      JSON.stringify({ type: "content_requested", request_id: "r", paths: [] }),
    ),
    null,
  );
  assert.equal(
    parseServerMessage(
      JSON.stringify({
        type: "content_requested",
        request_id: "r",
        paths: [1, {}],
      }),
    ),
    null,
  );
});

test("content_requested with request_id and a list of paths", () => {
  assert.deepEqual(
    parseServerMessage(
      JSON.stringify({ type: "content_requested", request_id: "r1", paths: ["a.md", "b.md"] }),
    ),
    { type: "content_requested", requestId: "r1", paths: ["a.md", "b.md"] },
  );
});

test("content_requested also takes {path} items and requestId", () => {
  assert.deepEqual(
    parseServerMessage(
      JSON.stringify({
        type: "content_requested",
        requestId: "r2",
        paths: [{ path: "a.md", hash: "x" }, "b.md", 3],
      }),
    ),
    { type: "content_requested", requestId: "r2", paths: ["a.md", "b.md"] },
  );
});

test("content_requested without an id is ignored", () => {
  assert.equal(
    parseServerMessage(JSON.stringify({ type: "content_requested", paths: ["a.md"] })),
    null,
  );
});

test("existing messages still parse", () => {
  assert.deepEqual(parseServerMessage('{"type":"manifest_request"}'), {
    type: "manifest_request",
  });
  assert.deepEqual(parseServerMessage('{"type":"scope_changed","folders":["/"]}'), {
    type: "scope_changed",
    folders: ["/"],
  });
});
