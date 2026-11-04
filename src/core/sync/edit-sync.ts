import { BATCH_SIZE, DEBOUNCE_MS } from "@/core/constants";
import { TokenRejectedError } from "@/core/errors";
import type { SyncDeps } from "@/core/ports";
import { quietlyAsync } from "@/core/shared/quietly";
import type { FullSync } from "@/core/sync/full-sync";
import { materializeEvents } from "@/core/sync/negotiation";
import { ingestBody, upsertV1, upsertV2 } from "@/core/sync/payloads";
import { ackBatch, enqueue, failBatch, nextBatch } from "@/core/sync/queue";
import { canSync } from "@/core/sync/settings";
import {
  isInScope,
  markTokenRejected,
  requestEnvelope,
  uploadNeeded,
} from "@/core/sync/sync-steps";
import type {
  IngestEvent,
  IngestResponse,
  NoteRef,
  QueueState,
  ServerProtocol,
  UpsertEvent,
  UpsertEventV2,
  UpsertRebuilders,
} from "@/core/sync/types";

/** Note edits queued, debounced per path, and sent in batches under the
 * protocol the last manifest push agreed on. */
export class EditSync {
  private readonly _pendingFlushTimers = new Map<string, number>();
  /** Obsidian fires `modify` on autosave even when the file is unchanged. */
  private readonly _lastEnqueuedHashes = new Map<string, string>();
  private _draining = false;
  private _unloaded = false;

  constructor(
    private readonly _deps: SyncDeps,
    private readonly _fullSync: FullSync,
    private _queue: QueueState,
  ) {}

  /** Queue an upsert for a created or modified note, after the debounce. */
  onUpsert(note: NoteRef): void {
    if (!isInScope(this._deps, note.path)) return;

    this._scheduleFlush(note.path, () => this._enqueueUpsert(note));
  }

  /** Queue a delete for a removed note, after the debounce. */
  onDelete(note: NoteRef): void {
    if (!isInScope(this._deps, note.path)) return;

    this._scheduleFlush(note.path, () => {
      this._queue = enqueue(this._queue, { op: "delete", path: note.path });
      this._lastEnqueuedHashes.delete(note.path);
      void this.drain();
    });
  }

  /** Queue a rename when either side is in scope, after the debounce. */
  onRename(note: NoteRef, oldPath: string): void {
    if (!isInScope(this._deps, note.path) && !isInScope(this._deps, oldPath)) {
      return;
    }

    this._scheduleFlush(note.path, () => {
      this._queue = enqueue(this._queue, {
        op: "rename",
        oldPath,
        newPath: note.path,
      });

      const carried = this._lastEnqueuedHashes.get(oldPath);

      this._lastEnqueuedHashes.delete(oldPath);

      if (carried !== undefined) {
        this._lastEnqueuedHashes.set(note.path, carried);
      }

      void this.drain();
    });
  }

  /** Picks up edits made while the plugin was off (git pull, mobile sync).
   * Async so a throw rejects the promise instead of the caller. */
  async catchUp(): Promise<void> {
    const since = this._deps.settings().lastSyncAt;

    if (since === null) return;

    const stale = this._deps.vault
      .markdownPaths()
      .filter((f) => isInScope(this._deps, f.path) && f.mtime > since);

    for (const file of stale) {
      void this._enqueueUpsert({ path: file.path });
    }
  }

  /** Send the queued events batch by batch, until the queue is empty, a
   * backoff is pending or a batch fails. */
  async drain(): Promise<void> {
    if (this._draining || this._unloaded) return;

    if (!canSync(this._deps.settings()) || this._deps.auth.rejected) return;

    this._draining = true;

    try {
      while (!this._unloaded) {
        const now = this._deps.clock();
        const batch = nextBatch(this._queue, BATCH_SIZE, now);

        if (batch.length === 0) return;

        const ok = await this._flush(batch);

        if (!ok) return;
      }
    } finally {
      this._draining = false;
    }
  }

  /** The events still waiting to be sent, as `data.json` stores them. */
  queued(): QueueState {
    return this._queue;
  }

  /** Cancel pending debounces and stop draining; nothing goes out after. */
  stop(): void {
    this._unloaded = true;
    this._pendingFlushTimers.forEach((id) => this._deps.timers.clear(id));
    this._pendingFlushTimers.clear();
  }

