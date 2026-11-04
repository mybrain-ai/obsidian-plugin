import assert from "node:assert/strict";
import { test } from "node:test";

import type { Plugin, SettingDefinitionRender } from "obsidian";

import { defaultSettings } from "@/core/sync/settings";
import type { PendingUpload } from "@/core/sync/types";
import { MyBrainSettingTab } from "@/ui/settings-tab";
import type { PluginFacade } from "@/ui/types";

import { type FakeElement, Setting } from "@test/stubs/obsidian";
import { FakeNotifier } from "@test/support/fakes";

test("the waiting-uploads row is hidden while nothing waits, and follows the list", async () => {
  const h = _setup();

  assert.equal(h.setting.settingEl.shown, false);
  assert.equal(_searchable(h.row), false);
  // Obsidian shows or hides a rendered row by `visible`, after `render`.
  assert.equal(_visible(h.row), false);

  h.pending = Array.from({ length: 12 }, (_, i) => _pending(`F/${i}.pdf`));
  h.changed();

  assert.equal(h.setting.settingEl.shown, true);
  assert.equal(_searchable(h.row), true);
  assert.equal(_visible(h.row), true);

  const texts = (h.setting.desc as FakeElement).texts();

  assert.equal(
    texts[0],
    "12 attachments are waiting to upload. They are retried automatically; ones MyBrain refused wait for Retry now.",
  );
  assert.equal(texts.length, 12);
  assert.equal(texts[1], "F/0.pdf — network down");
  assert.equal(texts.at(-1), "and 2 more");

  h.pending = [];
  h.changed();

  assert.equal(h.setting.settingEl.shown, false);
});

test("Retry now runs the retry, and the row stops listening once torn down", async () => {
  const h = _setup();

  await h.setting.settingEl.button("Retry now")?.click();

  assert.equal(h.retries(), 1);
  assert.equal(h.listeners.size, 1);

  h.cleanup?.();

  assert.equal(h.listeners.size, 0);
});

test("a failing Retry now is logged and the button is enabled again", async () => {
  const h = _setup(async () => {
    throw new Error("boom");
  });

  await h.setting.settingEl.button("Retry now")?.click();

  assert.equal(h.retries(), 0);
});

test("a token that can't be saved says to try again", async () => {
  const { tab, notifier } = _savingTab({
    saveToken: () => Promise.reject(new Error("disk full")),
  });
  const setting = new Setting();
  const row = _row(tab, "Bearer token");

  row.render(setting as never, {} as never);
  setting.text?.type("mbr_sk_live_new");
  await setting.controlEl.button("Save")?.click();

  assert.deepEqual(notifier.messages, [
    "MyBrain: couldn't save the token. Try again.",
  ]);
});

test("a setting that can't be saved says to try again and goes back to its old value", async () => {
  const { tab, notifier, settings } = _savingTab({
    saveSettings: () => Promise.reject(new Error("disk full")),
  });

  let redrawn = 0;

  tab.update = () => void redrawn++;
  await tab.setControlValue("syncAttachmentsOnMobile", true);

  assert.equal(settings.syncAttachmentsOnMobile, false);
  assert.equal(redrawn, 1);
  assert.deepEqual(notifier.messages, [
    "MyBrain: couldn't save the setting. Try again.",
  ]);
});

test("a setting that saves keeps its new value, with no notice", async () => {
  const { tab, notifier, settings } = _savingTab({});

  await tab.setControlValue("syncAttachmentsOnMobile", true);

  assert.equal(settings.syncAttachmentsOnMobile, true);
  assert.deepEqual(notifier.messages, []);
});

function _savingTab(overrides: {
  saveToken?: (token: string) => Promise<void>;
  saveSettings?: () => Promise<void>;
}) {
  const notifier = new FakeNotifier();
  const settings = defaultSettings();
  const plugin = {
    app: {},
    manifest: { id: "mybrain-ai", version: "1.2.0" },
    settings,
    notifier,
    saveToken: overrides.saveToken ?? (async () => {}),
    saveSettings: overrides.saveSettings ?? (async () => {}),
  } as unknown as Plugin & PluginFacade;

  return { tab: new MyBrainSettingTab(plugin), notifier, settings };
}

function _row(tab: MyBrainSettingTab, name: string): SettingDefinitionRender {
  return tab
    .getSettingDefinitions()
    .find((d) => "name" in d && d.name === name) as SettingDefinitionRender;
}

function _setup(retry?: () => Promise<void>) {
  const listeners = new Set<() => void>();
  let retries = 0;
  const state = { pending: [] as PendingUpload[] };
  const plugin = {
    app: {},
    manifest: { id: "mybrain-ai", version: "1.2.0" },
    settings: defaultSettings(),
    pendingUploads: () => state.pending,
    onPendingUploadsChange: (listener: () => void) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    retryUploads:
      retry ??
      (async () => {
        retries += 1;
      }),
  } as unknown as Plugin & PluginFacade;
  const row = new MyBrainSettingTab(plugin)
    .getSettingDefinitions()
    .find(
      (d) => "name" in d && d.name === "Attachments not uploaded",
    ) as SettingDefinitionRender;
  const setting = new Setting();
  const cleanup = row.render(setting as never, {} as never);

  return {
    row,
    setting,
    listeners,
    cleanup: cleanup ?? undefined,
    retries: () => retries,
    get pending() {
      return state.pending;
    },
    set pending(value: PendingUpload[]) {
      state.pending = value;
    },
    changed: () => listeners.forEach((listener) => listener()),
  };
}

function _visible(row: SettingDefinitionRender): boolean {
  return typeof row.visible === "function"
    ? row.visible()
    : row.visible !== false;
}

function _searchable(row: SettingDefinitionRender): boolean {
  return typeof row.searchable === "function"
    ? row.searchable()
    : row.searchable !== false;
}

function _pending(path: string): PendingUpload {
  return {
    ref: { path, ext: "pdf", size: 1, mtime: 1, hash: path },
    path,
    state: "given-up",
    attempts: 3,
    nextAttemptAt: 0,
    firstFailedAt: 0,
    lastError: "network down",
  };
}
