import {
  ButtonComponent,
  Plugin,
  PluginSettingTab,
  Setting,
  SettingDefinitionItem,
  TextComponent,
} from "obsidian";

import { errorMessage } from "@/core/shared/text";
import type { MyBrainSettings, PendingUpload } from "@/core/sync/types";
import { compareVersions } from "@/core/update/version";
import { confirm } from "@/ui/confirm-modal";
import type { PluginFacade } from "@/ui/types";
import { pendingUploadLines, pendingUploadsSummary } from "@/ui/upload-texts";

/** The plugin's settings tab, declared as setting definitions. */
export class MyBrainSettingTab extends PluginSettingTab {
  readonly plugin: PluginFacade;

  constructor(plugin: Plugin & PluginFacade) {
    super(plugin.app, plugin);
    this.plugin = plugin;
  }

  /** The settings this tab shows, in order. */
  getSettingDefinitions(): SettingDefinitionItem<keyof MyBrainSettings>[] {
    return [
      {
        name: "Bearer token",
        desc: "Paste the token from the MyBrain Connect Obsidian page. Activates on first POST. Stored in plain text inside this vault's plugin data — avoid storing production tokens in synced or shared vaults, and rotate the token in the MyBrain web app if the vault is compromised.",
        render: (setting) => this._renderTokenSetting(setting),
      },
      {
        name: "Sync attachments on mobile",
        desc: "Upload images and PDFs over cellular. Off by default to avoid surprise data usage.",
        control: { type: "toggle", key: "syncAttachmentsOnMobile" },
      },
      {
        name: "Test connection",
        desc: "Hit /ping with the current token to confirm it is recognized.",
        render: (setting) => {
          setting.addButton((btn) =>
            btn.setButtonText("Test").onClick(async () => {
              const result = await this.plugin.testConnection();

              this.plugin.notifier.notice(`MyBrain: ${result}`);
            }),
          );
        },
      },
      {
        name: "Sync status",
        render: (setting) => {
          const apply = (): void => {
            setting.setDesc(this._syncStatusText());
          };

          apply();

          return this.plugin.onSyncStateChange(apply);
        },
      },
      {
        name: "Attachments not uploaded",
        // Obsidian applies `visible` after `render`, so the row's own toggle
        // only takes over for changes while the tab is open.
        visible: () => this.plugin.pendingUploads().length > 0,
        searchable: () => this.plugin.pendingUploads().length > 0,
        render: (setting) => this._renderPendingUploads(setting),
      },
      {
        name: "Resync full vault",
        desc: "Clears the local sync watermark and re-sends the list of notes in the synced folders. Note text is only sent for notes you include in MyBrain, unless the server is too old for that (then every note's text is sent, as in 1.0).",
        render: (setting) => this._renderResyncSetting(setting),
      },
      {
        name: "Plugin version",
        render: (setting) => {
          setting.setDesc(this._versionText());

          setting.addButton((btn) =>
            btn.setButtonText("Check for updates").onClick(async () => {
              btn.setDisabled(true);
              btn.setButtonText("Checking…");

              try {
                await this.plugin.checkForUpdates(true);
                setting.setDesc(this._versionText());
              } catch (e) {
                console.error("MyBrain: update check failed", e);
              } finally {
                btn.setDisabled(false);
                btn.setButtonText("Check for updates");
              }
            }),
          );
        },
      },
    ];
  }

  /** The base class persists settings alone; this plugin stores them nested
   * alongside the sync queue, so writes must go through saveSettings(). */
  async setControlValue(key: string, value: unknown): Promise<void> {
    const settings = this.plugin.settings as unknown as Record<string, unknown>;
    const previous = settings[key];

    settings[key] = value;

    try {
      await this.plugin.saveSettings();
    } catch (e) {
      // Put back what is on disk and redraw, so the tab doesn't show an
      // unsaved value.
      settings[key] = previous;
      this.update();
      console.error("MyBrain: failed to save settings", e);
      this.plugin.notifier.notice(
        "MyBrain: couldn't save the setting. Try again.",
      );
    }
  }

