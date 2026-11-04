import { NOT_CONFIGURED_NOTICE } from "@/core/constants";
import { TokenRejectedError } from "@/core/errors";
import { readNativeNoteSettings } from "@/core/notes/native-settings";
import type { SyncDeps } from "@/core/ports";
import { quietlyAsync } from "@/core/shared/quietly";
import { pushNegotiatedManifest } from "@/core/sync/negotiation";
import { manifestV1Body, manifestV2Body } from "@/core/sync/payloads";
import { canSync } from "@/core/sync/settings";
import type { SyncState } from "@/core/sync/sync-state";
import {
  isInScope,
  markTokenRejected,
  requestEnvelope,
  uploadNeeded,
} from "@/core/sync/sync-steps";
import type { NoteSnapshot, PushOptions } from "@/core/sync/types";

/** Full sync of the notes in scope, negotiating the protocol (see
 * `pushNegotiatedManifest`). */
export class FullSync {
  constructor(
    private readonly _deps: SyncDeps,
    private readonly _state: SyncState,
  ) {}

  /** Push the manifest of every note in scope; true when one went out. An
   * initial push reports progress and results in notices. */
  async push({ initial, fallbackToV1 = true }: PushOptions): Promise<boolean> {
    if (!canSync(this._deps.settings())) {
      if (initial) {
        this._deps.notifier.notice(NOT_CONFIGURED_NOTICE);
      }

      return false;
    }

    this._state.begin();

    try {
      return await this._run(initial, fallbackToV1);
    } finally {
      this._state.end();
    }
  }

  private async _run(
    initial: boolean,
    fallbackToV1: boolean,
  ): Promise<boolean> {
    const deps = this._deps;
    const paths = deps.vault
      .markdownPaths()
      .filter((f) => isInScope(deps, f.path))
      .map((f) => f.path);

    if (initial) {
      deps.notifier.notice(`MyBrain: syncing ${paths.length} notes...`);
    }

    let sentCount = 0;

    try {
      // Read once: the protocol 1 fallback reuses the reads of the v2 attempt.
      const reads = await deps.vault.readMany(paths);

      const outcome = await pushNegotiatedManifest({
        sendV2: async () => {
          sentCount = await this._postManifestV2(reads);
        },
        sendV1: async () => {
          sentCount = await this._postManifestV1(reads);
        },
        fallbackToV1,
        log: (message) => console.warn(message),
      });

      const settings = deps.settings();

      deps.auth.rejected = false;
      settings.serverProtocol = outcome.protocol;

      if (outcome.sent) settings.lastSyncAt = deps.clock();

      // The sync already happened; a failed save is logged, not reported as
      // a failed sync, and the next save writes these values.
      await quietlyAsync("save after a sync", deps.save());

      const unreadable = paths.length - reads.length;

      if (initial) {
        deps.notifier.notice(
          unreadable > 0
            ? `MyBrain: synced ${sentCount} notes; ${unreadable} could not be read`
            : `MyBrain: synced ${sentCount} notes`,
        );
      }

      return outcome.sent;
    } catch (e) {
      if (e instanceof TokenRejectedError) {
        markTokenRejected(deps);

        return false;
      }

      console.warn("MyBrain: manifest push failed", e);

      if (initial) {
        deps.notifier.notice(
          "MyBrain: sync failed. Try Resync full vault in settings.",
        );
      }

      return false;
    }
  }

  /** Protocol 2 manifest: metadata of every note in scope, no text. */
  private async _postManifestV2(reads: NoteSnapshot[]): Promise<number> {
    const deps = this._deps;
    const body = manifestV2Body(
      reads,
      deps.vault.folderTree(),
      await readNativeNoteSettings(
        deps.vault.configReader(),
        deps.vault.configDir(),
      ),
      { ...requestEnvelope(deps), pluginVersion: deps.pluginVersion },
    );

    // Attachments go up only with the text of a note that embeds them, when
    // the server asks for that note.
    await deps.api.postManifest(body);

    return body.files.length;
  }

  /** Protocol 1 manifest: every note with its text. */
  private async _postManifestV1(reads: NoteSnapshot[]): Promise<number> {
    const deps = this._deps;

    for (const read of reads) deps.attachments.remember(read.attachments);

    const body = manifestV1Body(
      reads,
      deps.vault.folderTree(),
      requestEnvelope(deps),
    );
    const response = await deps.api.postManifest(body);

    await uploadNeeded(deps, response);

    return body.files.length;
  }
}
