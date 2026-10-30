import assert from "node:assert/strict";
import { test } from "node:test";

import { isPathInScope } from "@/core/sync/scope";

test("an empty scope is the whole vault", () => {
  assert.equal(_inScope("a.md", []), true);
  assert.equal(_inScope("Deep/Folder/b.md", []), true);
});

test("a folder in the scope covers its subfolders, and nothing with a similar name", () => {
  assert.equal(_inScope("Work/a.md", ["Work"]), true);
  assert.equal(_inScope("Work/Sub/b.md", ["Work"]), true);
  assert.equal(_inScope("Workshop/c.md", ["Work"]), false);
  assert.equal(_inScope("Personal/d.md", ["Work"]), false);
  assert.equal(_inScope("e.md", ["Work"]), false);
});

test("the root entry covers only notes directly in the vault root", () => {
  assert.equal(_inScope("e.md", ["/"]), true);
  assert.equal(_inScope("Work/a.md", ["/"]), false);
});

test("the config folder is never in scope", () => {
  assert.equal(_inScope(".obsidian/workspace.md", []), false);
  assert.equal(_inScope(".obsidian/plugins/x.md", ["/", ".obsidian"]), false);
});

function _inScope(path: string, scope: string[]): boolean {
  return isPathInScope(path, scope, ".obsidian");
}
