// In-memory vault for tests. The metadata cache is given per note, the way
// Obsidian would have parsed it (the parser itself only exists in the app).
import type { App, TFile as AppFile } from "obsidian";

import { TFile, TFolder } from "@test/stubs/obsidian";
import type { NoteSpec, TestVault, VaultSpec } from "@test/support/types";

const encoder = new TextEncoder();

/** An Obsidian `App` over in-memory notes, files and config, with controls to
 * edit, rename and remove them and to fire vault events. */
export function createVault(spec: VaultSpec): TestVault {
  const files = new Map<string, TFile>();
  const folders = new Map<string, TFolder>();
  const text = new Map<string, string>();
  const binary = new Map<string, Uint8Array>();
  const notes = new Map<string, NoteSpec>();
  const config = new Map(Object.entries(spec.config ?? {}));

  const root = new TFolder();

  root.path = "/";

  function folderFor(path: string): TFolder {
    if (path === "") return root;

    const existing = folders.get(path);

    if (existing) return existing;

    const folder = new TFolder();

    folder.path = path;
    folder.name = nameOf(path);

    const parent = folderFor(parentOf(path));

    folder.parent = parent;
    parent.children.push(folder);
    folders.set(path, folder);

    return folder;
  }

  function addFile(
    path: string,
    ctime: number,
    mtime: number,
    size: number,
  ): TFile {
    const file = new TFile();

    file.path = path;
    file.name = nameOf(path);
    file.extension = file.name.includes(".")
      ? file.name.slice(file.name.lastIndexOf(".") + 1)
      : "";
    file.basename = file.extension
      ? file.name.slice(0, -(file.extension.length + 1))
      : file.name;
    file.stat = { ctime, mtime, size };
    file.parent = folderFor(parentOf(path));
    file.parent.children.push(file);
    files.set(path, file);

    return file;
  }

  for (const f of spec.folders ?? []) folderFor(f);

  for (const n of spec.notes) {
    addFile(n.path, n.ctime, n.mtime, encoder.encode(n.content).byteLength);
    text.set(n.path, n.content);
    notes.set(n.path, n);
  }

  for (const b of spec.binaries ?? []) {
    addFile(b.path, b.ctime, b.mtime, b.bytes.byteLength);
    binary.set(b.path, b.bytes);
  }

  const metadataCache = {
    get resolvedLinks() {
      return Object.fromEntries(
        Array.from(notes.values()).map((n) => [n.path, n.resolvedLinks ?? {}]),
      );
    },
    get unresolvedLinks() {
      return Object.fromEntries(
        Array.from(notes.values()).map((n) => [
          n.path,
          n.unresolvedLinks ?? {},
        ]),
      );
    },
    getFileCache(file: TFile) {
      const n = notes.get(file.path);

      if (!n) return null;

      const content = text.get(file.path) ?? "";
      const end = _frontmatterEnd(content);

      return {
        frontmatter: n.frontmatter,
        frontmatterPosition:
          end === null
            ? undefined
            : { start: { offset: 0 }, end: { offset: end } },
        tags: (n.bodyTags ?? []).map((tag) => ({ tag })),
        embeds: (n.embeds ?? []).map((link) => ({ link })),
      };
    },
    getFirstLinkpathDest(linkpath: string): TFile | null {
      for (const f of files.values()) {
        if (
          f.path === linkpath ||
          f.path === `${linkpath}.md` ||
          f.name === linkpath ||
          f.basename === linkpath
        ) {
          return f;
        }
      }

      return null;
    },
  };

  const handlers = new Map<string, Array<(...args: unknown[]) => unknown>>();

  const vault = {
    on: (name: string, callback: (...args: unknown[]) => unknown) => {
      handlers.set(name, [...(handlers.get(name) ?? []), callback]);

      return { name, callback };
    },
    configDir: ".obsidian",
    adapter: {
      exists: async (path: string) => config.has(path),
      read: async (path: string) => {
        const value = config.get(path);

        if (value === undefined) throw new Error(`no such file: ${path}`);

        return value;
      },
    },
    getName: () => "Test vault",
    getRoot: () => root,
    getAbstractFileByPath: (path: string) => files.get(path) ?? null,
    getMarkdownFiles: () =>
      Array.from(files.values()).filter((f) => f.extension === "md"),
    cachedRead: async (file: TFile) => {
      const value = text.get(file.path);

      if (value === undefined) throw new Error("gone");

      return value;
    },
    readBinary: async (file: TFile) => {
      const bytes = binary.get(file.path);

      if (!bytes) throw new Error("gone");

      return bytes.slice().buffer;
    },
  };

  return {
    app: { vault, metadataCache } as unknown as App,
    file: (path) => {
      const f = files.get(path);

      if (!f) throw new Error(`no file ${path}`);

      return f as unknown as AppFile;
    },
    markdownFiles: () => vault.getMarkdownFiles() as unknown as AppFile[],
    edit: (path, content, mtime) => {
      text.set(path, content);

      const f = files.get(path);

      if (f)
        f.stat = { ...f.stat, mtime, size: encoder.encode(content).byteLength };
    },
    remove: (path) => {
      const f = files.get(path);

      text.delete(path);
      binary.delete(path);
      notes.delete(path);
      files.delete(path);

      if (f?.parent)
        f.parent.children = f.parent.children.filter((c) => c !== f);
    },
    emit: (name, ...args) => {
      for (const callback of handlers.get(name) ?? []) callback(...args);
    },
    rename: (path, newPath) => {
      const f = files.get(path);

      if (!f) throw new Error(`no file ${path}`);

      // Obsidian renames the same TFile in place.
      f.path = newPath;
      f.name = nameOf(newPath);
      f.basename = f.extension
        ? f.name.slice(0, -(f.extension.length + 1))
        : f.name;
      files.delete(path);
      files.set(newPath, f);
      _move(text, path, newPath);
      _move(binary, path, newPath);
      _move(notes, path, newPath);
    },
  };
}

/** Last segment of a vault path. */
export function nameOf(path: string): string {
  return path.split("/").pop() ?? path;
}

/** Folder part of a vault path; `""` for the root. */
export function parentOf(path: string): string {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

function _frontmatterEnd(content: string): number | null {
  if (!content.startsWith("---\n")) return null;

  const close = content.indexOf("\n---", 4);

  return close === -1 ? null : close + 4;
}

function _move<T>(map: Map<string, T>, from: string, to: string): void {
  const value = map.get(from);

  if (value === undefined) return;

  map.delete(from);
  map.set(to, value);
}
