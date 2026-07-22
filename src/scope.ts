import { App, TFolder } from "obsidian";

import type { FolderNode } from "@/types";

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
