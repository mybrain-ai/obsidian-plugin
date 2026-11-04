import { Notice } from "obsidian";

import type { Notifier } from "@/core/ports";

/** The notifier port over Obsidian's `Notice` toasts. */
export class ObsidianNotifier implements Notifier {
  /** Show a toast with the message. */
  notice(message: string): void {
    new Notice(message);
  }
}
