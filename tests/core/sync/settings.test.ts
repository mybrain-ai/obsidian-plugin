import assert from "node:assert/strict";
import { test } from "node:test";

import { canSync, defaultSettings } from "@/core/sync/settings";

test("the defaults point at the build's API base and hold no token", () => {
  assert.deepEqual(defaultSettings(), {
    endpoint: "https://example.test",
    token: "",
    inScopeFolders: [],
    vaultId: "",
    vaultName: "",
    lastSyncAt: null,
    syncAttachmentsOnMobile: false,
    serverProtocol: null,
  });
});

test("syncing needs both an endpoint and a token", () => {
  const settings = defaultSettings();

  assert.equal(canSync(settings), false);
  assert.equal(canSync({ ...settings, token: "t" }), true);
  assert.equal(canSync({ ...settings, token: "t", endpoint: "" }), false);
});
