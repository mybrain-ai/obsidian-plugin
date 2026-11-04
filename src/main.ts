import {
  type App,
  Platform,
  Plugin,
  type PluginManifest,
  debounce,
} from "obsidian";

import {
  DRAIN_INTERVAL_MS,
  UPDATE_CHECK_TICK_MS,
  UPDATE_LATEST_VERSION_KEY,
} from "@/core/constants";
import { createContentQueue } from "@/core/content/content-sync";
import type { Notifier, PluginDataPort, SyncDeps } from "@/core/ports";
import { quietlyAsync } from "@/core/shared/quietly";
import { AttachmentRetry } from "@/core/sync/attachment-retry";
import { AttachmentUpload } from "@/core/sync/attachment-upload";
import { checkConnection } from "@/core/sync/connection-check";
import { getOrCreateDeviceId } from "@/core/sync/device";
import { EditSync } from "@/core/sync/edit-sync";
import { FullSync } from "@/core/sync/full-sync";
import { serverEventHandlers } from "@/core/sync/server-events";
import { canSync } from "@/core/sync/settings";
import { SyncController } from "@/core/sync/sync-controller";
import { SyncState } from "@/core/sync/sync-state";
import { markTokenRejected } from "@/core/sync/sync-steps";
import type {
  AuthState,
  DeepLinkSettings,
  MyBrainSettings,
  PendingUpload,
  StoredData,
} from "@/core/sync/types";
import { ensureVaultIdentity } from "@/core/sync/vault-identity";
import { UpdateCheck } from "@/core/update/update-check";
import { HttpMyBrainApi } from "@/infra/http/mybrain-api";
import { ObsidianDeviceStore } from "@/infra/obsidian/device-store";
import { WindowTimers } from "@/infra/obsidian/timers";
import { ObsidianVault, isMarkdownFile } from "@/infra/obsidian/vault";
import { PluginDataStore } from "@/infra/storage/plugin-data";
import { ObsidianWebSocketManager } from "@/infra/websocket/manager";
import type { Services } from "@/types";
import {
  registerInstallProtocolHandler,
  registerOpenProtocolHandler,
} from "@/ui/deep-link";
import { ObsidianNotifier } from "@/ui/notices";
import { MyBrainSettingTab } from "@/ui/settings-tab";
import type { PluginFacade } from "@/ui/types";
import { ObsidianUpdatePrompt } from "@/ui/update-modal";
import { ObsidianUploadFailurePrompt } from "@/ui/upload-failure-notice";

const WS_RESTART_DEBOUNCE_MS = 500;

/** Builds every adapter and use case over one shared settings object; the
 * plugin class only wires their lifecycle. */
export function composeServices(
  app: App,
  manifest: PluginManifest,
  store: PluginDataPort,
  initial: StoredData,
  restartChannel: () => void,
): Services {
  const { settings, queue } = initial;
  const device = new ObsidianDeviceStore(app);
  const deviceId = getOrCreateDeviceId(device);
  const api = new HttpMyBrainApi(() => ({
    endpoint: settings.endpoint,
    token: settings.token,
    deviceId,
    pluginVersion: manifest.version,
  }));
  const vault = new ObsidianVault(app);
  const notifier = new ObsidianNotifier();
  const timers = new WindowTimers();
  const clock = () => Date.now();
  const auth: AuthState = { rejected: false };
  const onTokenRejected = () => markTokenRejected({ auth, notifier });

  async function save(): Promise<void> {
    await store.save({ settings, queue: editSync.queued() });
  }

  const attachments = new AttachmentUpload({
    api,
    settings: () => settings,
    isMobile: () => Platform.isMobile,
  });
  const uploadRetry = new AttachmentRetry({
    uploader: attachments,
    vault,
    device,
    prompt: new ObsidianUploadFailurePrompt(),
    notifier,
    timers,
    clock,
    auth,
    canSync: () => canSync(settings),
    onTokenRejected,
  });

  const deps: SyncDeps = {
    vault,
    api,
    attachments,
    failedUploads: uploadRetry,
    notifier,
    timers,
    clock,
    settings: () => settings,
    save,
    pluginVersion: manifest.version,
    auth,
  };

  const syncState = new SyncState();
  const fullSync = new FullSync(deps, syncState);
  const editSync = new EditSync(deps, fullSync, queue);

  return {
    fullSync,
    editSync,
    contentQueue: createContentQueue(deps),
    uploadRetry,
    syncState,
    updateCheck: new UpdateCheck({
      api,
      device,
      notifier,
      prompt: new ObsidianUpdatePrompt(app),
      canSync: () => canSync(settings),
      installedVersion: manifest.version,
      clock,
      onTokenRejected,
    }),
    sync: new SyncController({
      settings: () => settings,
      auth,
      save,
      editSync,
      fullSync,
      restartChannel,
    }),
    api,
    channel: new ObsidianWebSocketManager(
      () => ({ endpoint: settings.endpoint, token: settings.token }),
      notifier,
      timers,
    ),
    vault,
    device,
    notifier,
    settings,
    auth,
    save,
  };
}

/** The MyBrain plugin: loads the services, wires vault events, the server
 * channel and the timers to them, and is the facade the UI talks to. */
export default class MyBrainPlugin extends Plugin implements PluginFacade {
  /** A field, not a getter: Obsidian's `Plugin` declares `settings` as a
   * property. Set once in `onload`; every service holds this same object. */
  declare settings: MyBrainSettings;
  private _services?: Services;