  private _renderTokenSetting(setting: Setting): void {
    let tokenInput!: TextComponent;
    let actions!: HTMLElement;

    setting.addText((text) => {
      tokenInput = text;
      text
        .setPlaceholder("mbr_sk_live_...")
        .setValue(this.plugin.settings.token)
        .onChange(() => this._refreshTokenActions(tokenInput, actions));
      text.inputEl.addClass("mybrain-token-input");
    });

    // The action row always reserves its height (hidden via `visibility`) so
    // showing it on edit doesn't shift the settings below.
    setting.controlEl.addClass("mybrain-token-control");
    actions = setting.controlEl.createDiv({
      cls: "mybrain-token-actions",
    });

    new ButtonComponent(actions)
      .setButtonText("Save")
      .setCta()
      .onClick(async () => {
        const trimmed = tokenInput.getValue().trim();

        tokenInput.setValue(trimmed);

        try {
          await this.plugin.saveToken(trimmed);
        } catch (e) {
          console.error("MyBrain: failed to save the token", e);
          this.plugin.notifier.notice(
            "MyBrain: couldn't save the token. Try again.",
          );

          return;
        }

        this._refreshTokenActions(tokenInput, actions);
      });

    new ButtonComponent(actions).setButtonText("Cancel").onClick(() => {
      tokenInput.setValue(this.plugin.settings.token);
      this._refreshTokenActions(tokenInput, actions);
    });

    this._refreshTokenActions(tokenInput, actions);
  }

  private _refreshTokenActions(
    input: TextComponent,
    actions: HTMLElement,
  ): void {
    const dirty = input.getValue().trim() !== this.plugin.settings.token;

    actions.toggleClass("mybrain-token-actions-visible", dirty);
  }

  private _syncStatusText(): string {
    if (this.plugin.isSyncing()) return "Syncing your vault…";

    const at = this.plugin.settings.lastSyncAt;

    if (at) return `Last synced ${new Date(at).toLocaleString()}`;

    return "Not synced yet";
  }

  /** Hidden while nothing waits; kept rendered so it can appear while the tab
   * is open. */
  private _renderPendingUploads(setting: Setting): () => void {
    setting.addButton((btn) =>
      btn.setButtonText("Retry now").onClick(async () => {
        btn.setDisabled(true);

        try {
          await this.plugin.retryUploads();
        } catch (e) {
          console.error("MyBrain: retry of failed uploads failed", e);
        } finally {
          btn.setDisabled(false);
        }
      }),
    );

    const apply = (): void => {
      const pending = this.plugin.pendingUploads();

      setting.settingEl.toggle(pending.length > 0);
      setting.setDesc(_pendingUploadsDesc(pending));
    };

    apply();

    return this.plugin.onPendingUploadsChange(apply);
  }

  private _renderResyncSetting(setting: Setting): () => void {
    let resyncButton!: ButtonComponent;

    setting.addButton((btn) => {
      resyncButton = btn;
      btn.setButtonText("Resync").onClick(async () => {
        const ok = await confirm(this.app, {
          title: "MyBrain: full resync",
          body: "This clears the sync watermark and re-sends the list of notes in the synced folders to MyBrain. Continue?",
          confirmText: "Resync",
          destructive: true,
        });

        if (!ok) return;

        try {
          const succeeded = await this.plugin.resync();

          if (succeeded) {
            this.plugin.notifier.notice("MyBrain: full resync completed");
          }
        } catch (e) {
          console.error("MyBrain: resync failed", e);
          this.plugin.notifier.notice(
            `MyBrain: resync failed — ${errorMessage(e)}`,
          );
        }
      });
    });

    // Reflects any full sync (deep-link, startup), not only a manual click.
    const apply = (): void => {
      const syncing = this.plugin.isSyncing();

      resyncButton.setDisabled(syncing);
      resyncButton.setButtonText(syncing ? "Syncing…" : "Resync");
    };

    apply();

    return this.plugin.onSyncStateChange(apply);
  }

  private _versionText(): string {
    const installed = this.plugin.manifest.version;
    const latest = this.plugin.latestKnownVersion();

    if (latest && compareVersions(installed, latest) < 0) {
      return `Currently installed: ${installed} — update available: ${latest}`;
    }

    return `Currently installed: ${installed}`;
  }
}

function _pendingUploadsDesc(
  pending: readonly PendingUpload[],
): DocumentFragment {
  const { lines, more } = pendingUploadLines(pending);

  return createFragment((f) => {
    f.createDiv({ text: pendingUploadsSummary(pending.length) });

    const list = f.createEl("ul");

    for (const line of lines) list.createEl("li", { text: line });

    if (more) f.createDiv({ text: more });
  });
}
