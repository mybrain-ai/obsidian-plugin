import { Notice } from "obsidian";

import { nextBackoffDelay } from "@/backoff";
import { TOKEN_REJECTED_NOTICE } from "@/constants";
import { toWsUrl } from "@/url";

type ManifestRequestHandler = () => Promise<void> | void;
type ScopeChangedHandler = (folders: string[]) => Promise<void> | void;
type TokenRejectedHandler = () => void;
type ContentRequestedHandler = (requestId: string, paths: string[]) => void;
type OpenHandler = () => void;

interface ManagerOptions {
  endpoint: string;
  token: string;
  onManifestRequest: ManifestRequestHandler;
  onScopeChanged: ScopeChangedHandler;
  onTokenRejected: TokenRejectedHandler;
  onContentRequested: ContentRequestedHandler;
  onOpen: OpenHandler;
}

type WsServerMessage =
  | { type: "manifest_request" }
  | { type: "scope_changed"; folders: string[] }
  | { type: "content_requested"; requestId: string; paths: string[] };

export type WsClientMessage = {
  type: "hello";
  protocol: number;
  pluginVersion: string;
};

const RECONNECT_DELAYS_MS = [1_000, 5_000, 15_000, 30_000, 60_000];

// Close codes that mean "the server told us to stop trying": 4401 is our
// app-level token-rejected signal; 1008 policy violation and 4403 forbidden
// are wire-level "this client is not welcome." 1011 is "server error" but
// reconnecting tight would just storm the server during an incident.
const STOP_RECONNECT_CODES = new Set([1008, 1011, 4403]);

export class ObsidianWebSocketManager {
  private socket: WebSocket | null = null;
  private options: ManagerOptions | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: number | null = null;
  private stopped = false;

  start(options: ManagerOptions): void {
    this.stop();
    this.stopped = false;
    this.options = options;
    this.connect();
  }

  stop(): void {
    this.stopped = true;

    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.socket) {
      try {
        this.socket.close();
      } catch (e) {
        console.debug("MyBrain WS: close threw", e);
      }
      this.socket = null;
    }
  }

  /** Send a JSON message if the socket is open. */
  send(message: WsClientMessage): void {
    const ws = this.socket;

    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    try {
      ws.send(JSON.stringify(message));
    } catch (e) {
      console.warn("MyBrain WS: send failed", e);
    }
  }

  private connect(): void {
    const opts = this.options;

    if (!opts || this.stopped) return;

    const url = toWsUrl(opts.endpoint);

    if (!url) {
      console.warn("MyBrain WS: invalid endpoint", opts.endpoint);
      return;
    }

    if (!isHttpTokenChars(opts.token)) {
      console.warn(
        "MyBrain WS: token contains characters that are not valid in a WebSocket subprotocol; not connecting",
      );
      return;
    }

    try {
      const subprotocol = `bearer.${opts.token}`;
      const ws = new WebSocket(url, subprotocol);
      this.socket = ws;

      // A socket replaced by a restart can still fire late events; only the
      // current one may touch the manager's state.
      const current = () => this.socket === ws;

      ws.addEventListener("open", () => {
        if (!current()) return;
        this.reconnectAttempt = 0;
        console.debug("MyBrain WS: connected");
        try {
          this.options?.onOpen();
        } catch (e) {
          console.warn("MyBrain WS: open handler failed", e);
        }
      });
      ws.addEventListener("message", (event) => {
        if (current()) void this.handleMessage(event);
      });
      ws.addEventListener("close", (event) => {
        if (current()) this.handleClose(event);
      });
      ws.addEventListener("error", (event) => {
        console.warn("MyBrain WS: error", event);
      });
    } catch (e) {
      console.warn("MyBrain WS: failed to open", e);
      this.scheduleReconnect();
    }
  }

  private handleClose(event: CloseEvent): void {
    console.warn(
      `MyBrain WS: closed (code=${event.code} reason=${event.reason || "n/a"})`,
    );

    this.socket = null;

    if (event.code === 4401) {
      this.stopped = true;
      this.options?.onTokenRejected();
      new Notice(TOKEN_REJECTED_NOTICE);
      return;
    }

    if (STOP_RECONNECT_CODES.has(event.code)) {
      this.stopped = true;
      new Notice(
        `MyBrain: WebSocket rejected (code ${event.code}). Will retry on next plugin restart.`,
      );
      return;
    }

    this.scheduleReconnect();
  }

  private async handleMessage(event: MessageEvent): Promise<void> {
    if (!this.options) return;

    const parsed = parseServerMessage(event.data);

    if (parsed === null) {
      console.warn("MyBrain WS: ignored a message it could not read");
      return;
    }

    if (parsed.type === "manifest_request") {
      try {
        await this.options.onManifestRequest();
      } catch (e) {
        console.warn("MyBrain WS: manifest_request handler failed", e);
      }
      return;
    }

    if (parsed.type === "scope_changed") {
      try {
        await this.options.onScopeChanged(parsed.folders);
      } catch (e) {
        console.warn("MyBrain WS: scope_changed handler failed", e);
      }
      return;
    }

    try {
      this.options.onContentRequested(parsed.requestId, parsed.paths);
    } catch (e) {
      console.warn("MyBrain WS: content_requested handler failed", e);
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || !this.options) return;

    const delay = nextBackoffDelay(this.reconnectAttempt, RECONNECT_DELAYS_MS, {
      jitter: true,
    });

    this.reconnectAttempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}

export function parseServerMessage(data: unknown): WsServerMessage | null {
  if (typeof data !== "string") return null;

  let parsed: unknown;

  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || !("type" in parsed)) {
    return null;
  }

  if (parsed.type === "manifest_request") {
    return { type: "manifest_request" };
  }

  if (
    parsed.type === "scope_changed" &&
    "folders" in parsed &&
    Array.isArray(parsed.folders) &&
    parsed.folders.every((f) => typeof f === "string")
  ) {
    return { type: "scope_changed", folders: parsed.folders };
  }

  if (parsed.type === "content_requested") {
    return parseContentRequested(parsed);
  }

  return null;
}

// `{type: "content_requested", request_id, paths}`. `paths` items may also be
// `{path}` objects, so the server can add fields (e.g. the expected hash)
// without breaking this plugin.
function parseContentRequested(
  message: Record<string, unknown>,
): WsServerMessage | null {
  const requestId = message.request_id ?? message.requestId;

  if (typeof requestId !== "string" || requestId === "") return null;

  if (!Array.isArray(message.paths)) return null;

  const paths: string[] = [];

  for (const item of message.paths as unknown[]) {
    if (typeof item === "string") {
      paths.push(item);
    } else if (
      item &&
      typeof item === "object" &&
      typeof (item as { path?: unknown }).path === "string"
    ) {
      paths.push((item as { path: string }).path);
    }
  }

  if (paths.length === 0) return null;

  return { type: "content_requested", requestId, paths };
}

function isHttpTokenChars(value: string): boolean {
  return /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(value);
}