  private readonly _debouncedWsRestart = debounce(
    () => this._doRestartWebSocket(),
    WS_RESTART_DEBOUNCE_MS,
    true,
  );

  /** Obsidian's load hook: build the services, then start syncing once the
   * layout is ready. */
  async onload() {
    const store = new PluginDataStore(
      () => this.loadData(),
      (data) => this.saveData(data),
    );

    const services = composeServices(
      this.app,
      this.manifest,
      store,
      await store.load(),
      () => this._restartWebSocket(),
    );

    this._services = services;
    this.settings = services.settings;

    this.addSettingTab(new MyBrainSettingTab(this));
    registerInstallProtocolHandler(this);
    registerOpenProtocolHandler(this);

    const dirty = ensureVaultIdentity(
      this.settings,
      () => services.vault.vaultName(),
      () => crypto.randomUUID(),
    );

    // A failed save must not stop syncing; the next save writes the identity.
    if (dirty)
      await quietlyAsync("save the vault identity", this.saveSettings());

    this.app.workspace.onLayoutReady(() => {
      const { editSync, sync, uploadRetry } = services;

      this._registerVaultEvents();
      this._startWebSocket();
      sync.startup();
      uploadRetry.start();

      this.registerInterval(
        window.setInterval(() => void editSync.drain(), DRAIN_INTERVAL_MS),
      );

      void editSync.drain();

      this.registerInterval(
        window.setInterval(
          () =>
            void quietlyAsync("check for updates", this.checkForUpdates(false)),
          UPDATE_CHECK_TICK_MS,
        ),
      );

      void quietlyAsync("check for updates", this.checkForUpdates(false));
    });
  }

  /** Obsidian's unload hook: stop sending, then save what is queued. */
  onunload() {
    // onload may have failed before the services were built.
    if (!this._services) return;

    this._debouncedWsRestart.cancel();
    this._services.editSync.stop();
    this._services.contentQueue.stop();
    this._services.uploadRetry.stop();
    this._services.channel.stop();

    // Best-effort save of queued events not yet written to data.json.
    this.saveSettings().catch((e: unknown) => {
      console.error("MyBrain: failed to save on unload", e);
    });
  }

  /** Write `data.json`: the settings and the edit queue. */
  async saveSettings(): Promise<void> {
    await this._built.save();
  }

  /** Check for a newer release; a manual check always answers. */
  async checkForUpdates(manual: boolean): Promise<void> {
    await this._built.updateCheck.run({ manual });
  }

  /** Where the UI shows its notices. */
  get notifier(): Notifier {
    return this._built.notifier;
  }

  /** Whether a full sync is running. */
  isSyncing(): boolean {
    return this._built.syncState.isSyncing();
  }

  /** Called when syncing starts or stops; returns the unsubscribe. */
  onSyncStateChange(listener: () => void): () => void {
    return this._built.syncState.onChange(listener);
  }

  /** Apply settings from a confirmed install link. */
  async applyDeepLinkSettings(incoming: DeepLinkSettings): Promise<void> {
    await this._built.sync.applyDeepLink(incoming);
  }

  /** Store a token the user pasted and reconnect with it. */
  async saveToken(token: string): Promise<void> {
    await this._built.sync.saveToken(token);
  }

  /** Push every note in scope again, from scratch. */
  async resync(): Promise<boolean> {
    return await this._built.sync.resync();
  }

  /** The newest version the last update check saw, if any. */
  latestKnownVersion(): string | null {
    return this._built.device.load(UPDATE_LATEST_VERSION_KEY);
  }

  /** Ping the server and describe the token's state. */
  async testConnection(): Promise<string> {
    const { api, auth } = this._built;

    return await checkConnection({ api, auth, settings: () => this.settings });
  }

  /** The failed uploads still waiting, for the settings tab. */
  pendingUploads(): PendingUpload[] {
    return this._built.uploadRetry.pending();
  }

  /** Called when the waiting uploads change; returns the unsubscribe. */
  onPendingUploadsChange(listener: () => void): () => void {
    return this._built.uploadRetry.onChange(listener);
  }

  /** Send every waiting upload now. */
  async retryUploads(): Promise<void> {
    await this._built.uploadRetry.retryNow();
  }

  private _registerVaultEvents(): void {
    const { editSync } = this._built;

    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (isMarkdownFile(file)) editSync.onUpsert(file);
      }),
    );
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (isMarkdownFile(file)) editSync.onUpsert(file);
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (isMarkdownFile(file)) editSync.onDelete(file);
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (isMarkdownFile(file)) editSync.onRename(file, oldPath);
      }),
    );
  }

  private _startWebSocket(): void {
    if (!canSync(this.settings)) return;

    const { channel, fullSync, contentQueue, auth, notifier } = this._built;

    channel.start(
      serverEventHandlers({
        settings: () => this.settings,
        save: () => this.saveSettings(),
        auth,
        notifier,
        pluginVersion: this.manifest.version,
        channel,
        fullSync,
        contentQueue,
      }),
    );
  }

  /** Debounced so back-to-back restarts (a token save, a deep link) reconnect
   * once. */
  private _restartWebSocket(): void {
    this._debouncedWsRestart();
  }

  private _doRestartWebSocket(): void {
    this._built.channel.stop();
    this._built.contentQueue.clear();
    this._startWebSocket();
  }

  /** The services built in `onload`; the facade is only reached after it.
   * Not `_loaded`: Obsidian's `Component` uses that name. */
  private get _built(): Services {
    if (!this._services) throw new Error("MyBrain: plugin not loaded");

    return this._services;
  }
}
