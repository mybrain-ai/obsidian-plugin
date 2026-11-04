import assert from "node:assert/strict";
import process from "node:process";
import { describe, it } from "node:test";

import { defaultSettings } from "@/core/sync/settings";
import { SyncController } from "@/core/sync/sync-controller";
import type { MyBrainSettings } from "@/core/sync/types";

import { CONNECTED, settle } from "@test/support/fakes";

describe("SyncController", () => {
  it("startup does nothing until endpoint and token are set", () => {
    const { controller, log } = _setup({ token: "" });

    controller.startup();

    assert.deepEqual(log, []);
  });

  it("startup runs the first full sync when the vault never synced", () => {
    const { controller, log } = _setup({ ...CONNECTED, lastSyncAt: null });

    controller.startup();

    assert.deepEqual(log, ['push:{"initial":true}']);
  });

  it("startup catches up when the vault synced before", () => {
    const { controller, log } = _setup({ ...CONNECTED, lastSyncAt: 5 });

    controller.startup();

    assert.deepEqual(log, ["catchUp"]);
  });

  it("a failed catch-up rejects its own promise and startup still returns", async () => {
    let caughtUp: Promise<void> | undefined;
    const { controller } = _setup({ ...CONNECTED, lastSyncAt: 5 }, () => {
      caughtUp = Promise.reject(new Error("corrupt scope"));

      return caughtUp;
    });

    assert.doesNotThrow(() => controller.startup());
    assert.ok(caughtUp);
    await assert.rejects(caughtUp, /corrupt scope/);
  });

  it("a failed catch-up is handled, never left as an unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    const { controller } = _setup({ ...CONNECTED, lastSyncAt: 5 }, () =>
      Promise.reject(new Error("corrupt scope")),
    );

    process.on("unhandledRejection", onUnhandled);

    try {
      controller.startup();
      await settle();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }

    assert.deepEqual(unhandled, []);
  });

  it("a deep link applies, saves, restarts the channel, then pushes", async () => {
    const { controller, log, live } = _setup({ token: "" });

    await controller.applyDeepLink({
      token: "new-token",
      endpoint: "https://api.test",
      vaultId: null,
      vaultName: null,
    });

    assert.equal(live.endpoint, "https://api.test");
    assert.deepEqual(log, [
      "save:token=new-token,lastSyncAt=null,rejected=false",
      "restartChannel",
      'push:{"initial":true}',
    ]);
  });

  it("a deep link that leaves the plugin unconfigured does not push", async () => {
    const { controller, log } = _setup({ endpoint: "", token: "" });

    await controller.applyDeepLink({
      token: "new-token",
      endpoint: null,
      vaultId: null,
      vaultName: null,
    });

    assert.deepEqual(log, [
      "save:token=new-token,lastSyncAt=null,rejected=false",
      "restartChannel",
    ]);
  });

  it("a resync clears the watermark, saves, then pushes and returns its result", async () => {
    const { controller, log, failPush } = _setup({
      ...CONNECTED,
      lastSyncAt: 5,
    });

    failPush();

    assert.equal(await controller.resync(), false);
    assert.deepEqual(log, [
      "save:token=test-token,lastSyncAt=null,rejected=true",
      'push:{"initial":true}',
    ]);
  });

  it("saving a token stores it, saves, then restarts the channel", async () => {
    const { controller, log } = _setup();

    await controller.saveToken("typed-token");

    assert.deepEqual(log, [
      "save:token=typed-token,lastSyncAt=null,rejected=true",
      "restartChannel",
    ]);
  });

  it("a saved token clears the rejected flag, so syncing resumes with it", async () => {
    const { controller, auth } = _setup();

    await controller.saveToken("typed-token");

    assert.equal(auth.rejected, false);
  });

  it("a token that fails to save is not kept in memory, and nothing reconnects", async () => {
    const { controller, live, auth, log, failSave } = _setup();

    failSave();

    await assert.rejects(controller.saveToken("typed-token"), /disk full/);
    assert.equal(live.token, "test-token");
    assert.equal(auth.rejected, true);
    assert.deepEqual(log, []);
  });

  it("an install link that fails to save leaves the settings and the flag as they were", async () => {
    const { controller, live, auth, log, failSave } = _setup();
    const before = { ...live };

    failSave();

    await assert.rejects(
      controller.applyDeepLink({
        token: "new-token",
        endpoint: "https://other.test",
        vaultId: "v-2",
        vaultName: "Other",
      }),
      /disk full/,
    );
    assert.deepEqual(live, before);
    assert.equal(auth.rejected, true);
    assert.deepEqual(log, []);
  });

  it("a resync that fails to save keeps the last sync time and pushes nothing", async () => {
    const { controller, live, log, failSave } = _setup({
      ...CONNECTED,
      lastSyncAt: 5,
    });

    failSave();

    await assert.rejects(controller.resync(), /disk full/);
    assert.equal(live.lastSyncAt, 5);
    assert.deepEqual(log, []);
  });
});

function _setup(
  settings: Partial<MyBrainSettings> = CONNECTED,
  catchUp?: () => Promise<void>,
) {
  const live: MyBrainSettings = { ...defaultSettings(), ...settings };
  const auth = { rejected: true };
  const log: string[] = [];
  let pushResult = true;
  let saveFails = false;

  const controller = new SyncController({
    settings: () => live,
    auth,
    save: async () => {
      if (saveFails) throw new Error("disk full");

      log.push(
        `save:token=${live.token},lastSyncAt=${live.lastSyncAt},rejected=${auth.rejected}`,
      );
    },
    editSync: {
      catchUp: catchUp ?? (async () => void log.push("catchUp")),
    },
    fullSync: {
      push: async (opts) => {
        log.push(`push:${JSON.stringify(opts)}`);

        return pushResult;
      },
    },
    restartChannel: () => void log.push("restartChannel"),
  });

  return {
    controller,
    live,
    auth,
    log,
    failPush: () => {
      pushResult = false;
    },
    failSave: () => {
      saveFails = true;
    },
  };
}
