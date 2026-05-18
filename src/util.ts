export function uniq<T>(values: readonly T[]): T[] {
  return Array.from(new Set(values));
}

export function extractLinks(items: { link: string }[] | undefined): string[] {
  if (!items) return [];
  return uniq(items.map((i) => i.link));
}
