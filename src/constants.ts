export const DEBOUNCE_MS = 1500;
export const BATCH_SIZE = 50;
export const DRAIN_INTERVAL_MS = 60_000;
export const TOKEN_REJECTED_NOTICE =
  "MyBrain: token rejected — re-paste in settings";

// Automatic checks run at most once a day; the hourly tick just re-evaluates
// the throttle so a check isn't missed when Obsidian stays open for days.
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const UPDATE_CHECK_TICK_MS = 60 * 60 * 1000;

// Per-device storage keys (see `device.ts` — never stored in `data.json`).
export const DEVICE_ID_KEY = "mybrain-device-id";
export const UPDATE_LAST_CHECK_KEY = "mybrain-update-last-check";
export const UPDATE_SKIPPED_VERSION_KEY = "mybrain-update-skipped-version";
export const UPDATE_LATEST_VERSION_KEY = "mybrain-update-latest-version";

// Sentinel entry in the server-defined sync scope (`inScopeFolders`) that
// selects files sitting directly in the vault root — which have no folder
// path to prefix-match. Distinct from an empty scope, which means the whole
// vault. The server's scope contract must use this same value for "root".
export const ROOT_SCOPE_SENTINEL = "/";
