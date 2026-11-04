/** The values without repeats, in first-seen order. */
export function uniq<T>(values: readonly T[]): T[] {
  return Array.from(new Set(values));
}
