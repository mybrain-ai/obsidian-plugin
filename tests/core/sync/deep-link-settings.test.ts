import assert from "node:assert/strict";
import { describe, it, test } from "node:test";

import {
  TOKEN_RE,
  applyDeepLinkSettings,
  diffSettings,
  mask,
} from "@/core/sync/deep-link-settings";
import { defaultSettings } from "@/core/sync/settings";
import type { MyBrainSettings } from "@/core/sync/types";

const EMPTY = {
  token: "",
  endpoint: "",
  vaultId: "",
  vaultName: "",
};

test("every field present replaces the stored one", () => {
  const settings = _current();

  applyDeepLinkSettings(
    settings,
    { rejected: false },
    {
      token: "new-token",
      endpoint: "https://new.test",
      vaultId: "new-id",
      vaultName: "New",
    },
  );

  assert.equal(settings.token, "new-token");
  assert.equal(settings.endpoint, "https://new.test");
  assert.equal(settings.vaultId, "new-id");
  assert.equal(settings.vaultName, "New");
});

test("missing endpoint, vault id and name keep the stored ones", () => {
  const settings = _current();

  applyDeepLinkSettings(
    settings,
    { rejected: false },
    { token: "new-token", endpoint: null, vaultId: null, vaultName: null },
  );

  assert.equal(settings.token, "new-token");
  assert.equal(settings.endpoint, "https://old.test");
  assert.equal(settings.vaultId, "old-id");
  assert.equal(settings.vaultName, "Old");
});

test("an empty string counts as missing", () => {
  const settings = _current();

  applyDeepLinkSettings(
    settings,
    { rejected: false },
    { token: "new-token", endpoint: "", vaultId: "", vaultName: "" },
  );

  assert.equal(settings.endpoint, "https://old.test");
  assert.equal(settings.vaultId, "old-id");
  assert.equal(settings.vaultName, "Old");
});

test("it clears the rejected-token flag", () => {
  const auth = { rejected: true };

  applyDeepLinkSettings(_current(), auth, {
    token: "new-token",
    endpoint: null,
    vaultId: null,
    vaultName: null,
  });

  assert.equal(auth.rejected, false);
});

describe("mask", () => {
  it("marks an empty token", () => {
    assert.equal(mask(""), "(empty)");
  });

  it("hides short tokens entirely", () => {
    assert.equal(mask("12345678"), "***");
  });

  it("keeps the first and last four characters of longer tokens", () => {
    assert.equal(mask("abcd1234wxyz"), "abcd…wxyz");
  });
});

describe("TOKEN_RE", () => {
  it("rejects 15 characters and accepts 16", () => {
    assert.equal(TOKEN_RE.test("a".repeat(15)), false);
    assert.equal(TOKEN_RE.test("a".repeat(16)), true);
  });

  it("rejects characters outside the allowed set", () => {
    assert.equal(TOKEN_RE.test("a".repeat(15) + "!"), false);
  });
});

describe("diffSettings", () => {
  it("lists only the changed fields with their labels", () => {
    const diff = diffSettings(
      { ...EMPTY, endpoint: "https://a.example", vaultName: "Old" },
      {
        token: "test-token-aaaaaaaaaa",
        endpoint: "https://a.example",
        vaultId: "v1",
        vaultName: "New",
      },
    );

    assert.deepEqual(diff, [
      { label: "Token", oldValue: "(empty)", newValue: "test…aaaa" },
      { label: "Vault ID", oldValue: "(empty)", newValue: "v1" },
      { label: "Vault name", oldValue: "Old", newValue: "New" },
    ]);
  });

  it("ignores optional fields the link does not carry", () => {
    const diff = diffSettings(
      { ...EMPTY, token: "same", endpoint: "https://a.example" },
      { token: "same", endpoint: null, vaultId: null, vaultName: null },
    );

    assert.deepEqual(diff, []);
  });

  it("labels an endpoint change", () => {
    const diff = diffSettings(
      { ...EMPTY, token: "t", endpoint: "https://a.example" },
      {
        token: "t",
        endpoint: "https://b.example",
        vaultId: null,
        vaultName: null,
      },
    );

    assert.deepEqual(diff, [
      {
        label: "Endpoint",
        oldValue: "https://a.example",
        newValue: "https://b.example",
      },
    ]);
  });
});

function _current(): MyBrainSettings {
  return {
    ...defaultSettings(),
    token: "old-token",
    endpoint: "https://old.test",
    vaultId: "old-id",
    vaultName: "Old",
  };
}
