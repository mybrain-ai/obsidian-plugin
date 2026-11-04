import assert from "node:assert/strict";
import { test } from "node:test";

import {
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_LAST_CHECK_KEY,
  UPDATE_LATEST_VERSION_KEY,
  UPDATE_SKIPPED_VERSION_KEY,
} from "@/core/constants";
import { TokenRejectedError } from "@/core/errors";
import type { LatestPluginRelease } from "@/core/update/types";
import { UpdateCheck } from "@/core/update/update-check";

import {
  FakeApi,
  FakeNotifier,
  FakePrompt,
  MemoryDeviceStore,
} from "@test/support/fakes";
import type { UpdateCheckSetup } from "@test/support/types";

const NOW = 10 * UPDATE_CHECK_INTERVAL_MS;
const NEWER: LatestPluginRelease = { version: "1.3.0", notes: "notes" };

test("manual check without a connection only says to configure it", async () => {
  const { api, notifier, check } = _setup({ canSync: false });

  await check.run({ manual: true });

  assert.deepEqual(notifier.messages, [
    "MyBrain: set endpoint and token first",
  ]);
  assert.equal(api.latestCalls, 0);
});

test("automatic check without a connection is silent", async () => {
  const { api, notifier, check } = _setup({ canSync: false });

  await check.run({ manual: false });

  assert.deepEqual(notifier.messages, []);
  assert.equal(api.latestCalls, 0);
});

test("automatic check inside 24 h does nothing", async () => {
  const { api, device, check } = _setup();

  device.save(
    UPDATE_LAST_CHECK_KEY,
    String(NOW - UPDATE_CHECK_INTERVAL_MS + 1),
  );
  await check.run({ manual: false });

  assert.equal(api.latestCalls, 0);
});

test("automatic check after 24 h runs, and a bad last-check counts as due", async () => {
  const a = _setup();

  a.device.save(UPDATE_LAST_CHECK_KEY, String(NOW - UPDATE_CHECK_INTERVAL_MS));
  await a.check.run({ manual: false });
  assert.equal(a.api.latestCalls, 1);

  const b = _setup();

  b.device.save(UPDATE_LAST_CHECK_KEY, "garbage");
  await b.check.run({ manual: false });
  assert.equal(b.api.latestCalls, 1);
});

test("a failed lookup still records the attempt; silent when automatic", async () => {
  const { device, notifier, check } = _setup();

  await check.run({ manual: false });

  assert.equal(device.load(UPDATE_LAST_CHECK_KEY), String(NOW));
  assert.deepEqual(notifier.messages, []);
});

test("a failed manual lookup says so", async () => {
  const { notifier, check } = _setup();

  await check.run({ manual: true });

  assert.deepEqual(notifier.messages, [
    "MyBrain: update check failed — try again later",
  ]);
});

test("manual check bypasses the throttle", async () => {
  const { api, device, check } = _setup();

  device.save(UPDATE_LAST_CHECK_KEY, String(NOW));
  await check.run({ manual: true });

  assert.equal(api.latestCalls, 1);
});

test("the latest version is saved before comparing", async () => {
  const { api, device, notifier, check } = _setup({ installed: "1.3.0" });

  api.latest = NEWER;
  await check.run({ manual: false });

  assert.equal(device.load(UPDATE_LATEST_VERSION_KEY), "1.3.0");
  assert.deepEqual(notifier.messages, []);
});

test("manual check on the latest version says so", async () => {
  const { api, notifier, check } = _setup({ installed: "1.3.0" });

  api.latest = NEWER;
  await check.run({ manual: true });

  assert.deepEqual(notifier.messages, [
    "MyBrain: you're on the latest version",
  ]);
});

test("a newer release notices and opens the prompt", async () => {
  const { api, notifier, prompt, check } = _setup();

  api.latest = NEWER;
  await check.run({ manual: false });

  assert.deepEqual(notifier.messages, [
    "MyBrain: update available (1.2.0 → 1.3.0)",
  ]);
  assert.deepEqual(prompt.shown, [{ installed: "1.2.0", release: NEWER }]);
});

test("a skipped version suppresses automatic but not manual", async () => {
  const auto = _setup();

  auto.api.latest = NEWER;
  auto.device.save(UPDATE_SKIPPED_VERSION_KEY, "1.3.0");
  await auto.check.run({ manual: false });
  assert.equal(auto.prompt.shown.length, 0);
  assert.deepEqual(auto.notifier.messages, []);
  assert.equal(auto.device.load(UPDATE_LATEST_VERSION_KEY), "1.3.0");

  const manual = _setup();

  manual.api.latest = NEWER;
  manual.device.save(UPDATE_SKIPPED_VERSION_KEY, "1.3.0");
  await manual.check.run({ manual: true });
  assert.equal(manual.prompt.shown.length, 1);
});

test("a different newer version is not suppressed by an older skip", async () => {
  const { api, device, prompt, check } = _setup();

  api.latest = NEWER;
  device.save(UPDATE_SKIPPED_VERSION_KEY, "1.2.5");
  await check.run({ manual: false });

  assert.equal(prompt.shown.length, 1);
});

test("choosing skip saves the skipped version", async () => {
  const { api, device, prompt, check } = _setup();

  api.latest = NEWER;
  await check.run({ manual: false });
  prompt.skip?.();

  assert.equal(device.load(UPDATE_SKIPPED_VERSION_KEY), "1.3.0");
});

for (const manual of [true, false]) {
  test(`a rejected token on a ${manual ? "manual" : "automatic"} check flags it, with no failure notice`, async () => {
    const { api, notifier, check, tokenRejections } = _setup();

    api.latestError = new TokenRejectedError();
    await check.run({ manual });

    assert.equal(tokenRejections(), 1);
    assert.deepEqual(notifier.messages, []);
  });
}

function _setup(opts: UpdateCheckSetup = {}) {
  const api = new FakeApi();
  const device = new MemoryDeviceStore();
  const notifier = new FakeNotifier();
  const prompt = new FakePrompt();
  let tokenRejections = 0;
  const check = new UpdateCheck({
    api,
    device,
    notifier,
    prompt,
    canSync: () => opts.canSync ?? true,
    installedVersion: opts.installed ?? "1.2.0",
    clock: () => NOW,
    onTokenRejected: () => {
      tokenRejections += 1;
    },
  });

  return {
    api,
    device,
    notifier,
    prompt,
    check,
    tokenRejections: () => tokenRejections,
  };
}
