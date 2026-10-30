import type { App } from "obsidian";

import type { DeviceStore } from "@/core/ports";

/** Per-device storage via Obsidian's vault-scoped local storage: values live
 * on this device only and never sync with the vault (unlike `data.json`). */
export class ObsidianDeviceStore implements DeviceStore {
  constructor(private readonly _app: App) {}

  /** The stored string, or null when unset or not a string. */
  load(key: string): string | null {
    const value: unknown = this._app.loadLocalStorage(key);

    return typeof value === "string" ? value : null;
  }

  /** Store a value on this device only. */
  save(key: string, value: string): void {
    this._app.saveLocalStorage(key, value);
  }
}
