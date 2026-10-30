/** A stand-in for the global WebSocket that records every socket opened. */
export class FakeSocket {
  static readonly OPEN = 1;
  static all: FakeSocket[] = [];
  readyState = 0;
  closed = false;
  sent: string[] = [];
  private readonly _listeners = new Map<string, Array<(e: unknown) => void>>();

  constructor(
    readonly url: string,
    readonly protocol: string,
  ) {
    FakeSocket.all.push(this);
  }

  /** Register a listener, as the manager does for each event. */
  addEventListener(type: string, fn: (e: unknown) => void): void {
    this._listeners.set(type, [...(this._listeners.get(type) ?? []), fn]);
  }

  /** Record a sent frame. */
  send(data: string): void {
    this.sent.push(data);
  }

  /** Mark the socket closed; no close event fires until the test emits one. */
  close(): void {
    this.closed = true;
  }

  /** Fire an event at the listeners; `open` also marks the socket open. */
  emit(type: string, event: unknown = {}): void {
    if (type === "open") this.readyState = FakeSocket.OPEN;

    for (const fn of this._listeners.get(type) ?? []) fn(event);
  }
}

/** Install the fake as the global WebSocket and forget earlier sockets. */
export function installFakeSocket(): void {
  FakeSocket.all = [];
  (globalThis as Record<string, unknown>).WebSocket = FakeSocket;
}
