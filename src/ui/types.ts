import type { App, Plugin, PluginManifest } from "obsidian";

import type { Notifier } from "@/core/ports";
import type {
  DeepLinkSettings,
  MyBrainSettings,
  PendingUpload,
} from "@/core/sync/types";

/** Obsidian's settings window, which its public types leave out. */
export type AppWithSettings = {
  setting?: { open?: () => void; openTabById?: (id: string) => void };
};

/** The narrow view of the plugin the UI works through, so it never reaches
 * into the plugin class or infra. */
export interface PluginFacade {
  app: App;
  manifest: PluginManifest;
  /** Shared with every service by identity: edit it in place, never replace it. */
  readonly settings: MyBrainSettings;
  notifier: Notifier;
  saveSettings(): Promise<void>;
  saveToken(token: string): Promise<void>;
  testConnection(): Promise<string>;
  resync(): Promise<boolean>;
  isSyncing(): boolean;
  onSyncStateChange(listener: () => void): () => void;
  checkForUpdates(manual: boolean): Promise<void>;
  applyDeepLinkSettings(incoming: DeepLinkSettings): Promise<void>;
  latestKnownVersion(): string | null;
  pendingUploads(): PendingUpload[];
  onPendingUploadsChange(listener: () => void): () => void;
  retryUploads(): Promise<void>;
  registerObsidianProtocolHandler: Plugin["registerObsidianProtocolHandler"];
}

/** The settings row's list of waiting uploads, and the "and N more" line. */
export type PendingUploadLines = { lines: string[]; more: string | null };

/** What a confirm dialog shows: a text body, or a function that renders one. */
export type ConfirmOptions = {
  title: string;
  body: string | ((contentEl: HTMLElement) => void);
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
};
