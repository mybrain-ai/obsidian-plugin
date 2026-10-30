import { ButtonComponent, Notice } from "obsidian";

import type { UploadFailurePrompt } from "@/core/ports";
import { uploadFailureNoticeText } from "@/ui/upload-texts";

/** A notice that stays until closed, with Retry and Dismiss; while it is on
 * screen a new failure updates its count instead of opening another. */
export class ObsidianUploadFailurePrompt implements UploadFailurePrompt {
  private _notice: Notice | null = null;
  private _textEl: HTMLElement | null = null;

  /** Open the notice, or update its count when it is already open. */
  show(count: number, onRetry: () => void): void {
    if (this._isOpen()) {
      this.update(count);

      return;
    }

    const fragment = createFragment((f) => {
      this._textEl = f.createDiv({ text: uploadFailureNoticeText(count) });

      const actions = f.createDiv({ cls: "mybrain-notice-actions" });

      new ButtonComponent(actions)
        .setButtonText("Retry")
        .setCta()
        .onClick(() => {
          this.close();
          onRetry();
        });
      new ButtonComponent(actions)
        .setButtonText("Dismiss")
        .onClick(() => this.close());
    });

    this._notice = new Notice(fragment, 0);
  }

  /** Update the count when the notice is open. */
  update(count: number): void {
    if (this._isOpen()) this._textEl?.setText(uploadFailureNoticeText(count));
  }

  /** Take the notice off screen. */
  close(): void {
    this._notice?.hide();
    this._notice = null;
    this._textEl = null;
  }

  /** Obsidian also closes a notice on click, so the DOM is the truth. */
  private _isOpen(): boolean {
    return this._notice?.containerEl.isConnected === true;
  }
}
