import {
  NOT_CONFIGURED_NOTICE,
  PENDING_UPLOADS_KEY,
  TOKEN_REJECTED_NOTICE,
} from "@/core/constants";
import {
  FileReadError,
  TokenRejectedError,
  describeUploadError,
  isLastingRefusal,
} from "@/core/errors";
import type { AttachmentRetryDeps, FailedUploadRecorder } from "@/core/ports";
import { mapWithConcurrency } from "@/core/shared/concurrency";
import { quietly, quietlyAsync } from "@/core/shared/quietly";
import { plural } from "@/core/shared/text";
import type {
  BinaryFile,
  PendingUpload,
  RetryOutcome,
  RetryRun,
  UploadFailure,
} from "@/core/sync/types";

const QUICK_RETRY_MS = [10_000, 30_000, 120_000];
const GIVEN_UP_RETRY_MS = 60 * 60 * 1000;
const UNREADABLE_LIMIT_MS = 24 * 60 * 60 * 1000;
// While uploads are blocked nothing announces the unblocking (a new token, a
// setting turned on), so the retry looks again every minute.
const BLOCKED_RECHECK_MS = 60_000;
const MAX_PENDING = 1000;
const RETRY_CONCURRENCY = 3;
const STATES = new Set(["retrying", "given-up", "stuck"]);

/** Failed attachment uploads, kept on this device and retried until they go
 * through; the user is told when quick retries run out or MyBrain refuses. */
export class AttachmentRetry implements FailedUploadRecorder {
  private readonly _entries = new Map<string, PendingUpload>();
  /** Handles from this session, which follow renames; after a restart files
   * are found by path. */
  private readonly _handles = new Map<string, BinaryFile>();
  private readonly _listeners = new Set<() => void>();
  private _timer: number | null = null;
  private _inFlight: Promise<RetryRun> | null = null;
  private _stopped = false;

  /** Loads the list saved on this device, so failures recorded before
   * `start` join it instead of replacing it. */
  constructor(private readonly _deps: AttachmentRetryDeps) {
    for (const entry of _load(this._deps.device.load(PENDING_UPLOADS_KEY))) {
      this._entries.set(entry.ref.hash, entry);
    }

    this._cap();
  }

  /** Schedule what is due. */
  start(): void {
    this._schedule();
  }

  /** Take failed uploads; one already waiting keeps its place in the
   * schedule. After `stop` they are only saved. */
  record(failures: readonly UploadFailure[]): void {
    if (failures.length === 0) return;

    const now = this._deps.clock();
    let newlyWaiting = 0;

    for (const { resolved, error } of failures) {
      const { ref, file } = resolved;
      const existing = this._entries.get(ref.hash);

      this._handles.set(ref.hash, file);

      const stuck = isLastingRefusal(error);

      if (existing) {
        // A refusal from another note's upload counts too.
        if (stuck && existing.state === "retrying") newlyWaiting += 1;

        this._update(ref.hash, {
          ref,
          path: file.path,
          lastError: describeUploadError(error),
          ...(stuck ? { state: "stuck" as const } : {}),
        });
        continue;
      }

      if (stuck) newlyWaiting += 1;

      this._entries.set(ref.hash, {
        ref,
        path: file.path,
        state: stuck ? "stuck" : "retrying",
        attempts: 0,
        nextAttemptAt: now + QUICK_RETRY_MS[0],
        firstFailedAt: now,
        lastError: describeUploadError(error),
      });
    }

    this._cap();
    this._changed(newlyWaiting);
    this._schedule();
  }

  /** Send every waiting upload now, with fresh attempts, and report the
   * result in a notice. When uploads can't run, says why instead. */
  async retryNow(): Promise<void> {
    while (this._inFlight) await this._inFlight;

    if (this._stopped || this._entries.size === 0) return;

    const blocked = this._blockedNotice();

    if (blocked) {
      this._deps.notifier.notice(blocked);
      // Clicking Retry closed the notice; nothing changed, so it comes back.
      this._changed(this._waitingCount());

      return;
    }

    const result = await this._run(true);
    const notice = result && !this._stopped ? _resultNotice(result) : null;

    if (notice) this._deps.notifier.notice(notice);
  }

  /** The uploads still waiting, oldest first. */
  pending(): PendingUpload[] {
    return this._all().map((e) => ({ ...e, ref: { ...e.ref } }));
  }

  /** Called whenever the list changes; returns the unsubscribe. */
  onChange(listener: () => void): () => void {
    this._listeners.add(listener);

    return () => this._listeners.delete(listener);
  }

  /** Cancel the next retry and close the notice; nothing goes out after, and
   * the list stays saved. */
  stop(): void {
    this._stopped = true;

    if (this._timer !== null) this._deps.timers.clear(this._timer);

    this._timer = null;
    quietly("close the upload notice", () => this._deps.prompt.close());
  }

