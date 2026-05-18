import { nextBackoffDelay } from "@/backoff";
import type { IngestEvent } from "@/types";

export type QueueState = {
  events: IngestEvent[];
  attemptCount: number;
  nextAttemptAt: number;
};

export const QUEUE_CAP = 5000;

const BACKOFF_SCHEDULE_MS = [1_000, 5_000, 30_000, 300_000, 3_600_000];

export function emptyState(): QueueState {
  return { events: [], attemptCount: 0, nextAttemptAt: 0 };
}

export function enqueue(state: QueueState, event: IngestEvent): QueueState {
  const filtered = state.events.filter(
    (existing) => !collides(existing, event),
  );

  const events = [...filtered, event];
  
  return {
    ...state,
    events: events.length > QUEUE_CAP ? events.slice(-QUEUE_CAP) : events,
    attemptCount: 0,
    nextAttemptAt: 0,
  };
}

export function nextBatch(
  state: QueueState,
  size: number,
  now: number,
): IngestEvent[] {
  if (state.events.length === 0) return [];
  if (state.nextAttemptAt > now) return [];
  return state.events.slice(0, size);
}

export function ackBatch(state: QueueState, count: number): QueueState {
  return {
    events: state.events.slice(count),
    attemptCount: 0,
    nextAttemptAt: 0,
  };
}

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

// Coalesce: a new upsert/delete supersedes any pending upsert/delete for
// the same path. Renames only dedupe exact-match renames — we intentionally
// don't cross-dedupe rename↔upsert/delete because the server needs the
// rename history to keep its index consistent. Caller (main.ts) handles
// `lastEnqueuedHashes` carry-over across a rename so a no-op modify after
// the rename is still suppressed correctly.
function collides(existing: IngestEvent, incoming: IngestEvent): boolean {
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
