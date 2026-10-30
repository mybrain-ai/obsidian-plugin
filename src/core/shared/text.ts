/** `1 attachment`, `3 attachments`: the count with the noun in the right
 * number. */
export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** The message of a thrown value, whether or not it is an `Error`. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
