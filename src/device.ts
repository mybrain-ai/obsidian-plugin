import type { App } from "obsidian";
import { DEVICE_ID_KEY } from "@/constants";

// Per-device storage via Obsidian's vault-scoped local storage: values live
// on this device only and never sync with the vault (unlike `data.json`).

export function loadDeviceValue(app: App, key: string): string | null {
  const value: unknown = app.loadLocalStorage(key);

  return typeof value === "string" ? value : null;
}

export function saveDeviceValue(app: App, key: string, value: string): void {
  app.saveLocalStorage(key, value);
}

export function getOrCreateDeviceId(app: App): string {
  const existing = loadDeviceValue(app, DEVICE_ID_KEY);

  if (existing) return existing;

  const created = crypto.randomUUID();

  saveDeviceValue(app, DEVICE_ID_KEY, created);

  return created;
}
