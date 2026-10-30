import type { ContentReadResult } from "@/core/content/types";
import type { VaultPort } from "@/core/ports";
import { contentNoteFields } from "@/core/sync/payloads";

/** A note the server asked for, read as it is now. Its text is never read
 * for a note outside the folders the user chose, even when asked for. */
export async function readRequestedNote(
  vault: VaultPort,
  path: string,
  isInScope: (path: string) => boolean,
): Promise<ContentReadResult> {
  const notePath = vault.notePath(path);

  if (notePath === null) return { kind: "missing", reason: "not_found" };

  // The scope is checked on the path the vault resolved, not the one asked
  // for, so no spelling of a path can reach a note outside the scope.
  if (!isInScope(notePath)) return { kind: "missing", reason: "out_of_scope" };

  const snapshot = await vault.read(notePath);

  return {
    kind: "note",
    note: contentNoteFields(snapshot),
    resolved: snapshot.attachments,
  };
}
