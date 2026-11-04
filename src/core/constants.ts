export const DEBOUNCE_MS = 1500;
export const BATCH_SIZE = 50;
export const DRAIN_INTERVAL_MS = 60_000;
export const TOKEN_REJECTED_NOTICE =
  "MyBrain: token rejected — re-paste in settings";
export const NOT_CONFIGURED_NOTICE = "MyBrain: set endpoint and token first";

export const PROTOCOL_VERSION = 2;
export const API_VERSION = 1;

// Automatic checks run at most once a day; the hourly tick just re-evaluates
// the throttle so a check isn't missed when Obsidian stays open for days.
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const UPDATE_CHECK_TICK_MS = 60 * 60 * 1000;

// Per-device storage keys; never stored in `data.json`.
export const DEVICE_ID_KEY = "mybrain-device-id";
export const UPDATE_LAST_CHECK_KEY = "mybrain-update-last-check";
export const UPDATE_SKIPPED_VERSION_KEY = "mybrain-update-skipped-version";
export const UPDATE_LATEST_VERSION_KEY = "mybrain-update-latest-version";
export const PENDING_UPLOADS_KEY = "mybrain-pending-uploads";

// Scope entry for files directly in the vault root (no folder prefix to
// match); the server's scope contract must use this same value.
export const ROOT_SCOPE_SENTINEL = "/";
