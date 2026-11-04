import assert from "node:assert/strict";
import { test } from "node:test";

import type { ObsidianProtocolData } from "obsidian";

import { defaultSettings } from "@/core/sync/settings";
import type { DeepLinkSettings, MyBrainSettings } from "@/core/sync/types";
import {
  registerInstallProtocolHandler,
  registerOpenProtocolHandler,
} from "@/ui/deep-link";
import type { PluginFacade } from "@/ui/types";

import { Modal } from "@test/stubs/obsidian";
import { FakeNotifier } from "@test/support/fakes";

const TOKEN = "mbr_sk_live_aaaaaaaaaaaa";

test("an install link without a token is refused with a notice", async () => {
  const h = _plugin();

  await h.open("mybrain/install", {});

  assert.deepEqual(h.notifier.messages, ["MyBrain: deep-link missing token"]);
  assert.deepEqual(h.applied, []);
});

test("an install link with a malformed token is refused", async () => {
  const h = _plugin();

  await h.open("mybrain/install", { token: "short" });

  assert.deepEqual(h.notifier.messages, [
    "MyBrain: deep-link token has invalid format",
  ]);
});

test("an install link with a non-https endpoint is refused", async () => {
  const h = _plugin();

  await h.open("mybrain/install", {
    token: TOKEN,
    endpoint: "http://api.example",
  });

  assert.deepEqual(h.notifier.messages, [
    "MyBrain: deep-link endpoint must be a valid HTTPS URL",
  ]);
});

test("a link matching the settings changes nothing and opens the settings", async () => {
  const h = _plugin({ token: TOKEN, endpoint: "https://api.example" });

  await h.open("mybrain/install", {
    token: ` ${TOKEN} `,
    endpoint: "https://api.example/",
  });

  assert.deepEqual(h.notifier.messages, [
    "MyBrain: deep-link settings already match",
  ]);
  assert.deepEqual(h.applied, []);
  assert.equal(h.layoutCallbacks.length, 1);
});

test("an install link whose settings can't be saved says to open it again", async () => {
  const h = _plugin({}, async () => {
    throw new Error("disk full");
  });
  const opening = h.open("mybrain/install", { token: TOKEN });

  Modal.all.at(-1)?.contentEl.button("Apply")?.click();
  await opening;

  assert.deepEqual(h.notifier.messages, [
    "MyBrain: couldn't save the settings from the link. Open the link again.",
  ]);
  assert.equal(h.layoutCallbacks.length, 0);
});

test("an open link opens the settings once the layout is ready", async () => {
  const h = _plugin();

  await h.open("mybrain/open", {});

  assert.equal(h.layoutCallbacks.length, 1);
  assert.deepEqual(h.notifier.messages, []);
});

function _plugin(
  settings: Partial<MyBrainSettings> = {},
  apply?: (incoming: DeepLinkSettings) => Promise<void>,
) {
  const handlers = new Map<string, (params: ObsidianProtocolData) => unknown>();
  const notifier = new FakeNotifier();
  const applied: DeepLinkSettings[] = [];
  const layoutCallbacks: Array<() => void> = [];
  const plugin = {
    app: {
      workspace: {
        onLayoutReady: (fn: () => void) => void layoutCallbacks.push(fn),
      },
    },
    manifest: { id: "mybrain-ai" },
    settings: { ...defaultSettings(), ...settings },
    notifier,
    applyDeepLinkSettings:
      apply ??
      (async (incoming: DeepLinkSettings) => {
        applied.push(incoming);
      }),
    registerObsidianProtocolHandler: (
      action: string,
      handler: (params: ObsidianProtocolData) => unknown,
    ) => {
      handlers.set(action, handler);
    },
  } as unknown as PluginFacade;

  registerInstallProtocolHandler(plugin);
  registerOpenProtocolHandler(plugin);

  return {
    notifier,
    applied,
    layoutCallbacks,
    open: async (action: string, params: Record<string, string>) => {
      await handlers.get(action)?.({ action, ...params });
    },
  };
}
