import { BATCH_SIZE } from "@/core/constants";
import type { ContentReadResult } from "@/core/content/types";
import { TokenRejectedError, isClientError } from "@/core/errors";
import type { ContentQueueDeps } from "@/core/ports";
import { nextBackoffDelay } from "@/core/shared/backoff";
import type {
  ContentMissing,
  ContentNote,
  IngestResponse,
  ResolvedAttachment,
} from "@/core/sync/types";

const RETRY_DELAYS_MS = [1_000, 5_000, 30_000, 120_000];

/** Notes the server asked for (`content_requested`), sent `BATCH_SIZE` at a
 * time. A path asked for twice goes once, under the latest request id. */
export class ContentRequestQueue {
  private readonly _pending = new Map<string, string>();
  private _current: Promise<void> | null = null;
  private _attempt = 0;
  private _retryTimer: number | null = null;
  private _stopped = false;

  constructor(private readonly _deps: ContentQueueDeps) {}

  /** Queue the paths of one `content_requested` message and start sending. */
  request(requestId: string, paths: readonly string[]): void {
    if (this._stopped) return;

    for (const path of paths) {
      // Re-insert so a repeated path moves to the back with the newest id.
      this._pending.delete(path);
      this._pending.set(path, requestId);
    }

    // Start on the next microtask so requests arriving together share batches.
    void Promise.resolve().then(() => this._runLogged());
  }

  /** Send what is queued. While a run is going this returns that run. It
   * resolves when the queue is empty or waiting for a retry. */
  run(): Promise<void> {
    if (this._stopped || this._retryTimer !== null) return Promise.resolve();

    this._current ??= this._drain().finally(() => {
      this._current = null;
    });

    return this._current;
  }

  /** Stop for good on unload: drop what is queued and ignore later requests. */
  stop(): void {
    this._stopped = true;
    this.clear();
  }

  /** Drop every queued request (the connection they came on is gone; the
   * server asks again on the next one). */
  clear(): void {
    this._pending.clear();
    this._attempt = 0;
    this._cancelRetry();
  }

  /** How many paths are waiting to be sent. */
  get size(): number {
    return this._pending.size;
  }

  private async _runLogged(): Promise<void> {
    try {
      await this.run();
    } catch (e) {
      console.warn("MyBrain: sending requested notes failed", e);
    }
  }

  private async _drain(): Promise<void> {
    while (!this._stopped && this._pending.size > 0) {
      const batch: Array<[string, string]> = [];

      for (const entry of this._pending) {
        if (batch.length === BATCH_SIZE) break;

        batch.push(entry);
      }

      if (!(await this._sendBatch(batch))) return;
    }
  }

  private async _sendBatch(batch: Array<[string, string]>): Promise<boolean> {
    const notes: ContentNote[] = [];
    const missing: ContentMissing[] = [];
    const resolved: ResolvedAttachment[] = [];
    const unread = new Set<string>();
    let readError: unknown = null;

    for (const [path, requestId] of batch) {
      let read: ContentReadResult;

      try {
        read = await this._deps.read(path);
      } catch (e) {
        // A note that exists but can't be read now stays queued: answering
        // `not_found` would close the request on the server for good.
        unread.add(path);
        readError = e;
        continue;
      }

      if (read.kind === "missing") {
        missing.push({ requestId, path, reason: read.reason });
        continue;
      }

      notes.push({ requestId, ...read.note });
      resolved.push(...read.resolved);
    }

    let response: IngestResponse | undefined;

    try {
      if (notes.length > 0 || missing.length > 0) {
        response = await this._deps.send(notes, missing);
      }
    } catch (e) {
      if (e instanceof TokenRejectedError) {
        this._pending.clear();
        this._deps.onTokenRejected();

        return false;
      }

      if (!isClientError(e)) {
        this._scheduleRetry(e);

        return false;
      }

      // A refused batch (e.g. 409, a request the server already closed)
      // won't succeed on retry: drop it and go on with the rest.
      console.warn(`MyBrain: content batch refused (status ${e.status})`);
    }

    for (const [path, requestId] of batch) {
      // A newer request for the path may have arrived mid-send.
      if (!unread.has(path) && this._pending.get(path) === requestId) {
        this._pending.delete(path);
      }
    }

    const rejected = response?.rejected.length ?? 0;

    if (rejected > 0) {
      console.warn(`MyBrain: server refused ${rejected} requested note(s)`);
    }

    const needed = response?.attachmentsNeeded ?? [];

    if (needed.length > 0) await this._deps.uploadAttachments(needed, resolved);

    if (unread.size > 0) {
      console.warn(
        `MyBrain: failed to read ${unread.size} requested note(s)`,
        readError,
      );
      this._scheduleRetry(readError);

      return false;
    }

    this._attempt = 0;

    return true;
  }

  /** Retry on the `RETRY_DELAYS_MS` schedule, then drop what is queued: the
   * server keeps every open request and asks again on the next reconnect. */
  private _scheduleRetry(error: unknown): void {
    if (this._attempt >= RETRY_DELAYS_MS.length) {
      console.warn(
        `MyBrain: giving up on ${this._pending.size} requested note(s) until the next reconnect`,
        error,
      );
      this._pending.clear();
      this._attempt = 0;

      return;
    }

    const delay = nextBackoffDelay(this._attempt, RETRY_DELAYS_MS);

    this._attempt += 1;
    this._retryTimer = this._deps.timers.set(() => {
      this._retryTimer = null;
      void this._runLogged();
    }, delay);
  }

  private _cancelRetry(): void {
    if (this._retryTimer === null) return;

    this._deps.timers.clear(this._retryTimer);
    this._retryTimer = null;
  }
}
