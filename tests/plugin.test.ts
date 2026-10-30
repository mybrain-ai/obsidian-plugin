// The plugin's own wiring around the protocol: what `main.ts` sends for an
// edit, against a fake server.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { PluginManifest } from "obsidian";
import MyBrainPlugin from "@/main";
import { DEFAULT_SETTINGS } from "@/settings";
import type { ServerProtocol } from "@/types";
import { setFakeServer, type FakeRequest } from "./stubs/obsidian";
import { createVault, type TestVault } from "./vault";

type Sent = { path: string; body: Record<string, unknown> };

const NOTE = "Notes/a.md";

function setup(serverProtocol: ServerProtocol | null, speaksV2: boolean) {
  const vault = createVault({
    notes: [{ path: NOTE, content: "Hello there.\n", ctime: 1, mtime: 1 }],
  });
  const sent: Sent[] = [];

  setFakeServer((request: FakeRequest) => {
    const path = request.url.replace("https://api.test", "");
    const body = JSON.parse(
      typeof request.body === "string" ? request.body : "{}",
    ) as Record<string, unknown>;
    sent.push({ path, body });

    if (body.protocol === 2 && !speaksV2) return { status: 422, json: {} };
    if (path === "/manifest") return { status: 204 };

    return {
      status: 200,
      json: { accepted: 1, rejected: [], attachmentsNeeded: [] },
    };
  });

  const plugin = new MyBrainPlugin(vault.app, {
    id: "mybrain-ai",
    version: "1.1.0",
  } as PluginManifest);
  plugin.settings = {
    ...DEFAULT_SETTINGS,
    endpoint: "https://api.test",
    token: "test-token",
    vaultId: "vault-1",
    serverProtocol,
  };

  return { plugin, vault, sent };
}

// The upsert path as the `modify` handler reaches it (after the debounce).
async function edited(plugin: MyBrainPlugin, vault: TestVault): Promise<void> {
  await (
    plugin as unknown as { enqueueUpsertEvent(f: unknown): Promise<void> }
  ).enqueueUpsertEvent(vault.file(NOTE));
  // The drain it starts runs on its own; let it finish.
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

test("an autosave of an unchanged note sends nothing", async () => {
  const { plugin, vault, sent } = setup(2, true);

  await edited(plugin, vault);
  await edited(plugin, vault);

  assert.deepEqual(
    sent.map((s) => s.path),
    ["/ingest"],
  );
  setFakeServer(null);
});

test("first edit after updating from 1.0.x: the probe learns protocol 2 and the edit carries no text", async () => {
  const { plugin, vault, sent } = setup(null, true);

  await edited(plugin, vault);

  assert.deepEqual(
    sent.map((s) => s.path),
    ["/manifest", "/ingest"],
  );
  assert.equal(sent[0].body.protocol, 2);
  assert.equal(sent[1].body.protocol, 2);
  assert.equal(JSON.stringify(sent).includes("Hello there."), false);
  assert.equal(plugin.settings.serverProtocol, 2);
  setFakeServer(null);
});

test("first edit against an old server: the probe sends no text, the edit goes as 1.0.x", async () => {
  const { plugin, vault, sent } = setup(null, false);

  await edited(plugin, vault);

  assert.deepEqual(
    sent.map((s) => s.path),
    ["/manifest", "/ingest"],
  );
  assert.equal(JSON.stringify(sent[0].body).includes("Hello there."), false);
  assert.equal(sent[1].body.protocol, undefined);
  assert.equal(JSON.stringify(sent[1].body).includes("Hello there."), true);
  assert.equal(plugin.settings.serverProtocol, 1);
  setFakeServer(null);
});

test("a refused protocol 2 edit is never re-sent as protocol 1 with its text", async () => {
  const { plugin, vault, sent } = setup(2, false);

  await edited(plugin, vault);

  assert.deepEqual(
    sent.map((s) => s.path),
    ["/ingest"],
  );
  assert.equal(JSON.stringify(sent).includes("Hello there."), false);
  assert.equal(plugin.settings.serverProtocol, 2);
  setFakeServer(null);
});
