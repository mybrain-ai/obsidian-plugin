const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/** `https:` always, `http:` only for loopback hosts (local dev). A path's
 * trailing `/` is dropped; a bare origin keeps its `/`. */
export function parseHttpsEndpoint(value: string): URL | null {
  try {
    const url = new URL(value);

    if (!url.hostname) return null;

    const isLocalDev =
      url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);

    if (url.protocol !== "https:" && !isLocalDev) return null;

    url.pathname = url.pathname.replace(/\/$/, "");

    return url;
  } catch {
    return null;
  }
}
