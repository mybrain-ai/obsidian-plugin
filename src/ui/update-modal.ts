import { type App, Modal } from "obsidian";

import type { UpdatePrompt } from "@/core/ports";
import type { LatestPluginRelease } from "@/core/update/types";

/** The update prompt port as an Obsidian modal. */
export class ObsidianUpdatePrompt implements UpdatePrompt {
  constructor(private readonly _app: App) {}

  /** Show the release with a way to skip this version. */
  show(
    installed: string,
    release: LatestPluginRelease,
    onSkip: () => void,
  ): void {
    new UpdateModal(this._app, installed, release, onSkip).open();
  }
}

/** Closing means "remind me later"; only the skip button silences this
 * version, which `confirm()` can't tell apart from cancel. */
class UpdateModal extends Modal {
  constructor(
    app: App,
    private readonly _installed: string,
    private readonly _release: LatestPluginRelease,
    private readonly _onSkip: () => void,
  ) {
    super(app);
  }

  /** Render the versions, the release notes, how to update and the buttons. */
  onOpen(): void {
    this.titleEl.setText("MyBrain: update available");

    this.contentEl.createEl("p", {
      text: `${this._installed} → ${this._release.version}`,
    });

    if (this._release.notes) {
      this.contentEl.createDiv({
        cls: "mybrain-release-notes",
        text: this._release.notes,
      });
    }

    const howTo = this.contentEl.createEl("p");

    howTo.createEl("strong", { text: "How to update: " });
    howTo.createSpan({
      text: "Settings → Community plugins → Check for updates.",
    });

    const buttons = this.contentEl.createDiv({
      cls: "modal-button-container",
    });

    const skip = buttons.createEl("button", { text: "Skip this version" });

    skip.addEventListener("click", () => {
      this._onSkip();
      this.close();
    });

    const ok = buttons.createEl("button", { text: "Got it", cls: "mod-cta" });

    ok.addEventListener("click", () => this.close());
  }
}
