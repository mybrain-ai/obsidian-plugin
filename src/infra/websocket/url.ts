/** `https:` maps to `wss:` and `http:` (local dev) to `ws:`; `/ws` is
 * appended. Any other protocol gives `null`. */
export function toWsUrl(endpoint: string): string | null {
  try {
    const url = new URL(endpoint);

    url.pathname = url.pathname.replace(/\/$/, "") + "/ws";

    if (url.protocol === "https:") {
      url.protocol = "wss:";
    } else if (url.protocol === "http:") {
      url.protocol = "ws:";
    } else {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}
