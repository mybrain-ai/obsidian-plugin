import type { SyncControllerDeps } from "@/core/ports";
import { quietlyAsync } from "@/core/shared/quietly";
import { applyDeepLinkSettings } from "@/core/sync/deep-link-settings";
import { canSync } from "@/core/sync/settings";
import type { DeepLinkSettings } from "@/core/sync/types";

/** The sync steps that follow a startup or a user action. */
export class SyncController {
  constructor(private readonly _deps: SyncControllerDeps) {}

  /** Catch up on edits made while the plugin was off, or run the first full
   * sync when there was none yet. */
  startup(): void {
    const settings = this._deps.settings();

    if (!canSync(settings)) return;

    if (settings.lastSyncAt) {
      // Not awaited: a failed catch-up must not stop the rest of startup.
      void quietlyAsync("catch up", this._deps.editSync.catchUp());
    } else {
      void this._deps.fullSync.push({ initial: true });
    }
  }

  /** Store what an install link carries, reconnect, and start syncing. */
  async applyDeepLink(incoming: DeepLinkSettings): Promise<void> {
    const settings = this._deps.settings();
    const { token, endpoint, vaultId, vaultName } = settings;
    const { rejected } = this._deps.auth;

    applyDeepLinkSettings(settings, this._deps.auth, incoming);

    await this._savedOrRestored(() => {
      Object.assign(settings, { token, endpoint, vaultId, vaultName });
      this._deps.auth.rejected = rejected;
    });

    this._deps.restartChannel();

    // Start syncing right away instead of waiting for a manifest_request.
    if (canSync(this._deps.settings())) {
      void this._deps.fullSync.push({ initial: true });
    }
  }

  /** Store a token the user pasted and reconnect with it; a new token gets a
   * fresh chance, so the rejected flag is cleared. */
  async saveToken(token: string): Promise<void> {
    const settings = this._deps.settings();
    const previous = settings.token;

    settings.token = token;

    await this._savedOrRestored(() => {
      settings.token = previous;
    });

    this._deps.auth.rejected = false;
    this._deps.restartChannel();
  }

  /** Clears the sync watermark and pushes every note in scope again. */
  async resync(): Promise<boolean> {
    const settings = this._deps.settings();
    const previous = settings.lastSyncAt;

    settings.lastSyncAt = null;

    await this._savedOrRestored(() => {
      settings.lastSyncAt = previous;
    });

    return await this._deps.fullSync.push({ initial: true });
  }

  /** Save; when that fails, undo the change in memory and rethrow, so what
   * is used matches what is stored. */
  private async _savedOrRestored(restore: () => void): Promise<void> {
    try {
      await this._deps.save();
    } catch (e) {
      restore();

      throw e;
    }
  }
}
