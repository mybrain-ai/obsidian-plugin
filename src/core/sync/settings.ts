import type { MyBrainSettings } from "@/core/sync/types";

declare const __MYBRAIN_API_BASE__: string;

/** A fresh object each call, so live settings never share an array with
 * another copy. */
export function defaultSettings(): MyBrainSettings {
  return {
    endpoint: __MYBRAIN_API_BASE__,
    token: "",
    inScopeFolders: [],
    vaultId: "",
    vaultName: "",
    lastSyncAt: null,
    syncAttachmentsOnMobile: false,
    serverProtocol: null,
  };
}

/** Whether the plugin is configured to talk to a MyBrain endpoint. */
export function canSync(settings: MyBrainSettings): boolean {
  return Boolean(settings.token && settings.endpoint);
}
