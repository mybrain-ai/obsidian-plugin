import { App, Modal } from "obsidian";

import type { ConfirmOptions } from "@/ui/types";

/** Ask the user to confirm; resolves false on cancel or when the dialog is
 * closed any other way. */
export function confirm(app: App, options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = new (class extends Modal {
      private _decided = false;

      /** Render the title, the body and the two buttons. */
      onOpen(): void {
        this.titleEl.setText(options.title);

        if (typeof options.body === "string") {
          this.contentEl.createEl("p", { text: options.body });
        } else {
          options.body(this.contentEl);
        }

        const buttons = this.contentEl.createDiv({
          cls: "modal-button-container",
        });
        const cancel = buttons.createEl("button", {
          text: options.cancelText ?? "Cancel",
        });

        cancel.addEventListener("click", () => {
          this._decided = true;
          resolve(false);
          this.close();
        });

        const ok = buttons.createEl("button", {
          text: options.confirmText ?? "Confirm",
          cls: options.destructive ? "mod-warning" : "mod-cta",
        });

        ok.addEventListener("click", () => {
          this._decided = true;
          resolve(true);
          this.close();
        });
      }

      /** Closing without a choice counts as cancel. */
      onClose(): void {
        if (!this._decided) resolve(false);
      }
    })(app);

    modal.open();
  });
}
