import { sha256 } from "@/hash";
import type { AttachmentRef, NoteMetadata } from "@/types";
import { uniq } from "@/util";

/** Frontmatter keys that may leave the machine. Any other property stays in
 * the vault: a property can be personal data too (e.g. `diagnosis:`). */
export const ALLOWED_FRONTMATTER_KEYS: readonly string[] = [
  "tags",
  "aliases",
  "created",
  "updated",
  "date",
  "source",
  "url",
];

export type NoteMetadataInput = {
  path: string;
  basename: string;
  stat: { ctime: number; mtime: number; size: number };
  content: string;
  frontmatter: Record<string, unknown> | undefined;
  // Offset where the frontmatter block ends, from the metadata cache. Null
  // when the note has no frontmatter.
  frontmatterEnd: number | null;
  // `getAllTags(cache)`: body tags and frontmatter tags, with the `#`.
  tags: string[] | null;
  resolvedLinks: Record<string, number> | undefined;
  unresolvedLinks: Record<string, number> | undefined;
  embeds: string[];
  attachments: AttachmentRef[];
};

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

/** Words in the note body, frontmatter excluded: a whitespace-separated token
 * counts when it has at least one letter or digit, so markdown punctuation
 * (`-`, `>`, `|`, `---`) doesn't. */
export function countWords(content: string, frontmatterEnd: number | null): number {
  const body = frontmatterEnd === null ? content : content.slice(frontmatterEnd);

  let words = 0;

  for (const token of body.split(/\s+/)) {
    if (/[\p{L}\p{N}]/u.test(token)) words += 1;
  }

  return words;
}

export function normalizeTags(tags: string[] | null): string[] {
  if (!tags) return [];

  return uniq(
    tags.map((t) => t.replace(/^#/, "").trim()).filter((t) => t.length > 0),
  );
}

export async function buildNoteMetadata(
  input: NoteMetadataInput,
): Promise<NoteMetadata> {
  return {
    path: input.path,
    name: input.basename,
    ext: "md",
    size: input.stat.size,
    ctime: input.stat.ctime,
    mtime: input.stat.mtime,
    hash: await sha256(input.content),
    words: countWords(input.content, input.frontmatterEnd),
    frontmatter: filterFrontmatter(input.frontmatter),
    tags: normalizeTags(input.tags),
    links: Object.keys(input.resolvedLinks ?? {}),
    unresolved: Object.keys(input.unresolvedLinks ?? {}),
    embeds: uniq(input.embeds),
    attachments: input.attachments,
  };
}
