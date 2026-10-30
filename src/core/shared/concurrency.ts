/** `fn` over every item with at most `concurrency` calls in flight; results
 * keep the input order. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);

  let next = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = next++;

      if (index >= items.length) return;

      results[index] = await fn(items[index]);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    worker,
  );

  await Promise.all(workers);

  return results;
}
