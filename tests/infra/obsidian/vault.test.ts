import assert from "node:assert/strict";
import { test } from "node:test";

import { sha256 } from "@/core/shared/hash";
import { ObsidianVault } from "@/infra/obsidian/vault";

import {
  MOC,
  MOC_CONTENT,
  createFixtureVault,
} from "@test/support/fixture-vault";
import { createVault } from "@test/support/vault";

test("read returns a snapshot with the hash of the text and the frontmatter", async () => {
  const vault = createFixtureVault();
  const snapshot = await new ObsidianVault(vault.app).read(MOC);

  assert.equal(snapshot.path, MOC);
  assert.equal(snapshot.basename, "MOC Pesquisa");
  assert.equal(snapshot.content, MOC_CONTENT);
  assert.equal(snapshot.hash, await sha256(MOC_CONTENT));
  assert.equal(snapshot.ctime, 1761000000000);
  assert.equal(snapshot.mtime, 1761600000000);
  assert.equal(snapshot.size, new TextEncoder().encode(MOC_CONTENT).byteLength);
  assert.deepEqual(snapshot.frontmatter, {
    tags: ["pesquisa"],
    aliases: ["Pesquisa MOC"],
    created: "2026-03-02",
    diagnostico: "confidencial",
  });
  assert.deepEqual(snapshot.tags, ["#pesquisa", "#pesquisa/metodo"]);
  assert.notEqual(snapshot.frontmatterEnd, null);
});

test("a note without frontmatter has a null frontmatter and no end offset", async () => {
  const vault = createVault({
    notes: [{ path: "a.md", content: "plain\n", ctime: 1, mtime: 2 }],
  });
  const snapshot = await new ObsidianVault(vault.app).read("a.md");

  assert.equal(snapshot.frontmatter, null);
  assert.equal(snapshot.frontmatterEnd, null);
});

test("embeds with a subpath resolve to attachments, and ![[#heading]] is skipped", async () => {
  const vault = createVault({
    notes: [
      {
        path: "Notes/a.md",
        content: "x",
        ctime: 1,
        mtime: 2,
        embeds: ["#heading", "report.pdf#page=2"],
      },
    ],
    binaries: [
      {
        path: "Files/report.pdf",
        bytes: new Uint8Array([1, 2, 3]),
        ctime: 1,
        mtime: 2,
      },
    ],
  });
  const snapshot = await new ObsidianVault(vault.app).read("Notes/a.md");

  assert.deepEqual(snapshot.embeds, ["Files/report.pdf"]);
  assert.deepEqual(
    snapshot.attachments.map((a) => a.ref),
    [
      {
        path: "Files/report.pdf",
        ext: "pdf",
        size: 3,
        mtime: 2,
        hash: await sha256(new Uint8Array([1, 2, 3]).buffer),
      },
    ],
  );
});

test("the cached frontmatter is copied without Obsidian's position", async () => {
  const frontmatter = { title: "T", position: { start: 0 } };
  const vault = createVault({
    notes: [
      {
        path: "a.md",
        content: "---\ntitle: T\n---\nx",
        ctime: 1,
        mtime: 2,
        frontmatter,
      },
    ],
  });
  const snapshot = await new ObsidianVault(vault.app).read("a.md");

  assert.deepEqual(snapshot.frontmatter, { title: "T" });
  assert.deepEqual(frontmatter, { title: "T", position: { start: 0 } });
});

test("a note with no tags or links reads as empty lists and maps", async () => {
  const vault = createVault({
    notes: [{ path: "a.md", content: "plain\n", ctime: 1, mtime: 2 }],
  });
  const adapter = new ObsidianVault(vault.app);
  const getFileCache = vault.app.metadataCache.getFileCache.bind(
    vault.app.metadataCache,
  );

  const withCache = await adapter.read("a.md");

  vault.app.metadataCache.getFileCache = () => null;

  const withoutCache = await adapter.read("a.md");

  vault.app.metadataCache.getFileCache = getFileCache;

  for (const snapshot of [withCache, withoutCache]) {
    assert.deepEqual(snapshot.tags, []);
    assert.deepEqual(snapshot.resolvedLinks, {});
    assert.deepEqual(snapshot.unresolvedLinks, {});
  }
});

test("read throws for a path that is not a note", async () => {
  const vault = createVault({ notes: [] });

  await assert.rejects(new ObsidianVault(vault.app).read("gone.md"));
});

test("contentHash is the snapshot hash, read without building the snapshot", async () => {
  const vault = createFixtureVault();
  const adapter = new ObsidianVault(vault.app);
  let cacheLookups = 0;
  const getFileCache = vault.app.metadataCache.getFileCache.bind(
    vault.app.metadataCache,
  );

  vault.app.metadataCache.getFileCache = (file) => {
    cacheLookups += 1;

    return getFileCache(file);
  };

  const hash = await adapter.contentHash(MOC);

  assert.equal(cacheLookups, 0);
  assert.equal(hash, (await adapter.read(MOC)).hash);
  await assert.rejects(adapter.contentHash("gone.md"));
});

