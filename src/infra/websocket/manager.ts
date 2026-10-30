import type {
  ChannelHandlers,
  Notifier,
  ServerChannel,
  Timers,
} from "@/core/ports";
import { nextBackoffDelay } from "@/core/shared/backoff";
import type { WsClientMessage } from "@/core/sync/types";
import { parseServerMessage } from "@/infra/websocket/messages";
import type { ChannelTarget } from "@/infra/websocket/types";
import { toWsUrl } from "@/infra/websocket/url";

const RECONNECT_DELAYS_MS = [1_000, 5_000, 15_000, 30_000, 60_000];

// The server said stop (policy violation, forbidden); 1011 is included so a
// tight reconnect loop can't storm it during an incident.
const STOP_RECONNECT_CODES = new Set([1008, 1011, 4403]);

/** The server channel over a WebSocket that reconnects with backoff until the
 * server says stop or the token is rejected. */
export class ObsidianWebSocketManager implements ServerChannel {
  private _socket: WebSocket | null = null;
  private _options: ChannelHandlers | null = null;
  private _target: ChannelTarget | null = null;
  private _reconnectAttempt = 0;
  private _reconnectTimer: number | null = null;
  private _stopped = false;

  constructor(
    private readonly _connection: () => ChannelTarget,
    private readonly _notifier: Notifier,
    private readonly _timers: Timers,
  ) {}

  /** Connect with the current endpoint and token, closing any open socket
   * first. */
  start(options: ChannelHandlers): void {
    this.stop();
    this._stopped = false;
    this._options = options;
    this._target = this._connection();
    this._connect();
  }

  /** Close the socket and cancel any pending reconnect. */
  stop(): void {
    this._stopped = true;

    if (this._reconnectTimer !== null) {
      this._timers.clear(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    if (this._socket) {
      try {
        this._socket.close();
      } catch (e) {
        console.debug("MyBrain WS: close threw", e);
      }

      this._socket = null;
    }
  }

  /** Send a message when the socket is open; otherwise drop it. */
  send(message: WsClientMessage): void {
    const ws = this._socket;

    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    try {
      ws.send(JSON.stringify(message));
    } catch (e) {
      console.warn("MyBrain WS: send failed", e);
    }
  }

  private _connect(): void {
    if (!this._options || !this._target || this._stopped) return;

    const { endpoint, token } = this._target;
    const url = toWsUrl(endpoint);

    if (!url) {
      console.warn("MyBrain WS: invalid endpoint", endpoint);

      return;
    }

    if (!_isHttpTokenChars(token)) {
      console.warn(
        "MyBrain WS: token contains characters that are not valid in a WebSocket subprotocol; not connecting",
      );

      return;
    }

    try {
      const subprotocol = `bearer.${token}`;
      const ws = new WebSocket(url, subprotocol);

      this._socket = ws;

      // A socket replaced by a restart can still fire late events; only the
      // current one may touch the manager's state.
      const current = (): boolean => this._socket === ws;

      ws.addEventListener("open", () => {
        if (!current()) return;

        this._reconnectAttempt = 0;
        console.debug("MyBrain WS: connected");

        try {
          this._options?.onOpen();
        } catch (e) {
          console.warn("MyBrain WS: open handler failed", e);
        }
      });
      ws.addEventListener("message", (event) => {
        if (current()) void this._handleMessage(event);
      });
      ws.addEventListener("close", (event) => {
        if (current()) this._handleClose(event);
      });
      ws.addEventListener("error", (event) => {
        console.warn("MyBrain WS: error", event);
      });
    } catch (e) {
      console.warn("MyBrain WS: failed to open", e);
      this._scheduleReconnect();
    }
  }

  private async _handleMessage(event: MessageEvent): Promise<void> {
    if (!this._options) return;

    const parsed = parseServerMessage(event.data);

    if (parsed === null) {
      console.warn("MyBrain WS: ignored a message it could not read");

      return;
    }

    try {
      if (parsed.type === "manifest_request") {
        await this._options.onManifestRequest();
      } else if (parsed.type === "scope_changed") {
        await this._options.onScopeChanged(parsed.folders);
      } else {
        this._options.onContentRequested(parsed.requestId, parsed.paths);
      }
    } catch (e) {
      console.warn(`MyBrain WS: ${parsed.type} handler failed`, e);
    }
  }

  private _handleClose(event: CloseEvent): void {
    console.warn(
      `MyBrain WS: closed (code=${event.code} reason=${event.reason || "n/a"})`,
    );

    this._socket = null;

    if (event.code === 4401) {
      this._stopped = true;
      this._options?.onTokenRejected();

      return;
    }

    if (STOP_RECONNECT_CODES.has(event.code)) {
      this._stopped = true;
      this._notifier.notice(
        `MyBrain: WebSocket rejected (code ${event.code}). Will retry on next plugin restart.`,
      );

      return;
    }

    this._scheduleReconnect();
  }

  private _scheduleReconnect(): void {
    if (this._stopped || !this._options) return;

    const delay = nextBackoffDelay(
      this._reconnectAttempt,
      RECONNECT_DELAYS_MS,
      {
        jitter: true,
      },
    );

    this._reconnectAttempt += 1;
    this._reconnectTimer = this._timers.set(() => {
      this._reconnectTimer = null;
      this._connect();
    }, delay);
  }
}

function _isHttpTokenChars(value: string): boolean {
  return /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(value);
}
