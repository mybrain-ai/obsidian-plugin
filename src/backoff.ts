/** Pick the delay for the n-th retry attempt against a fixed schedule.
 * `attempt` is 0-based; values past the schedule's end clamp to its tail.
 * With `jitter`, returns `base + rand(0, base/2)` so concurrent clients
 * don't fire in lockstep after a shared outage. */
export function nextBackoffDelay(
  attempt: number,
  schedule: readonly number[],
  options: { jitter?: boolean } = {},
): number {
  const index = Math.min(Math.max(attempt, 0), schedule.length - 1);

  const base = schedule[index];

  if (!options.jitter) return base;

  return base + Math.floor(randomUnitFloat() * (base / 2));
}

function randomUnitFloat(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 0x100000000;
}
