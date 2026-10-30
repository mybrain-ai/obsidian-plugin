/** The server answered 401: the saved token is no longer valid, so syncing
 * stops until the user pastes a new one. */
export class TokenRejectedError extends Error {
  constructor() {
    super("token rejected");
    this.name = "TokenRejectedError";
  }
}

/** Non-2xx response other than 401. Carries the status so callers can tell a
 * request the server refused (4xx) from one worth retrying. */
export class HttpError extends Error {
  constructor(readonly status: number) {
    super(`MyBrain request failed (status ${status})`);
    this.name = "HttpError";
  }
}

/** A vault file could not be read: a local problem, not the server's. */
export class FileReadError extends Error {
  constructor(cause: unknown) {
    super("couldn't read the file", { cause });
    this.name = "FileReadError";
  }
}

/** The server refused the request body: a server that predates protocol 2
 * answers a protocol 2 manifest or event batch with a validation error. */
export function isProtocolRejection(e: unknown): boolean {
  return e instanceof HttpError && (e.status === 400 || e.status === 422);
}

/** A 4xx answer: the server refused the request, so sending it again won't
 * help. */
export function isClientError(e: unknown): e is HttpError {
  return e instanceof HttpError && e.status >= 400 && e.status < 500;
}

/** A failed upload in plain words, for the list of waiting uploads. */
export function describeUploadError(e: unknown): string {
  if (e instanceof TokenRejectedError) return "token rejected";

  if (e instanceof FileReadError) return e.message;

  if (!(e instanceof HttpError)) return "couldn't reach MyBrain";

  if (e.status === 408 || e.status === 429) return "MyBrain is busy";

  if (e.status === 409) {
    return "MyBrain refused it (connector not active, or another vault)";
  }

  if (e.status === 413) return "file too large for MyBrain";

  if (e.status >= 500) return "MyBrain server error";

  return "MyBrain refused the file";
}

/** A 4xx answer the same request would get again later; a timeout (408) or a
 * rate limit (429) is worth retrying. */
export function isLastingRefusal(e: unknown): boolean {
  return isClientError(e) && e.status !== 408 && e.status !== 429;
}