  private _cap(): void {
    if (this._entries.size <= MAX_PENDING) return;

    for (const entry of this._all()) {
      if (this._entries.size <= MAX_PENDING) return;

      console.warn("MyBrain: too many failed uploads, dropping", entry.path);
      this._forget(entry);
    }
  }

  /** Save, tell the listeners and show, update or close the notice (after
   * `stop` only save). Never throws, so it can't stop the retries. */
  private _changed(newlyWaiting: number): void {
    this._save();

    if (this._stopped) return;

    this._listeners.forEach((listener) =>
      quietly("update the upload list view", listener),
    );

    const waiting = this._waitingCount();

    quietly("update the upload notice", () => {
      if (waiting === 0) {
        this._deps.prompt.close();
      } else if (newlyWaiting > 0) {
        this._deps.prompt.show(waiting, () => {
          void quietlyAsync("retry failed uploads", this.retryNow());
        });
      } else {
        this._deps.prompt.update(waiting);
      }
    });
  }

  private _save(): void {
    quietly("save the failed uploads", () =>
      this._deps.device.save(PENDING_UPLOADS_KEY, JSON.stringify(this._all())),
    );
  }

  /** Set the timer for the earliest due entry, or a recheck while blocked; a
   * run in flight schedules again when it ends. */
  private _schedule(): void {
    if (this._timer !== null) this._deps.timers.clear(this._timer);

    this._timer = null;

    if (this._stopped || this._inFlight) return;

    const times = this._all()
      .filter((e) => e.state !== "stuck")
      .map((e) => e.nextAttemptAt);

    if (times.length === 0) return;

    const delay = this._canRun()
      ? Math.max(0, Math.min(...times) - this._deps.clock())
      : BLOCKED_RECHECK_MS;

    this._timer = this._deps.timers.set(() => {
      this._timer = null;
      void quietlyAsync("retry failed uploads", this._run());
    }, delay);
  }

  private _canRun(): boolean {
    return this._blockedNotice() === null;
  }

  /** What tells the user why uploads can't run now; null when they can. */
  private _blockedNotice(): string | null {
    if (!this._deps.canSync()) return NOT_CONFIGURED_NOTICE;

    if (this._deps.auth.rejected) return TOKEN_REJECTED_NOTICE;

    if (!this._deps.uploader.canUpload()) {
      return "MyBrain: attachment uploads are off on this device; turn on Sync attachments on mobile";
    }

    return null;
  }

  /** Upload the entries that are due, or every entry for a manual retry;
   * null when it could not run. */
  private async _run(manual = false): Promise<RetryRun | null> {
    if (this._inFlight || this._stopped) return null;

    if (!this._canRun()) {
      this._schedule();

      return null;
    }

    this._inFlight = this._runDue(manual);

    try {
      return await this._inFlight;
    } finally {
      this._inFlight = null;
      this._schedule();
    }
  }

  private async _runDue(manual: boolean): Promise<RetryRun> {
    const now = this._deps.clock();
    const due = this._all().filter(
      (e) => manual || (e.state !== "stuck" && e.nextAttemptAt <= now),
    );

    if (due.length === 0) return { uploaded: 0, failing: 0, dropped: 0 };

    const outcomes = await mapWithConcurrency(due, RETRY_CONCURRENCY, (entry) =>
      this._retryOne(entry, manual),
    );
    const count = (...kinds: RetryOutcome[]) =>
      outcomes.filter((o) => kinds.includes(o)).length;

    if (!this._stopped && count("rejected") > 0) {
      quietly("flag the rejected token", () => this._deps.onTokenRejected());
    }

    this._changed(count("newly-waiting"));

    return {
      uploaded: count("uploaded"),
      failing: count("failed", "newly-waiting", "rejected"),
      dropped: count("dropped"),
    };
  }

  /** One upload attempt; a file that is gone or changed is dropped. Never
   * throws. */
  private async _retryOne(
    entry: PendingUpload,
    manual: boolean,
  ): Promise<RetryOutcome> {
    if (this._stopped) return "stopped";

    try {
      const file = this._locate(entry);

      if (!file) {
        this._forget(entry);
        console.warn(
          "MyBrain: attachment gone or changed, upload dropped",
          entry.path,
        );

        return "dropped";
      }

      await this._deps.uploader.send({ ref: entry.ref, file });
      this._forget(entry);

      return "uploaded";
    } catch (e) {
      if (e instanceof TokenRejectedError) return "rejected";

      console.warn("MyBrain: attachment upload failed again", e);

      return this._fail(entry, e, this._deps.clock(), manual)
        ? "newly-waiting"
        : "failed";
    }
  }

