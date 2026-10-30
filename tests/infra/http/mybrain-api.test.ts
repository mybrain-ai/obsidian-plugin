import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { TokenRejectedError } from "@/core/errors";
import { AttachmentUpload } from "@/core/sync/attachment-upload";
import type { IngestBody, ManifestV1Body } from "@/core/sync/types";
import { HttpMyBrainApi } from "@/infra/http/mybrain-api";
import { ObsidianVault } from "@/infra/obsidian/vault";

import { setFakeServer } from "@test/stubs/obsidian";
import { PDF, createFixtureVault } from "@test/support/fixture-vault";
import type { FakeRequest } from "@test/support/types";

const AUTH = {
  endpoint: "https://api.example.test",
  token: "tok-1",
  deviceId: "dev-1",
  pluginVersion: "9.9.9",
};

afterEach(() => setFakeServer(null));

test("each method hits its own path", async () => {
  const seen = _capture(200, { status: "active" });
  const api = new HttpMyBrainApi(() => AUTH);

  await api.postManifest({ m: 1 } as unknown as ManifestV1Body);
  await api.postIngest({ i: 1 } as unknown as IngestBody);
  await api.postContent({
    protocol: 2,
    vaultId: "v",
    vaultName: "n",
    clientTime: "t",
    notes: [],
    missing: [],
  });
  await api.uploadAttachment(
    { vaultId: "v" },
    {
      name: "a.pdf",
      bytes: new ArrayBuffer(1),
      contentType: "application/pdf",
    },
  );
  assert.deepEqual(await api.ping(), { status: "active" });
  await api.latestRelease();

  assert.deepEqual(
    seen.map((r) => `${r.method} ${_path(r)}`),
    [
      "POST /manifest",
      "POST /ingest",
      "POST /content",
      "POST /attachments",
      "GET /ping",
      "GET /latest-release",
    ],
  );
  assert.equal(seen[0].body, JSON.stringify({ m: 1 }));
});

test("the auth is read on every call", async () => {
  const seen = _capture(200, {});
  let token = "a";
  const api = new HttpMyBrainApi(() => ({ ...AUTH, token }));

  await api.ping();
  token = "b";
  await api.ping();

  assert.deepEqual(
    seen.map((r) => r.headers?.Authorization),
    ["Bearer a", "Bearer b"],
  );
});

test("a rejected token surfaces from ping", async () => {
  _capture(401);

  await assert.rejects(
    new HttpMyBrainApi(() => AUTH).ping(),
    TokenRejectedError,
  );
});

test("latestRelease returns the release, or null when there is none", async () => {
  _capture(200, { version: "1.2.3", notes: "n" });

  assert.deepEqual(await new HttpMyBrainApi(() => AUTH).latestRelease(), {
    version: "1.2.3",
    notes: "n",
  });

  _capture(204);

  assert.equal(await new HttpMyBrainApi(() => AUTH).latestRelease(), null);
});

test("latestRelease lets a rejected token through, so it can be flagged", async () => {
  _capture(401, {});

  await assert.rejects(
    new HttpMyBrainApi(() => AUTH).latestRelease(),
    TokenRejectedError,
  );
});

test("latestRelease is null on a 500 and on a thrown error, and logs why", async () => {
  const warn = console.warn;
  const warned: unknown[][] = [];

  console.warn = (...args: unknown[]) => void warned.push(args);

  try {
    _capture(500, { detail: "boom" });

    assert.equal(await new HttpMyBrainApi(() => AUTH).latestRelease(), null);

    setFakeServer(() => {
      throw new Error("offline");
    });

    assert.equal(await new HttpMyBrainApi(() => AUTH).latestRelease(), null);
  } finally {
    console.warn = warn;
  }

  const failures = warned.filter(
    ([message]) => message === "MyBrain: update check failed",
  );

  assert.equal(failures.length, 2);
  assert.match(String(failures[1][1]), /offline/);
});

test("an attachment goes up as multipart with ordered fields and the guessed type", async () => {
  const seen = _capture(200);
  const { uploader, moc } = await _setupUpload();
  const [attachment] = moc.attachments;
  const { ref } = attachment;

  uploader.remember([attachment]);
  await uploader.upload([ref.hash]);

  const text = new TextDecoder().decode(seen[0].body as ArrayBuffer);
  const names = [...text.matchAll(/form-data; name="([^"]+)"/g)].map(
    (m) => m[1],
  );

  assert.deepEqual(names, ["vaultId", "hash", "path", "ext", "size", "file"]);
  assert.ok(text.includes('name="vaultId"\r\n\r\nvault-1\r\n'));
  assert.ok(text.includes(`name="hash"\r\n\r\n${ref.hash}\r\n`));
  assert.ok(text.includes(`name="path"\r\n\r\n${PDF}\r\n`));
  assert.ok(text.includes('name="ext"\r\n\r\npdf\r\n'));
  assert.ok(text.includes(`name="size"\r\n\r\n${ref.size}\r\n`));
  assert.ok(text.includes('filename="relatorio-atlas-2025.pdf"'));
  assert.ok(text.includes("Content-Type: application/pdf\r\n\r\n"));
});

test("an unknown extension is uploaded as octet-stream", async () => {
  const seen = _capture(200);
  const { uploader, moc } = await _setupUpload();
  const [attachment] = moc.attachments;
  const ref = { ...attachment.ref, ext: "xyz" };

  uploader.remember([{ ref, file: attachment.file }]);
  await uploader.upload([ref.hash]);

  assert.ok(
    new TextDecoder()
      .decode(seen[0].body as ArrayBuffer)
      .includes("Content-Type: application/octet-stream\r\n\r\n"),
  );
});

function _capture(status = 200, json?: unknown) {
  const seen: FakeRequest[] = [];

  setFakeServer((request) => {
    seen.push(request);

    return { status, json };
  });

  return seen;
}

function _path(request: FakeRequest): string {
  return request.url.slice(AUTH.endpoint.length);
}

async function _setupUpload() {
  const vault = new ObsidianVault(createFixtureVault().app);
  const uploader = new AttachmentUpload({
    api: new HttpMyBrainApi(() => AUTH),
    settings: () => ({ vaultId: "vault-1", syncAttachmentsOnMobile: false }),
    isMobile: () => false,
  });
  const [moc] = await vault.readMany(["02 Áreas/Pesquisa/MOC Pesquisa.md"]);

  return { uploader, moc };
}
