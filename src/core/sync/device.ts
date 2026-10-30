import { DEVICE_ID_KEY } from "@/core/constants";
import type { DeviceStore } from "@/core/ports";

/** This machine's id, created and stored on first use. */
export function getOrCreateDeviceId(store: DeviceStore): string {
  const existing = store.load(DEVICE_ID_KEY);

  if (existing) return existing;

  const created = crypto.randomUUID();

  store.save(DEVICE_ID_KEY, created);

  return created;
}
