import assert from "node:assert/strict";
import { test } from "node:test";
import { isPathInScope } from "@/scope";
import { readRequestedNote } from "@/vault-metadata";
import { createVault } from "./vault";

const inScope = (path: string, scope: string[]) =>
  isPathInScope(path, scope, ".obsidian");

test("an empty scope is the whole vault", () => {
  assert.equal(inScope("a.md", []), true);
  assert.equal(inScope("Deep/Folder/b.md", []), true);
});

test("a folder in the scope covers its subfolders, and nothing with a similar name", () => {
  assert.equal(inScope("Work/a.md", ["Work"]), true);
  assert.equal(inScope("Work/Sub/b.md", ["Work"]), true);
  assert.equal(inScope("Workshop/c.md", ["Work"]), false);
  assert.equal(inScope("Personal/d.md", ["Work"]), false);
  assert.equal(inScope("e.md", ["Work"]), false);
});

test("the root entry covers only notes directly in the vault root", () => {
  assert.equal(inScope("e.md", ["/"]), true);
  assert.equal(inScope("Work/a.md", ["/"]), false);
});

test("the config folder is never in scope", () => {
  assert.equal(inScope(".obsidian/workspace.md", []), false);
  assert.equal(inScope(".obsidian/plugins/x.md", ["/", ".obsidian"]), false);
});

test("a requested path that isn't a note is not_found, and its bytes are never read", async () => {
  const vault = createVault({
    notes: [],
    binaries: [
      {
        path: "Files/scan.pdf",
        bytes: new Uint8Array([1]),
        ctime: 1,
        mtime: 1,
      },
    ],
  });

  const read = await readRequestedNote(vault.app, "Files/scan.pdf", () => true);

  assert.deepEqual(read, { kind: "missing", reason: "not_found" });
});
