import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildNoteMetadata,
  countWords,
  filterFrontmatter,
  normalizeTags,
} from "@/core/notes/metadata";

test("filterFrontmatter keeps only allowed keys", () => {
  assert.deepEqual(
    filterFrontmatter({ tags: ["a"], diagnosis: "x", position: { start: 0 } }),
    { tags: ["a"] },
  );
});

test("filterFrontmatter returns null when no allowed key is present", () => {
  assert.equal(filterFrontmatter({ diagnosis: "x" }), null);
  assert.equal(filterFrontmatter(undefined), null);
});

test("countWords skips the frontmatter and punctuation-only tokens", () => {
  assert.equal(countWords("---\na: b\n---\nHello - world", 13), 2);
  assert.equal(countWords("Hello - world", null), 2);
});

test("normalizeTags strips the hash, trims and dedupes", () => {
  assert.deepEqual(normalizeTags(["#a", "a", "#b "]), ["a", "b"]);
  assert.deepEqual(normalizeTags([]), []);
});

test("buildNoteMetadata maps link maps to their keys", () => {
  const out = buildNoteMetadata({
    path: "a.md",
    basename: "a",
    ctime: 1,
    mtime: 2,
    size: 3,
    content: "one two",
    hash: "h",
    frontmatter: null,
    frontmatterEnd: null,
    tags: ["#t"],
    resolvedLinks: { "b.md": 1 },
    unresolvedLinks: { c: 2 },
    wikilinks: [],
    mdLinks: [],
    embeds: ["e.png", "e.png"],
    attachments: [],
  });

  assert.deepEqual(out.links, ["b.md"]);
  assert.deepEqual(out.unresolved, ["c"]);
  assert.deepEqual(out.embeds, ["e.png"]);
  assert.equal(out.words, 2);
  assert.equal(out.frontmatter, null);
  assert.deepEqual(out.tags, ["t"]);
});
