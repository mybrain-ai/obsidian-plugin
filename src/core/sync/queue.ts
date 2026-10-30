import { nextBackoffDelay } from "@/core/shared/backoff";
import type { IngestEvent, QueueState } from "@/core/sync/types";

export const QUEUE_CAP = 5000;

const BACKOFF_SCHEDULE_MS = [1_000, 5_000, 30_000, 300_000, 3_600_000];

/** The queue of a fresh install: no events, no backoff. */
export function emptyState(): QueueState {
  return { events: [], attemptCount: 0, nextAttemptAt: 0 };
}

/** Whether a stored value has the shape the queue code relies on. */
export function isQueueState(value: unknown): value is QueueState {
  if (typeof value !== "object" || value === null) return false;

  const { events, attemptCount, nextAttemptAt } = value as Partial<QueueState>;

  return (
    Array.isArray(events) &&
    events.every((e) => typeof e === "object" && e !== null) &&
    typeof attemptCount === "number" &&
    typeof nextAttemptAt === "number"
  );
}

/** Add an event, dropping the queued ones it supersedes and the oldest past
 * `QUEUE_CAP`; a new event also resets the backoff. */
export function enqueue(state: QueueState, event: IngestEvent): QueueState {
  const filtered = state.events.filter(
    (existing) => !_collides(existing, event),
  );

  const events = [...filtered, event];

  return {
    ...state,
    events: events.length > QUEUE_CAP ? events.slice(-QUEUE_CAP) : events,
    attemptCount: 0,
    nextAttemptAt: 0,
  };
}

/** The next events to send, or none while a backoff is pending. */
export function nextBatch(
  state: QueueState,
  size: number,
  now: number,
): IngestEvent[] {
  if (state.events.length === 0) return [];

  if (state.nextAttemptAt > now) return [];

  return state.events.slice(0, size);
}

/** Drop the events the server accepted and clear the backoff. */
export function ackBatch(state: QueueState, count: number): QueueState {
  return {
    events: state.events.slice(count),
    attemptCount: 0,
    nextAttemptAt: 0,
  };
}

/** Keep the events and push the next attempt out on the backoff schedule. */
export function failBatch(state: QueueState, now: number): QueueState {
  const attemptCount = state.attemptCount + 1;
  const delay = nextBackoffDelay(attemptCount - 1, BACKOFF_SCHEDULE_MS, {
    jitter: true,
  });

  return {
    ...state,
    attemptCount,
    nextAttemptAt: now + delay,
  };
}

/** A new upsert/delete supersedes pending ones for the same path. Renames are
 * never merged with them: the server needs the rename history. */
function _collides(existing: IngestEvent, incoming: IngestEvent): boolean {
  if (incoming.op === "rename") {
    return (
      existing.op === "rename" &&
      existing.oldPath === incoming.oldPath &&
      existing.newPath === incoming.newPath
    );
  }

  return (
    (existing.op === "upsert" || existing.op === "delete") &&
    existing.path === incoming.path
  );
}
