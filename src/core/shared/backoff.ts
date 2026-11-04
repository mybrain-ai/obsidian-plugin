import type { BackoffOptions } from "@/core/shared/types";

/** `attempt` is 0-based and clamps to the schedule's tail. `jitter` adds up to
 * half the base so clients don't retry in lockstep after a shared outage. */
export function nextBackoffDelay(
  attempt: number,
  schedule: readonly number[],
  options: BackoffOptions = {},
): number {
  const index = Math.min(Math.max(attempt, 0), schedule.length - 1);

  const base = schedule[index];

  if (!options.jitter) return base;

  return base + Math.floor(_randomUnitFloat() * (base / 2));
}

function _randomUnitFloat(): number {
  const buf = new Uint32Array(1);

  crypto.getRandomValues(buf);

  return buf[0] / 0x100000000;
}
