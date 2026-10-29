import { App, TFolder } from "obsidian";

import { ROOT_SCOPE_SENTINEL } from "@/constants";
import type { FolderNode } from "@/types";

/** Whether a vault path is inside the folders the user chose. An empty scope
 * is the whole vault; the config folder is never in scope. */
export function isPathInScope(
  path: string,
  scope: readonly string[],
  configDir: string,
): boolean {
  if (path.startsWith(`${configDir}/`)) return false;

  if (scope.length === 0) return true;

  return scope.some((prefix) => {
    // The root sentinel matches files directly in the vault root (no folder
    // segment); any other entry is a folder prefix.
    if (prefix === ROOT_SCOPE_SENTINEL) return !path.includes("/");

    return path === prefix || path.startsWith(`${prefix}/`);
  });
}

/** Flatten the vault's folder hierarchy for the backend to render the
 * connector navigator. The synthetic root (`"/"`) is never emitted; its
 * direct children carry `parent: null`, nested folders carry their parent
 * folder's path. */
export function enumerateVaultTree(app: App): FolderNode[] {
  const out: FolderNode[] = [];

  const walk = (folder: TFolder, parent: string | null): void => {
    for (const child of folder.children) {
      if (child instanceof TFolder) {
        out.push({ path: child.path, name: child.name, parent });
        walk(child, child.path);
      }
    }
  };

  walk(app.vault.getRoot(), null);

  return out;
}
