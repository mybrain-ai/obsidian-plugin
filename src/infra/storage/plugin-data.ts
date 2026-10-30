import type { PluginDataPort } from "@/core/ports";
import { emptyState, isQueueState } from "@/core/sync/queue";
import { defaultSettings } from "@/core/sync/settings";
import type { QueueState, StoredData } from "@/core/sync/types";

/** `data.json` through the plugin's `loadData`/`saveData`, with defaults
 * filled in for a fresh install or a missing key. */
export class PluginDataStore implements PluginDataPort {
  constructor(
    private readonly _loadData: () => Promise<unknown>,
    private readonly _saveData: (data: StoredData) => Promise<void>,
  ) {}

  /** The stored settings over the defaults, and the stored queue or an empty
   * one when it is missing or damaged. */
  async load(): Promise<StoredData> {
    const data = (await this._loadData()) as Partial<StoredData> | null;

    return {
      settings: { ...defaultSettings(), ...data?.settings },
      queue: _loadQueue(data?.queue),
    };
  }

  /** Write the whole of `data.json`. */
  save(data: StoredData): Promise<void> {
    return this._saveData(data);
  }
}

/** The stored queue, or an empty one when it is missing or damaged; a damaged
 * queue's deletes and renames are lost, its edits come back at startup. */
function _loadQueue(stored: unknown): QueueState {
  if (stored === undefined || stored === null) return emptyState();

  if (isQueueState(stored)) return stored;

  console.warn("MyBrain: stored edit queue is damaged, starting empty");

  return emptyState();
}
