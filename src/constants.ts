export const DEBOUNCE_MS = 1500;
export const BATCH_SIZE = 50;
export const DRAIN_INTERVAL_MS = 60_000;
export const TOKEN_REJECTED_NOTICE =
  "MyBrain: token rejected — re-paste in settings";

// Sentinel entry in the server-defined sync scope (`inScopeFolders`) that
// selects files sitting directly in the vault root — which have no folder
// path to prefix-match. Distinct from an empty scope, which means the whole
// vault. The server's scope contract must use this same value for "root".
export const ROOT_SCOPE_SENTINEL = "/";
