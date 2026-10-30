import type { MyBrainSettings } from "@/core/sync/types";

/** Fills a missing vault id and name; returns whether anything changed. */
export function ensureVaultIdentity(
  settings: Pick<MyBrainSettings, "vaultId" | "vaultName">,
  vaultName: () => string,
  newId: () => string,
): boolean {
  let dirty = false;

  if (!settings.vaultId) {
    settings.vaultId = newId();
    dirty = true;
  }

  if (!settings.vaultName) {
    settings.vaultName = vaultName();
    dirty = true;
  }

  return dirty;
}
