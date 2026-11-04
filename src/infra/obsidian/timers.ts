import type { Timers } from "@/core/ports";

/** The timers port over `window.setTimeout`. */
export class WindowTimers implements Timers {
  /** Run `fn` once after `ms`; returns the id to cancel it. */
  set(fn: () => void, ms: number): number {
    return window.setTimeout(fn, ms);
  }

  /** Cancel a timer that has not fired yet. */
  clear(id: number): void {
    window.clearTimeout(id);
  }
}
