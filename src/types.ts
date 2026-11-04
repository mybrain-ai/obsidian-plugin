import type { ContentRequestQueue } from "@/core/content/content-queue";
import type {
  DeviceStore,
  MyBrainApi,
  Notifier,
  ServerChannel,
  VaultPort,
} from "@/core/ports";
import type { AttachmentRetry } from "@/core/sync/attachment-retry";
import type { EditSync } from "@/core/sync/edit-sync";
import type { FullSync } from "@/core/sync/full-sync";
import type { SyncController } from "@/core/sync/sync-controller";
import type { SyncState } from "@/core/sync/sync-state";
import type { AuthState, MyBrainSettings } from "@/core/sync/types";
import type { UpdateCheck } from "@/core/update/update-check";

/** Everything `composeServices` builds for the plugin to run. */
export type Services = {
  fullSync: FullSync;
  editSync: EditSync;
  contentQueue: ContentRequestQueue;
  uploadRetry: AttachmentRetry;
  syncState: SyncState;
  updateCheck: UpdateCheck;
  sync: SyncController;
  api: MyBrainApi;
  channel: ServerChannel;
  vault: VaultPort;
  device: DeviceStore;
  notifier: Notifier;
  settings: MyBrainSettings;
  auth: AuthState;
  save(): Promise<void>;
};
