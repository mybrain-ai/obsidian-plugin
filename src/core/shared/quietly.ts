/** Run a side step whose failure must not stop the caller; it is logged. */
export function quietly(what: string, fn: () => void): void {
  try {
    fn();
  } catch (e) {
    console.error(`MyBrain: failed to ${what}`, e);
  }
}

/** Await work whose failure must not reach the caller; it is logged. */
export async function quietlyAsync(
  what: string,
  work: Promise<unknown>,
): Promise<void> {
  try {
    await work;
  } catch (e) {
    console.error(`MyBrain: failed to ${what}`, e);
  }
}
