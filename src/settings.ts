import {
  App,
  ButtonComponent,
  Notice,
  PluginSettingTab,
  Setting,
  TextComponent,
} from "obsidian";
import { UPDATE_LATEST_VERSION_KEY } from "@/constants";
import { loadDeviceValue } from "@/device";
import type MyBrainPlugin from "@/main";
import { confirm } from "@/ui";
import { checkForUpdates } from "@/update";
import { compareVersions } from "@/version";

declare const __MYBRAIN_API_BASE__: string;

export interface MyBrainSettings {
  endpoint: string;
  token: string;
  inScopeFolders: string[];
  vaultId: string;
  vaultName: string;
  lastSyncAt: number | null;
  syncAttachmentsOnMobile: boolean;
}

export const DEFAULT_SETTINGS: MyBrainSettings = {
  endpoint: __MYBRAIN_API_BASE__,
  token: "",
  inScopeFolders: [],
  vaultId: "",
  vaultName: "",
  lastSyncAt: null,
  syncAttachmentsOnMobile: false,
};

export class MyBrainSettingTab extends PluginSettingTab {
  readonly plugin: MyBrainPlugin;
  private unsubscribeSyncState: (() => void) | null = null;

  constructor(app: App, plugin: MyBrainPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // Re-rendered on open; drop any subscription from the previous render so we
    // don't accumulate stale listeners.
    this.unsubscribeSyncState?.();
    this.unsubscribeSyncState = null;

    let tokenInput!: TextComponent;
    let actions!: HTMLElement;

    const tokenSetting = new Setting(containerEl)
      .setName("Bearer token")
      .setDesc(
        "Paste the token from the MyBrain Connect Obsidian page. Activates on first POST. Stored in plain text inside this vault's plugin data — avoid storing production tokens in synced or shared vaults, and rotate the token in the MyBrain web app if the vault is compromised.",
      )
      .addText((text) => {
        tokenInput = text;
        text
          .setPlaceholder("mbr_sk_live_...")
          .setValue(this.plugin.settings.token)
          .onChange(() => this._refreshTokenActions(tokenInput, actions));
        text.inputEl.addClass("mybrain-token-input");
      });

    // Save/Cancel go inside this setting's control, on their own right-aligned
    // row below the field (the control is allowed to wrap). The row always
    // reserves its height (hidden via `visibility`), so showing it on edit
    // doesn't shift the settings below.
    tokenSetting.controlEl.addClass("mybrain-token-control");
    actions = tokenSetting.controlEl.createDiv({
      cls: "mybrain-token-actions",
    });

    new ButtonComponent(actions)
      .setButtonText("Save")
      .setCta()
      .onClick(async () => {
        const trimmed = tokenInput.getValue().trim();

        tokenInput.setValue(trimmed);
        this.plugin.settings.token = trimmed;

        await this.plugin.saveSettings();

        this.plugin.restartWebSocket();

        this._refreshTokenActions(tokenInput, actions);
      });

    new ButtonComponent(actions).setButtonText("Cancel").onClick(() => {
      tokenInput.setValue(this.plugin.settings.token);
      this._refreshTokenActions(tokenInput, actions);
    });

    this._refreshTokenActions(tokenInput, actions);

    new Setting(containerEl)
      .setName("Sync attachments on mobile")
      .setDesc(
        "Upload images and PDFs over cellular. Off by default to avoid surprise data usage.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncAttachmentsOnMobile)
          .onChange(async (value) => {
            this.plugin.settings.syncAttachmentsOnMobile = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Test connection")
      .setDesc("Hit /ping with the current token to confirm it is recognized.")
      .addButton((btn) =>
        btn.setButtonText("Test").onClick(async () => {
          const result = await this.plugin.testConnection();
          new Notice(`MyBrain: ${result}`);
        }),
      );

    const syncStatus = new Setting(containerEl)
      .setName("Sync status")
      .setDesc(this._syncStatusText());

    let resyncButton!: ButtonComponent;

    new Setting(containerEl)
      .setName("Resync full vault")
      .setDesc(
        "Clears the local sync watermark and re-uploads every markdown file.",
      )
      .addButton((btn) => {
        resyncButton = btn;
        btn
          .setButtonText("Resync")
          .setWarning()
          .onClick(async () => {
            const ok = await confirm(this.app, {
              title: "MyBrain: full resync",
              body: "This clears the sync watermark and re-uploads every markdown file in this vault. Continue?",
              confirmText: "Resync",
              destructive: true,
            });

            if (!ok) return;

            try {
              this.plugin.settings.lastSyncAt = null;

              await this.plugin.saveSettings();

              const succeeded = await this.plugin.initialScan();

              if (succeeded) new Notice("MyBrain: full resync completed");
            } catch (e) {
              console.error("MyBrain: resync failed", e);
              new Notice(
                `MyBrain: resync failed — ${e instanceof Error ? e.message : String(e)}`,
              );
            }
          });
      });

    // The Resync button and status line reflect any full sync — a deep-link or
    // startup auto-sync, not just a manual click — so the button is disabled
    // whenever one is running.
    const applySyncState = (): void => {
      const syncing = this.plugin.isSyncing();

      syncStatus.setDesc(this._syncStatusText());
      resyncButton.setDisabled(syncing);
      resyncButton.setButtonText(syncing ? "Syncing…" : "Resync");
    };

    applySyncState();
    this.unsubscribeSyncState = this.plugin.onSyncStateChange(applySyncState);

    const versionSetting = new Setting(containerEl)
      .setName("Plugin version")
      .setDesc(this._versionText());

    versionSetting.addButton((btn) =>
      btn.setButtonText("Check for updates").onClick(async () => {
        btn.setDisabled(true);
        btn.setButtonText("Checking…");

        try {
          await checkForUpdates(this.plugin, { manual: true });
          versionSetting.setDesc(this._versionText());
        } finally {
          btn.setDisabled(false);
          btn.setButtonText("Check for updates");
        }
      }),
    );
  }

  hide(): void {
    this.unsubscribeSyncState?.();
    this.unsubscribeSyncState = null;
  }

  private _versionText(): string {
    const installed = this.plugin.manifest.version;
    const latest = loadDeviceValue(this.app, UPDATE_LATEST_VERSION_KEY);

    if (latest && compareVersions(installed, latest) < 0) {
      return `Currently installed: ${installed} — update available: ${latest}`;
    }

    return `Currently installed: ${installed}`;
  }

  private _syncStatusText(): string {
    if (this.plugin.isSyncing()) return "Syncing your vault…";

    const at = this.plugin.settings.lastSyncAt;

    if (at) return `Last synced ${new Date(at).toLocaleString()}`;

    return "Not synced yet";
  }

  private _refreshTokenActions(
    input: TextComponent,
    actions: HTMLElement,
  ): void {
    const dirty = input.getValue().trim() !== this.plugin.settings.token;

    actions.toggleClass("mybrain-token-actions-visible", dirty);
  }
}
