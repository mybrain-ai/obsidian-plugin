import {
  type App,
  type CachedMetadata,
  type TAbstractFile,
  TFile,
  TFolder,
  getAllTags,
} from "obsidian";

import type { ConfigReader, VaultPort } from "@/core/ports";
import { uniq } from "@/core/shared/collections";
import { mapWithConcurrency } from "@/core/shared/concurrency";
import { sha256 } from "@/core/shared/hash";
import type {
  BinaryFile,
  FolderNode,
  NoteSnapshot,
  NoteStamp,
} from "@/core/sync/types";
import {
  AttachmentHashCache,
  binaryFileHandle,
  resolveAttachments,
  resolveEmbedTargets,
} from "@/infra/obsidian/attachments";

const READ_CONCURRENCY = 4;

/** The vault port over Obsidian's vault and metadata cache. */
export class ObsidianVault implements VaultPort {
  constructor(
    private readonly _app: App,
    private readonly _hashes = new AttachmentHashCache(),
  ) {}

  /** The vault's folder name, used when the settings name none. */
  vaultName(): string {
    return this._app.vault.getName();
  }

  /** The config folder (`.obsidian` unless the user changed it). */
  configDir(): string {
    return this._app.vault.configDir;
  }

  /** Reads the files in the config folder. */
  configReader(): ConfigReader {
    return this._app.vault.adapter;
  }

  /** Every note in the vault, with its modification time. */
  markdownPaths(): NoteStamp[] {
    return this._app.vault
      .getMarkdownFiles()
      .map((file) => ({ path: file.path, mtime: file.stat.mtime }));
  }

  /** The note's path as the vault stores it; null when there is no note. */
  notePath(path: string): string | null {
    const file = this._app.vault.getAbstractFileByPath(path);

    return isMarkdownFile(file) ? file.path : null;
  }

  /** Hash of the note text without the rest of the snapshot. Throws when the
   * note can't be read. */
  async contentHash(path: string): Promise<string> {
    return await sha256(await this._app.vault.cachedRead(this._fileAt(path)));
  }

  /** The note as plain data. Throws when it can't be read. */
  async read(path: string): Promise<NoteSnapshot> {
    return await this._snapshot(this._fileAt(path));
  }

  /** Reads a few at a time; a note that can't be read is logged and left
   * out. */
  async readMany(paths: readonly string[]): Promise<NoteSnapshot[]> {
    const reads = await mapWithConcurrency(
      paths,
      READ_CONCURRENCY,
      async (path) => {
        try {
          return await this.read(path);
        } catch (e) {
          console.error("MyBrain: failed to read a note", e);

          return null;
        }
      },
    );

    return reads.filter((read): read is NoteSnapshot => read !== null);
  }

  /** Every folder with its parent; the vault root is not listed, so top-level
   * folders have `parent: null`. */
  folderTree(): FolderNode[] {
    const out: FolderNode[] = [];

    function walk(folder: TFolder, parent: string | null): void {
      for (const child of folder.children) {
        if (child instanceof TFolder) {
          out.push({ path: child.path, name: child.name, parent });
          walk(child, child.path);
        }
      }
    }

    walk(this._app.vault.getRoot(), null);

    return out;
  }

  /** A file that is not a note, by path; null when there is none. */
  binaryFile(path: string): BinaryFile | null {
    const file = this._app.vault.getAbstractFileByPath(path);

    if (!(file instanceof TFile) || isMarkdownFile(file)) return null;

    return binaryFileHandle(this._app, file);
  }

  private _fileAt(path: string): TFile {
    const file = this._app.vault.getAbstractFileByPath(path);

    if (!(file instanceof TFile)) throw new Error("not a file");

    return file;
  }

  private async _snapshot(file: TFile): Promise<NoteSnapshot> {
    const content = await this._app.vault.cachedRead(file);
    const targets = resolveEmbedTargets(this._app, file);
    const cache = this._app.metadataCache.getFileCache(file);
    const { metadataCache } = this._app;

    return {
      path: file.path,
      basename: file.basename,
      ctime: file.stat.ctime,
      mtime: file.stat.mtime,
      size: file.stat.size,
      content,
      hash: await sha256(content),
      frontmatter: cache?.frontmatter
        ? _withoutPosition(cache.frontmatter)
        : null,
      frontmatterEnd: cache?.frontmatterPosition?.end.offset ?? null,
      tags: (cache && getAllTags(cache)) ?? [],
      resolvedLinks: { ...metadataCache.resolvedLinks[file.path] },
      unresolvedLinks: { ...metadataCache.unresolvedLinks[file.path] },
      wikilinks: _extractLinks(cache?.links),
      mdLinks: _extractLinks(cache?.embeds),
      embeds: targets.map((target) => target.path),
      attachments: await resolveAttachments(this._app, targets, this._hashes),
    };
  }
}

/** A note: a file with the `.md` extension. */
export function isMarkdownFile(file: TAbstractFile | null): file is TFile {
  return file instanceof TFile && file.extension === "md";
}

/** A plain copy of the cached frontmatter; Obsidian's `position` is not a
 * property the user wrote. */
function _withoutPosition(
  frontmatter: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(frontmatter).filter(([key]) => key !== "position"),
  );
}

function _extractLinks(items: CachedMetadata["links"]): string[] {
  if (!items) return [];

  return uniq(items.map((i) => i.link));
}
