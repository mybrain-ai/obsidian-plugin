import assert from "node:assert/strict";
import { test } from "node:test";

import { readRequestedNote } from "@/core/content/read-requested-note";
import type { VaultPort } from "@/core/ports";
import type { AttachmentRef, NoteSnapshot } from "@/core/sync/types";

import { resolved } from "@test/support/fakes";

const REF: AttachmentRef = {
  path: "Files/a.pdf",
  ext: "pdf",
  size: 3,
  mtime: 1,
  hash: "h1",
};

const RESOLVED = resolved(REF);

test("a requested path that isn't a note is not_found, and is never read", async () => {
  const { vault, reads } = _fakeVault(["a.md"]);

  assert.deepEqual(
    await readRequestedNote(vault, "Files/scan.pdf", () => true),
    { kind: "missing", reason: "not_found" },
  );
  assert.deepEqual(await readRequestedNote(vault, "gone.md", () => true), {
    kind: "missing",
    reason: "not_found",
  });
  assert.deepEqual(reads, []);
});

test("a note outside the scope is out_of_scope and its text is never read", async () => {
  const { vault, reads } = _fakeVault(["a.md"]);

  assert.deepEqual(await readRequestedNote(vault, "a.md", () => false), {
    kind: "missing",
    reason: "out_of_scope",
  });
  assert.deepEqual(reads, []);
});

test("the scope is checked on the path the vault resolved, not the one asked for", async () => {
  const { vault, reads } = _fakeVault(["Private/a.md"], {
    "Shared/../Private/a.md": "Private/a.md",
  });
  const checked: string[] = [];

  assert.deepEqual(
    await readRequestedNote(vault, "Shared/../Private/a.md", (p) => {
      checked.push(p);

      return p.startsWith("Shared/");
    }),
    { kind: "missing", reason: "out_of_scope" },
  );
  assert.deepEqual(checked, ["Private/a.md"]);
  assert.deepEqual(reads, []);
});

test("an in-scope note comes back with its text, hash and attachments", async () => {
  const { vault } = _fakeVault(["a.md"]);

  assert.deepEqual(await readRequestedNote(vault, "a.md", () => true), {
    kind: "note",
    note: {
      path: "a.md",
      hash: "hash-of-text",
      content: "text",
      attachments: [REF],
    },
    resolved: [RESOLVED],
  });
});

/** `aliases` maps a requested spelling to the path the vault resolves it to. */
function _fakeVault(markdown: string[], aliases: Record<string, string> = {}) {
  const reads: string[] = [];
  const vault: VaultPort = {
    vaultName: () => "v",
    configDir: () => ".obsidian",
    configReader: () => ({
      exists: async () => false,
      read: async () => "",
    }),
    markdownPaths: () => markdown.map((path) => ({ path, mtime: 1 })),
    notePath: (path) =>
      aliases[path] ?? (markdown.includes(path) ? path : null),
    contentHash: async () => "hash-of-text",
    read: async (path) => {
      reads.push(path);

      return {
        path,
        content: "text",
        hash: "hash-of-text",
        attachments: [RESOLVED],
      } as unknown as NoteSnapshot;
    },
    readMany: async () => [],
    folderTree: () => [],
    binaryFile: () => null,
  };

  return { vault, reads };
}