test("an attachment's handle is the file it was read from: renamed it follows, deleted it throws", async () => {
  const vault = createVault({
    notes: [
      { path: "a.md", content: "x", ctime: 1, mtime: 1, embeds: ["x.pdf"] },
    ],
    binaries: [
      { path: "F/x.pdf", bytes: new Uint8Array([1, 2]), ctime: 1, mtime: 1 },
    ],
  });
  const [{ file }] = (await new ObsidianVault(vault.app).read("a.md"))
    .attachments;

  assert.equal(file.name, "x.pdf");
  assert.equal(file.path, "F/x.pdf");
  assert.deepEqual(file.stat(), { size: 2, mtime: 1 });
  assert.deepEqual(Array.from(new Uint8Array(await file.readBinary())), [1, 2]);

  vault.rename("F/x.pdf", "F/y.pdf");

  assert.equal(file.name, "y.pdf");
  assert.equal(file.path, "F/y.pdf");
  assert.deepEqual(file.stat(), { size: 2, mtime: 1 });
  assert.deepEqual(Array.from(new Uint8Array(await file.readBinary())), [1, 2]);

  vault.remove("F/y.pdf");

  assert.equal(file.stat(), null);
  await assert.rejects(file.readBinary());
});

test("binaryFile finds a file that is not a note by path, and nothing else", async () => {
  const vault = createVault({
    notes: [{ path: "a.md", content: "x", ctime: 1, mtime: 1 }],
    binaries: [
      { path: "F/x.pdf", bytes: new Uint8Array([1, 2]), ctime: 1, mtime: 5 },
    ],
  });
  const obsidian = new ObsidianVault(vault.app);
  const file = obsidian.binaryFile("F/x.pdf");

  assert.ok(file);
  assert.equal(file.path, "F/x.pdf");
  assert.deepEqual(file.stat(), { size: 2, mtime: 5 });
  assert.deepEqual(Array.from(new Uint8Array(await file.readBinary())), [1, 2]);
  assert.equal(obsidian.binaryFile("a.md"), null);
  assert.equal(obsidian.binaryFile("F"), null);
  assert.equal(obsidian.binaryFile("F/missing.pdf"), null);
});

test("readMany leaves out a note whose read throws", async () => {
  const vault = createVault({
    notes: [
      { path: "a.md", content: "a", ctime: 1, mtime: 1 },
      { path: "b.md", content: "b", ctime: 1, mtime: 1 },
      { path: "c.md", content: "c", ctime: 1, mtime: 1 },
    ],
  });
  const cachedRead = vault.app.vault.cachedRead.bind(vault.app.vault);

  vault.app.vault.cachedRead = async (file) => {
    if (file.path === "b.md") throw new Error("disk busy");

    return await cachedRead(file);
  };

  const logged: unknown[][] = [];
  const original = console.error;

  console.error = (...args: unknown[]) => void logged.push(args);

  try {
    const snapshots = await new ObsidianVault(vault.app).readMany([
      "a.md",
      "b.md",
      "c.md",
    ]);

    assert.deepEqual(
      snapshots.map((s) => s.path),
      ["a.md", "c.md"],
    );
  } finally {
    console.error = original;
  }

  assert.equal(logged.length, 1);
  assert.equal(JSON.stringify(logged).includes("b.md"), false);
});

test("notePath answers with the path the vault resolved, not the one asked for", () => {
  const vault = createVault({
    notes: [{ path: "Private/a.md", content: "a", ctime: 1, mtime: 1 }],
  });
  const lookup = vault.app.vault.getAbstractFileByPath.bind(vault.app.vault);

  vault.app.vault.getAbstractFileByPath = (path: string) =>
    lookup(path === "Shared/../Private/a.md" ? "Private/a.md" : path);

  assert.equal(
    new ObsidianVault(vault.app).notePath("Shared/../Private/a.md"),
    "Private/a.md",
  );
});

test("markdownPaths and notePath only see notes", () => {
  const vault = createVault({
    notes: [{ path: "N/a.md", content: "a", ctime: 1, mtime: 7 }],
    binaries: [
      { path: "F/x.pdf", bytes: new Uint8Array([1]), ctime: 1, mtime: 1 },
    ],
  });
  const adapter = new ObsidianVault(vault.app);

  assert.deepEqual(adapter.markdownPaths(), [{ path: "N/a.md", mtime: 7 }]);
  assert.equal(adapter.notePath("N/a.md"), "N/a.md");
  assert.equal(adapter.notePath("F/x.pdf"), null);
  assert.equal(adapter.notePath("missing.md"), null);
  assert.equal(adapter.vaultName(), "Test vault");
  assert.equal(adapter.configDir(), ".obsidian");
});

test("folderTree never emits the root and gives top-level folders a null parent", () => {
  const vault = createVault({
    notes: [],
    folders: ["Work", "Work/Sub", "Personal"],
  });

  assert.deepEqual(new ObsidianVault(vault.app).folderTree(), [
    { path: "Work", name: "Work", parent: null },
    { path: "Work/Sub", name: "Sub", parent: "Work" },
    { path: "Personal", name: "Personal", parent: null },
  ]);
});
