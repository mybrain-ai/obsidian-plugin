import { nextBackoffDelay } from "@/backoff";
import { BATCH_SIZE } from "@/constants";
import { HttpError, TokenRejectedError } from "@/network";
import type { ContentMissing, ContentNote, ContentResponse } from "@/types";

export type ContentReadResult<R> =
  | { kind: "note"; note: Omit<ContentNote, "requestId">; resolved: R[] }
  | { kind: "missing"; reason: ContentMissing["reason"] };

export interface ContentQueueDeps<R> {
  /** Read one requested note as it is now. */
  read(path: string): Promise<ContentReadResult<R>>;
  /** `POST /content` with one batch. */
  send(notes: ContentNote[], missing: ContentMissing[]): Promise<ContentResponse | undefined>;
  /** Upload the attachments the server asked for after a batch. */
  uploadAttachments(hashes: string[], resolved: R[]): Promise<void>;
  onTokenRejected(): void;
  setTimer(fn: () => void, ms: number): number;
  clearTimer(id: number): void;
}

const RETRY_DELAYS_MS = [1_000, 5_000, 30_000, 120_000];

/** Body of `POST /content`. */
export function buildContentBody(
  envelope: { vaultId: string; vaultName: string; clientTime: string },
  notes: ContentNote[],
  missing: ContentMissing[],
): Record<string, unknown> {
  return { protocol: 2, ...envelope, notes, missing };
}

/** Notes the server asked for (`content_requested`), sent in batches of 50.
 * A path asked for twice is sent once, under the latest request id. After the
 * retries run out the pending paths are dropped: the server keeps every open
 * request and asks again when the plugin reconnects. */
export class ContentRequestQueue<R> {
  private readonly pending = new Map<string, string>();
  private running = false;
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
    void Promise.resolve().then(() => this.run());
  }

  stop(): void {
    this.stopped = true;
    this.pending.clear();

    if (this.retryTimer !== null) {
      this.deps.clearTimer(this.retryTimer);
      this.retryTimer = null;
    }
  }

  /** Resolves when the queue is empty or waiting for a retry. */
  async run(): Promise<void> {
    if (this.running || this.stopped || this.retryTimer !== null) return;

    this.running = true;

    try {
      while (!this.stopped && this.pending.size > 0) {
        const batch = Array.from(this.pending.entries()).slice(0, BATCH_SIZE);

        if (!(await this.sendBatch(batch))) return;
      }
    } finally {
      this.running = false;
    }
  }

  private async sendBatch(batch: Array<[string, string]>): Promise<boolean> {
    const notes: ContentNote[] = [];
    const missing: ContentMissing[] = [];
    const resolved: R[] = [];

    for (const [path, requestId] of batch) {
      let read: ContentReadResult<R>;

      try {
        read = await this.deps.read(path);
      } catch (e) {
        console.warn("MyBrain: failed to read a requested note", e);
        read = { kind: "missing", reason: "not_found" };
      }

      if (read.kind === "missing") {
        missing.push({ requestId, path, reason: read.reason });
        continue;
      }

      notes.push({ requestId, ...read.note });
      resolved.push(...read.resolved);
    }

    let response: ContentResponse | undefined;

    try {
      response = await this.deps.send(notes, missing);
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

    this.attempt = 0;

    for (const [path, requestId] of batch) {
      // Leave the path queued if a newer request for it arrived mid-send.
      if (this.pending.get(path) === requestId) this.pending.delete(path);
    }

    const rejected = response?.rejected.length ?? 0;

    if (rejected > 0) {
      console.warn(`MyBrain: server refused ${rejected} requested note(s)`);
    }

    const needed = response?.attachmentsNeeded ?? [];

    if (needed.length > 0) await this.deps.uploadAttachments(needed, resolved);

    return true;
  }

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

    const delay = nextBackoffDelay(this.attempt, RETRY_DELAYS_MS, {
      jitter: true,
    });

    this.attempt += 1;
    this.retryTimer = this.deps.setTimer(() => {
      this.retryTimer = null;
      void this.run();
    }, delay);
  }
}
