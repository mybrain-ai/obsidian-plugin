import { App, Modal } from "obsidian";

export type ConfirmOptions = {
  title: string;
  body: string | ((contentEl: HTMLElement) => void);
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
};

export function confirm(app: App, options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = new (class extends Modal {
      private decided = false;
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
          this.decided = true;
          resolve(false);
          this.close();
        });
        const ok = buttons.createEl("button", {
          text: options.confirmText ?? "Confirm",
          cls: options.destructive ? "mod-warning" : "mod-cta",
        });
        ok.addEventListener("click", () => {
          this.decided = true;
          resolve(true);
          this.close();
        });
      }
      onClose(): void {
        if (!this.decided) resolve(false);
      }
    })(app);
    modal.open();
  });
}