  /** The file to upload (by handle, else by path), or null when it is gone
   * or no longer matches what the note referenced. */
  private _locate(entry: PendingUpload): BinaryFile | null {
    const hash = entry.ref.hash;
    const held = this._handles.get(hash);
    const heldStat = held?.stat();
    const file = heldStat ? held : this._deps.vault.binaryFile(entry.path);
    const stat = heldStat ?? file?.stat();

    if (!file || !stat) return null;

    if (stat.size !== entry.ref.size || stat.mtime !== entry.ref.mtime) {
      return null;
    }

    this._handles.set(hash, file);
    this._update(hash, { path: file.path });

    return file;
  }

  /** Move the entry along the schedule (a manual retry starts it over); true
   * when a retrying entry just ran out of quick retries or was refused. */
  private _fail(
    entry: PendingUpload,
    error: unknown,
    now: number,
    manual: boolean,
  ): boolean {
    const fresh = manual ? { state: "retrying" as const, attempts: 0 } : {};
    const current = {
      ...(this._entries.get(entry.ref.hash) ?? entry),
      ...fresh,
    };
    const wasRetrying = current.state === "retrying";
    const attempts = current.attempts + 1;
    // A file that still can't be read after a day won't fix itself.
    const unreadableForADay =
      error instanceof FileReadError &&
      now - current.firstFailedAt >= UNREADABLE_LIMIT_MS;
    const patch: Partial<PendingUpload> =
      isLastingRefusal(error) || unreadableForADay
        ? { state: "stuck" }
        : wasRetrying && attempts < QUICK_RETRY_MS.length
          ? { attempts, nextAttemptAt: now + QUICK_RETRY_MS[attempts] }
          : {
              state: "given-up",
              attempts,
              nextAttemptAt: now + GIVEN_UP_RETRY_MS,
            };

    this._update(entry.ref.hash, {
      ...fresh,
      ...patch,
      lastError: describeUploadError(error),
    });

    return wasRetrying && patch.state !== undefined;
  }

  private _waitingCount(): number {
    return this._all().filter((e) => e.state !== "retrying").length;
  }

  /** Replace an entry with the patch applied; entries are never changed in
   * place, and when it first failed never changes. */
  private _update(
    hash: string,
    patch: Partial<Omit<PendingUpload, "firstFailedAt">>,
  ): void {
    const entry = this._entries.get(hash);

    if (entry) this._entries.set(hash, { ...entry, ...patch });
  }

  private _forget(entry: PendingUpload): void {
    this._entries.delete(entry.ref.hash);
    this._handles.delete(entry.ref.hash);
  }

  private _all(): PendingUpload[] {
    return Array.from(this._entries.values());
  }
}

/** The notice for a manual retry's result; null when there is nothing to
 * say. */
function _resultNotice({
  uploaded,
  failing,
  dropped,
}: RetryRun): string | null {
  const done = `MyBrain: ${plural(uploaded, "attachment")} uploaded`;

  if (uploaded + failing === 0) {
    return dropped > 0
      ? "MyBrain: nothing left to upload; the files were deleted or changed"
      : null;
  }

  if (failing === 0) return done;

  if (uploaded === 0) {
    return `MyBrain: ${plural(failing, "attachment")} still failing`;
  }

  return `${done}, ${failing} still failing`;
}

function _load(stored: string | null): PendingUpload[] {
  if (stored === null) return [];

  let parsed: unknown;

  try {
    parsed = JSON.parse(stored);
  } catch {
    parsed = null;
  }

  if (!Array.isArray(parsed)) {
    console.warn("MyBrain: saved failed uploads are damaged, starting empty");

    return [];
  }

  const entries = parsed.filter(_isPendingUpload);

  if (entries.length < parsed.length) {
    console.warn(
      `MyBrain: ${parsed.length - entries.length} damaged failed upload(s) left out`,
    );
  }

  return entries;
}

function _isPendingUpload(value: unknown): value is PendingUpload {
  if (typeof value !== "object" || value === null) return false;

  const e = value as Record<string, unknown>;
  const ref = e.ref as Record<string, unknown> | null | undefined;

  return (
    typeof ref === "object" &&
    ref !== null &&
    ["path", "ext", "hash"].every((k) => typeof ref[k] === "string") &&
    ["size", "mtime"].every((k) => typeof ref[k] === "number") &&
    typeof e.path === "string" &&
    typeof e.state === "string" &&
    STATES.has(e.state) &&
    typeof e.attempts === "number" &&
    typeof e.nextAttemptAt === "number" &&
    typeof e.firstFailedAt === "number" &&
    typeof e.lastError === "string"
  );
}
