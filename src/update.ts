import { Modal, Notice } from "obsidian";
import {
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_LAST_CHECK_KEY,
  UPDATE_LATEST_VERSION_KEY,
  UPDATE_SKIPPED_VERSION_KEY,
} from "@/constants";
import { loadDeviceValue, saveDeviceValue } from "@/device";
import type MyBrainPlugin from "@/main";
import type { LatestPluginRelease } from "@/types";
import { compareVersions } from "@/version";

/** Check the MyBrain backend for a newer plugin release and notify (never
 * self-update). Automatic checks are throttled to once a day, respect a
 * per-device skipped version, and stay silent on failure or when up to date;
 * manual checks bypass throttle and skip, and always answer with a Notice.
 * Requires a configured connection — the release info comes from the same
 * endpoint the vault syncs to. */
export async function checkForUpdates(
  plugin: MyBrainPlugin,
  { manual }: { manual: boolean },
): Promise<void> {
  const app = plugin.app;

  if (!plugin.canSync()) {
    if (manual) new Notice("MyBrain: set endpoint and token first");
    return;
  }

  if (!manual && !_isCheckDue(app)) return;

  // Record the attempt, not the success — a failing lookup must wait for the
  // next daily window, not retry on every hourly tick.
  saveDeviceValue(app, UPDATE_LAST_CHECK_KEY, String(Date.now()));

  const release = await plugin.fetchLatestPluginRelease();

  if (!release) {
    if (manual) new Notice("MyBrain: update check failed — try again later");
    return;
  }

  // Remembered so the settings tab can show an out-of-date note even when
  // the user skipped this version's modal.
  saveDeviceValue(app, UPDATE_LATEST_VERSION_KEY, release.version);

  if (compareVersions(plugin.manifest.version, release.version) >= 0) {
    if (manual) new Notice("MyBrain: you're on the latest version");
    return;
  }

  if (!manual) {
    const skipped = loadDeviceValue(app, UPDATE_SKIPPED_VERSION_KEY);
    if (skipped === release.version) return;
  }

  new Notice(
    `MyBrain: update available (${plugin.manifest.version} → ${release.version})`,
  );
  new UpdateModal(plugin, release).open();
}

/** Notify-only update prompt. Closing without choosing means "remind me
 * later" — only the explicit skip button silences this version, so a
 * dedicated modal is used instead of `confirm()` (whose Esc/close resolves
 * like the cancel button). */
class UpdateModal extends Modal {
  private readonly plugin: MyBrainPlugin;
  private readonly release: LatestPluginRelease;

  constructor(plugin: MyBrainPlugin, release: LatestPluginRelease) {
    super(plugin.app);
    this.plugin = plugin;
    this.release = release;
  }

  onOpen(): void {
    this.titleEl.setText("MyBrain: update available");

    this.contentEl.createEl("p", {
      text: `${this.plugin.manifest.version} → ${this.release.version}`,
    });

    if (this.release.notes) {
      this.contentEl.createDiv({
        cls: "mybrain-release-notes",
        text: this.release.notes,
      });
    }

    const howTo = this.contentEl.createEl("p");
    howTo.createEl("strong", { text: "How to update: " });
    howTo.createSpan({
      text:
        "installed via BRAT — run the “BRAT: Check for updates” command; " +
        "installed from the community directory — Settings → Community " +
        "plugins → Check for updates.",
    });

    const buttons = this.contentEl.createDiv({
      cls: "modal-button-container",
    });

    const skip = buttons.createEl("button", { text: "Skip this version" });
    skip.addEventListener("click", () => {
      saveDeviceValue(
        this.plugin.app,
        UPDATE_SKIPPED_VERSION_KEY,
        this.release.version,
      );
      this.close();
    });

    const ok = buttons.createEl("button", { text: "Got it", cls: "mod-cta" });
    ok.addEventListener("click", () => this.close());
  }
}

function _isCheckDue(app: MyBrainPlugin["app"]): boolean {
  const raw = loadDeviceValue(app, UPDATE_LAST_CHECK_KEY);
  const lastCheck = raw === null ? 0 : Number(raw);

  if (Number.isNaN(lastCheck)) return true;

  return Date.now() - lastCheck >= UPDATE_CHECK_INTERVAL_MS;
}