  private _scheduleFlush(key: string, fn: () => void | Promise<void>): void {
    const existing = this._pendingFlushTimers.get(key);

    if (existing) {
      this._deps.timers.clear(existing);
    }

    const timer = this._deps.timers.set(() => {
      this._pendingFlushTimers.delete(key);
      void fn();
    }, DEBOUNCE_MS);

    this._pendingFlushTimers.set(key, timer);
  }

  private async _enqueueUpsert(note: NoteRef): Promise<void> {
    // A scope change can land during the debounce window.
    if (!isInScope(this._deps, note.path)) return;

    try {
      const hash = await this._deps.vault.contentHash(note.path);

      if (this._lastEnqueuedHashes.get(note.path) === hash) return;

      const event = upsertV2(await this._deps.vault.read(note.path));

      this._queue = enqueue(this._queue, event);
      this._lastEnqueuedHashes.set(note.path, event.hash);

      void this.drain();
    } catch (e) {
      console.error("MyBrain: failed to build upsert event", note.path, e);
    }
  }

  private async _flush(batch: IngestEvent[]): Promise<boolean> {
    let response: IngestResponse | undefined;

    try {
      const protocol = await this._ensureServerProtocol();

      if (protocol === null) return false;

      // A refused batch is retried as is, never re-sent as protocol 1 with
      // note text: only a manifest push changes the protocol.
      response = await this._postIngest(batch, protocol);
    } catch (e) {
      if (e instanceof TokenRejectedError) {
        markTokenRejected(this._deps);

        return false;
      }

      console.warn("MyBrain: flush failed, will retry", e);
      this._queue = failBatch(this._queue, this._deps.clock());
      // A failed save is logged; the next one writes the queue again.
      await quietlyAsync("save the edit queue", this._deps.save());

      return false;
    }

    this._queue = ackBatch(this._queue, batch.length);

    // Saved only once accepted; after a crash before this, `catchUp` queues
    // the changed notes again, but deletes and renames are lost.
    await quietlyAsync("save the edit queue", this._deps.save());
    await uploadNeeded(this._deps, response);

    return true;
  }

  /** The server's protocol, learned by a metadata-only manifest push when not
   * known yet; null when that push found (and reported) a rejected token. */
  private async _ensureServerProtocol(): Promise<ServerProtocol | null> {
    const known = this._deps.settings().serverProtocol;

    if (known) return known;

    await this._fullSync.push({ initial: false, fallbackToV1: false });

    if (this._deps.auth.rejected) return null;

    const learned = this._deps.settings().serverProtocol;

    if (!learned) {
      throw new Error("MyBrain: could not determine the server protocol");
    }

    return learned;
  }

  private async _postIngest(
    batch: IngestEvent[],
    protocol: ServerProtocol,
  ): Promise<IngestResponse | undefined> {
    const rebuild: UpsertRebuilders = {
      v1: (path) => this._rebuildUpsert(path, (p) => this._buildUpsertV1(p)),
      v2: (path) => this._rebuildUpsert(path, (p) => this._buildUpsertV2(p)),
    };

    // One branch per protocol so a protocol 2 body can only hold metadata.
    if (protocol === 2) {
      const events = await materializeEvents(batch, 2, rebuild);

      if (events.length === 0) return undefined;

      return await this._deps.api.postIngest(
        ingestBody(events, 2, requestEnvelope(this._deps)),
      );
    }

    const events = await materializeEvents(batch, 1, rebuild);

    if (events.length === 0) return undefined;

    return await this._deps.api.postIngest(
      ingestBody(events, 1, requestEnvelope(this._deps)),
    );
  }

  /** A queued note rebuilt as it is now, or null when it's gone or out of
   * scope. */
  private async _rebuildUpsert<T>(
    path: string,
    build: (path: string) => Promise<T>,
  ): Promise<T | null> {
    if (
      this._deps.vault.notePath(path) === null ||
      !isInScope(this._deps, path)
    ) {
      return null;
    }

    return await build(path);
  }

  private async _buildUpsertV1(path: string): Promise<UpsertEvent> {
    const read = await this._deps.vault.read(path);

    this._deps.attachments.remember(read.attachments);

    return upsertV1(read);
  }

  private async _buildUpsertV2(path: string): Promise<UpsertEventV2> {
    return upsertV2(await this._deps.vault.read(path));
  }
}
