import { uniq } from "@/core/shared/collections";
import type {
  AttachmentRef,
  NoteMetadata,
  NoteSnapshot,
} from "@/core/sync/types";

/** Frontmatter keys that may leave the machine. Any other property stays in
 * the vault: a property can be personal data too (e.g. `diagnosis:`). */
const ALLOWED_FRONTMATTER_KEYS: readonly string[] = [
  "tags",
  "aliases",
  "created",
  "updated",
  "date",
  "source",
  "url",
];

/** Protocol 2 metadata of a note. The text was read to hash it and count its
 * words, and never leaves here. */
export function buildNoteMetadata(s: NoteSnapshot): NoteMetadata {
  return {
    path: s.path,
    name: s.basename,
    ext: "md",
    size: s.size,
    ctime: s.ctime,
    mtime: s.mtime,
    hash: s.hash,
    words: countWords(s.content, s.frontmatterEnd),
    frontmatter: filterFrontmatter(s.frontmatter),
    tags: normalizeTags(s.tags),
    links: Object.keys(s.resolvedLinks),
    unresolved: Object.keys(s.unresolvedLinks),
    embeds: uniq(s.embeds),
    attachments: attachmentRefs(s),
  };
}

/** A token counts when it has a letter or digit, so markdown punctuation
 * (`-`, `>`, `---`) doesn't. */
export function countWords(
  content: string,
  frontmatterEnd: number | null,
): number {
  const body =
    frontmatterEnd === null ? content : content.slice(frontmatterEnd);

  let words = 0;

  for (const token of body.split(/\s+/)) {
    if (/[\p{L}\p{N}]/u.test(token)) words += 1;
  }

  return words;
}

/** The allowed frontmatter keys only; null when none of them is set. */
export function filterFrontmatter(
  frontmatter: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!frontmatter) return null;

  const out: Record<string, unknown> = {};

  for (const key of ALLOWED_FRONTMATTER_KEYS) {
    if (Object.prototype.hasOwnProperty.call(frontmatter, key)) {
      out[key] = frontmatter[key];
    }
  }

  return Object.keys(out).length > 0 ? out : null;
}

/** Tags without the leading `#`, blanks or repeats. */
export function normalizeTags(tags: readonly string[]): string[] {
  return uniq(
    tags.map((t) => t.replace(/^#/, "").trim()).filter((t) => t.length > 0),
  );
}

/** The attachments of a note as they are sent, without the file handles. */
export function attachmentRefs(s: NoteSnapshot): AttachmentRef[] {
  return s.attachments.map((a) => a.ref);
}
