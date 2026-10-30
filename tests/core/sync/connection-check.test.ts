import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TokenRejectedError } from "@/core/errors";
import { checkConnection } from "@/core/sync/connection-check";

import { syncHarness } from "@test/support/fakes";

describe("checkConnection", () => {
  it("reports missing configuration without pinging", async () => {
    const h = syncHarness([], { token: "" });

    assert.equal(await checkConnection(h.deps), "endpoint or token not set");
    assert.deepEqual(h.api.paths(), []);
  });

  it("reports an active token and clears the rejected flag", async () => {
    const h = syncHarness([]);

    h.deps.auth.rejected = true;

    assert.equal(await checkConnection(h.deps), "token active");
    assert.equal(h.deps.auth.rejected, false);
  });

  it("reports a pending token", async () => {
    const h = syncHarness([]);

    h.api.ping = async () => ({ status: "pending" });

    assert.equal(
      await checkConnection(h.deps),
      "token pending — POST to activate",
    );
  });

  it("an empty reply clears the flag and reports an unexpected reply", async () => {
    const h = syncHarness([]);

    h.deps.auth.rejected = true;
    h.api.ping = async () => undefined;

    assert.equal(await checkConnection(h.deps), "unexpected server reply");
    assert.equal(h.deps.auth.rejected, false);
  });

  it("reports a rejected token and keeps the flag", async () => {
    const h = syncHarness([]);

    h.deps.auth.rejected = true;
    h.api.ping = async () => {
      throw new TokenRejectedError();
    };

    assert.equal(await checkConnection(h.deps), "token rejected");
    assert.equal(h.deps.auth.rejected, true);
  });

  it("falls back to the error message, then to String(e)", async () => {
    const h = syncHarness([]);

    h.api.ping = async () => {
      throw new Error("boom");
    };
    assert.equal(await checkConnection(h.deps), "boom");

    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a non-Error rejection is the case under test
    h.api.ping = () => Promise.reject("plain");
    assert.equal(await checkConnection(h.deps), "plain");
  });
});
