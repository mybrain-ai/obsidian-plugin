/** A counter, not a flag, so overlapping pushes don't flip the UI to idle
 * while another is still running. */
export class SyncState {
  private _active = 0;
  private readonly _listeners = new Set<() => void>();

  /** Called when syncing starts or stops; returns the unsubscribe. */
  onChange(listener: () => void): () => void {
    this._listeners.add(listener);

    return () => this._listeners.delete(listener);
  }

  /** Mark a push as started; listeners hear about the first one. */
  begin(): void {
    this._active += 1;

    if (this._active === 1) this._notify();
  }

  /** Mark a push as done; listeners hear about the last one. */
  end(): void {
    this._active = Math.max(0, this._active - 1);

    if (this._active === 0) this._notify();
  }

  /** Whether any push is running, for the settings UI. */
  isSyncing(): boolean {
    return this._active > 0;
  }

  private _notify(): void {
    for (const listener of this._listeners) {
      try {
        listener();
      } catch (e) {
        console.warn("MyBrain: sync-state listener failed", e);
      }
    }
  }
}
