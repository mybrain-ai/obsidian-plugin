/** Parse an HTTPS endpoint into a `URL`, returning `null` if the value is
 * malformed, uses a non-HTTPS protocol, or has no hostname. The trailing
 * `/` is normalized off so concatenation with `/foo` paths produces a
 * single slash. */
export function parseHttpsEndpoint(value: string): URL | null {
  try {
    const url = new URL(value);

    if (url.protocol !== "https:") return null;
    
    if (!url.hostname) return null;
    
    url.pathname = url.pathname.replace(/\/$/, "");
    
    return url;
  } catch {
    return null;
  }
}

/** Derive the WebSocket URL for an endpoint by switching to `wss://` and
 * appending `/ws`. Accepts both `https:` and `http:` (the latter only for
 * local dev). Returns `null` on any other protocol or parse failure. */
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
