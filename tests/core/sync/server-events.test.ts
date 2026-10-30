import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TOKEN_REJECTED_NOTICE } from "@/core/constants";
import { serverEventHandlers } from "@/core/sync/server-events";

import { syncHarness } from "@test/support/fakes";

describe("serverEventHandlers", () => {
  it("answers a manifest request with a non-initial push", async () => {
    const { log, handlers } = _setup();

    await handlers.onManifestRequest();

    assert.deepEqual(log, ['push:{"initial":false}']);
  });

  it("saves a scope change before pushing", async () => {
    const { h, log, handlers } = _setup();

    h.deps.save = async () => {
      log.push("save");
    };

    await handlers.onScopeChanged(["a", "b"]);

    assert.deepEqual(h.settings.inScopeFolders, ["a", "b"]);
    assert.deepEqual(log, ["save", 'push:{"initial":false}']);
  });

  it("sets the rejected flag, then shows the token notice once", () => {
    const { h, handlers } = _setup();
    const seen: [boolean, string][] = [];

    h.notifier.notice = (message) =>
      void seen.push([h.deps.auth.rejected, message]);

    handlers.onTokenRejected();

    assert.equal(h.deps.auth.rejected, true);
    assert.deepEqual(seen, [[true, TOKEN_REJECTED_NOTICE]]);
  });

  it("forwards content requests", () => {
    const { requests, handlers } = _setup();

    handlers.onContentRequested("r1", ["a.md"]);

    assert.deepEqual(requests, [["r1", ["a.md"]]]);
  });

  it("sends the hello with protocol and plugin version in order", () => {
    const { sent, handlers } = _setup();

    handlers.onOpen();

    assert.equal(
      JSON.stringify(sent[0]),
      '{"type":"hello","protocol":2,"pluginVersion":"1.1.0"}',
    );
  });
});

function _setup() {
  const h = syncHarness([]);
  const log: string[] = [];
  const sent: unknown[] = [];
  const requests: [string, string[]][] = [];
  const handlers = serverEventHandlers({
    settings: h.deps.settings,
    save: () => h.deps.save(),
    auth: h.deps.auth,
    notifier: h.notifier,
    pluginVersion: h.deps.pluginVersion,
    channel: { send: (m) => void sent.push(m) },
    fullSync: {
      push: async (opts) => {
        log.push(`push:${JSON.stringify(opts)}`);

        return true;
      },
    },
    contentQueue: { request: (id, paths) => void requests.push([id, paths]) },
  });

  return { h, log, sent, requests, handlers };
}
