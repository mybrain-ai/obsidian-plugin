import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type MyBrainPlugin from "@/main";
import { confirm } from "@/ui";
import { parseHttpsEndpoint } from "@/url";

declare const __MYBRAIN_API_BASE__: string;

export interface MyBrainSettings {
  endpoint: string;
  token: string;
  excludeFolders: string[];
  vaultId: string;
  vaultName: string;
  lastSyncAt: number | null;
  syncAttachmentsOnMobile: boolean;
}

export const DEFAULT_SETTINGS: MyBrainSettings = {
  endpoint: __MYBRAIN_API_BASE__,
  token: "",
  excludeFolders: [],
  vaultId: "",
  vaultName: "",
  lastSyncAt: null,
  syncAttachmentsOnMobile: false,
};

export class MyBrainSettingTab extends PluginSettingTab {
  readonly plugin: MyBrainPlugin;

  constructor(app: App, plugin: MyBrainPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Ingest endpoint")
      .setDesc("Base URL of the MyBrain ingest API (https, no trailing slash).")
      .addText((text) => {
        text
          .setPlaceholder("https://api.mybrain.ai/integrations/obsidian")
          .setValue(this.plugin.settings.endpoint)
          .onChange(async (value) => {
            const cleaned = value.trim().replace(/\/$/, "");

            if (cleaned === "") {
              text.inputEl.removeClass("mod-error");

              if (this.plugin.settings.endpoint === "") return;

              this.plugin.settings.endpoint = "";

              await this.plugin.saveSettings();

              this.plugin.restartWebSocket();

              return;
            }

            if (!parseHttpsEndpoint(cleaned)) {
              text.inputEl.addClass("mod-error");
              return;
            }

            text.inputEl.removeClass("mod-error");

            if (this.plugin.settings.endpoint === cleaned) return;

            this.plugin.settings.endpoint = cleaned;

            await this.plugin.saveSettings();

            this.plugin.restartWebSocket();
          });
      });

    new Setting(containerEl)
      .setName("Bearer token")
      .setDesc(
        "Paste the token from the MyBrain Connect Obsidian page. Activates on first POST. Stored in plain text inside this vault's plugin data — avoid storing production tokens in synced or shared vaults, and rotate the token in the MyBrain web app if the vault is compromised.",
      )
      .addText((text) => {
        text
          .setPlaceholder("mbr_sk_live_...")
          .setValue(this.plugin.settings.token)
          .onChange(async (value) => {
            const trimmed = value.trim();

            if (this.plugin.settings.token === trimmed) return;

            this.plugin.settings.token = trimmed;

            await this.plugin.saveSettings();

            this.plugin.restartWebSocket();
          });
        text.inputEl.addClass("mybrain-token-input");
      });

    new Setting(containerEl)
      .setName("Exclude folders")
      .setDesc(
        "One folder path per line. Notes under these prefixes are skipped.",
      )
      .addTextArea((area) => {
        area
          .setPlaceholder("Templates\nArchive/old")
          .setValue(this.plugin.settings.excludeFolders.join("\n"))
          .onChange(async (value) => {
            this.plugin.settings.excludeFolders = value
              .split("\n")
              .map((line) => line.trim())
              .filter((line) => line.length > 0);
            await this.plugin.saveSettings();
          });
        area.inputEl.rows = 4;
      });

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

    new Setting(containerEl)
      .setName("Resync full vault")
      .setDesc(
        "Clears the local sync watermark and re-uploads every markdown file.",
      )
      .addButton((btn) =>
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

            btn.setDisabled(true).setButtonText("Resyncing…");

            try {
              this.plugin.settings.lastSyncAt = null;

              await this.plugin.saveSettings();

              await this.plugin.initialScan();

              new Notice("MyBrain: full resync completed");
            } catch (e) {
              console.error("MyBrain: resync failed", e);
              new Notice(
                `MyBrain: resync failed — ${e instanceof Error ? e.message : String(e)}`,
              );
            } finally {
              btn.setDisabled(false).setButtonText("Resync");
            }
          }),
      );
  }
}
