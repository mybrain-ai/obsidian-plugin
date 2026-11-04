import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { defaultSettings } from "@/core/sync/settings";
import { ensureVaultIdentity } from "@/core/sync/vault-identity";

describe("ensureVaultIdentity", () => {
  it("fills an empty id and name and reports a change", () => {
    const settings = { ...defaultSettings(), vaultId: "", vaultName: "" };

    assert.equal(
      ensureVaultIdentity(
        settings,
        () => "My vault",
        () => "uuid-1",
      ),
      true,
    );
    assert.equal(settings.vaultId, "uuid-1");
    assert.equal(settings.vaultName, "My vault");
  });

  it("leaves existing values alone and reports no change", () => {
    const settings = { ...defaultSettings(), vaultId: "v", vaultName: "n" };

    assert.equal(
      ensureVaultIdentity(
        settings,
        () => assert.fail("name read"),
        () => assert.fail("id generated"),
      ),
      false,
    );
    assert.equal(settings.vaultId, "v");
    assert.equal(settings.vaultName, "n");
  });
});
