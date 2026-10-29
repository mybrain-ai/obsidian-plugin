import { nextBackoffDelay } from "@/backoff";
import { BATCH_SIZE } from "@/constants";
import { HttpError, TokenRejectedError } from "@/network";
import type { ContentMissing, ContentNote, IngestResponse } from "@/types";
import type { RequestEnvelope } from "@/vault-metadata";

export type ContentReadResult<R> =
  | { kind: "note"; note: Omit<ContentNote, "requestId">; resolved: R[] }
  | { kind: "missing"; reason: ContentMissing["reason"] };

export interface ContentQueueDeps<R> {
  /** Read one requested note as it is now. */
  read(path: string): Promise<ContentReadResult<R>>;
  /** `POST /content` with one batch. */
  send(
    notes: ContentNote[],
    missing: ContentMissing[],
  ): Promise<IngestResponse | undefined>;
  /** Upload the attachments the server asked for after a batch. */
  uploadAttachments(hashes: string[], resolved: R[]): Promise<void>;
  onTokenRejected(): void;
  setTimer(fn: () => void, ms: number): number;
  clearTimer(id: number): void;
}

/** Body of `POST /content`. */
export type ContentBody = RequestEnvelope & {
  protocol: 2;
  notes: ContentNote[];
  missing: ContentMissing[];
};

const RETRY_DELAYS_MS = [1_000, 5_000, 30_000, 120_000];

export function buildContentBody(
  envelope: RequestEnvelope,
  notes: ContentNote[],
  missing: ContentMissing[],
): ContentBody {
  return { protocol: 2, ...envelope, notes, missing };
}

/** Notes the server asked for (`content_requested`), sent `BATCH_SIZE` at a
 * time. A path asked for twice goes once, under the latest request id. */
export class ContentRequestQueue<R> {
  private readonly pending = new Map<string, string>();
  private current: Promise<void> | null = null;
  private attempt = 0;
  private retryTimer: number | null = null;
  private stopped = false;

  constructor(private readonly deps: ContentQueueDeps<R>) {}

  get size(): number {
    return this.pending.size;
  }

  request(requestId: string, paths: readonly string[]): void {
    if (this.stopped) return;

    for (const path of paths) {
      // Re-insert so a repeated path moves to the back with the newest id.
      this.pending.delete(path);
      this.pending.set(path, requestId);
    }

    // Start on the next microtask so requests arriving together share batches.
    void Promise.resolve().then(() => this.runLogged());
  }

  /** Drop every queued request (the connection they came on is gone; the
   * server asks again on the next one). */
  clear(): void {
    this.pending.clear();
    this.attempt = 0;
    this.cancelRetry();
  }

  stop(): void {
    this.stopped = true;
    this.clear();
  }

  /** Send what is queued. While a run is going this returns that run. It
   * resolves when the queue is empty or waiting for a retry. */
  run(): Promise<void> {
    if (this.stopped || this.retryTimer !== null) return Promise.resolve();

    this.current ??= this.drain().finally(() => {
      this.current = null;
    });

    return this.current;
  }

  private async drain(): Promise<void> {
    while (!this.stopped && this.pending.size > 0) {
      const batch: Array<[string, string]> = [];

      for (const entry of this.pending) {
        if (batch.length === BATCH_SIZE) break;
        batch.push(entry);
      }

      if (!(await this.sendBatch(batch))) return;
    }
  }

  private async sendBatch(batch: Array<[string, string]>): Promise<boolean> {
    const notes: ContentNote[] = [];
    const missing: ContentMissing[] = [];
    const resolved: R[] = [];
    const unread = new Set<string>();
    let readError: unknown = null;

    for (const [path, requestId] of batch) {
      let read: ContentReadResult<R>;

      try {
        read = await this.deps.read(path);
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
        response = await this.deps.send(notes, missing);
      }
    } catch (e) {
      if (e instanceof TokenRejectedError) {
        this.pending.clear();
        this.deps.onTokenRejected();
        return false;
      }

      if (!(e instanceof HttpError && e.status >= 400 && e.status < 500)) {
        this.scheduleRetry(e);
        return false;
      }

      // A refused batch (e.g. 409, a request the server already closed)
      // won't succeed on retry: drop it and go on with the rest.
      console.warn(`MyBrain: content batch refused (status ${e.status})`);
    }

    for (const [path, requestId] of batch) {
      // Leave the path queued if it couldn't be read, or if a newer request
      // for it arrived mid-send.
      if (!unread.has(path) && this.pending.get(path) === requestId) {
        this.pending.delete(path);
      }
    }

    const rejected = response?.rejected.length ?? 0;

    if (rejected > 0) {
      console.warn(`MyBrain: server refused ${rejected} requested note(s)`);
    }

    const needed = response?.attachmentsNeeded ?? [];

    if (needed.length > 0) await this.deps.uploadAttachments(needed, resolved);

    if (unread.size > 0) {
      console.warn(
        `MyBrain: failed to read ${unread.size} requested note(s)`,
        readError,
      );
      this.scheduleRetry(readError);
      return false;
    }

    this.attempt = 0;

    return true;
  }

  /** Retry after 1 s, 5 s, 30 s and 2 min, then drop what is queued: the
   * server keeps every open request and asks again on the next reconnect. */
  private scheduleRetry(error: unknown): void {
    if (this.attempt >= RETRY_DELAYS_MS.length) {
      console.warn(
        `MyBrain: giving up on ${this.pending.size} requested note(s) until the next reconnect`,
        error,
      );
      this.pending.clear();
      this.attempt = 0;
      return;
    }

    const delay = nextBackoffDelay(this.attempt, RETRY_DELAYS_MS);

    this.attempt += 1;
    this.retryTimer = this.deps.setTimer(() => {
      this.retryTimer = null;
      void this.runLogged();
    }, delay);
  }

  private cancelRetry(): void {
    if (this.retryTimer === null) return;

    this.deps.clearTimer(this.retryTimer);
    this.retryTimer = null;
  }

  private async runLogged(): Promise<void> {
    try {
      await this.run();
    } catch (e) {
      console.warn("MyBrain: sending requested notes failed", e);
    }
  }
}
