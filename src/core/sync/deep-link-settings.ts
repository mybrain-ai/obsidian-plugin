import type {
  AuthState,
  DeepLinkSettings,
  DiffEntry,
  MyBrainSettings,
} from "@/core/sync/types";

/** The shape a token must have before a deep link may install it. */
export const TOKEN_RE = /^[A-Za-z0-9_.-]{16,512}$/;

/** The settings a deep link would change, with the token masked, for the
 * user to confirm. */
export function diffSettings(
  current: Pick<
    MyBrainSettings,
    "token" | "endpoint" | "vaultId" | "vaultName"
  >,
  incoming: DeepLinkSettings,
): DiffEntry[] {
  const diff: DiffEntry[] = [];

  if (current.token !== incoming.token) {
    diff.push({
      label: "Token",
      oldValue: mask(current.token),
      newValue: mask(incoming.token),
    });
  }

  if (incoming.endpoint && current.endpoint !== incoming.endpoint) {
    diff.push({
      label: "Endpoint",
      oldValue: current.endpoint || "(empty)",
      newValue: incoming.endpoint,
    });
  }

  if (incoming.vaultId && current.vaultId !== incoming.vaultId) {
    diff.push({
      label: "Vault ID",
      oldValue: current.vaultId || "(empty)",
      newValue: incoming.vaultId,
    });
  }

  if (incoming.vaultName && current.vaultName !== incoming.vaultName) {
    diff.push({
      label: "Vault name",
      oldValue: current.vaultName || "(empty)",
      newValue: incoming.vaultName,
    });
  }

  return diff;
}

/** A token shown as its first and last four characters; a short one is fully
 * hidden. */
export function mask(token: string): string {
  if (!token) return "(empty)";

  if (token.length <= 8) return "***";

  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

/** The token always replaces the current one; the rest only when present. */
export function applyDeepLinkSettings(
  settings: MyBrainSettings,
  auth: AuthState,
  incoming: DeepLinkSettings,
): void {
  settings.token = incoming.token;

  if (incoming.endpoint) settings.endpoint = incoming.endpoint;

  if (incoming.vaultId) settings.vaultId = incoming.vaultId;

  if (incoming.vaultName) settings.vaultName = incoming.vaultName;

  auth.rejected = false;
}
