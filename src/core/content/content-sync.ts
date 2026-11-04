import { ContentRequestQueue } from "@/core/content/content-queue";
import { readRequestedNote } from "@/core/content/read-requested-note";
import type { SyncDeps } from "@/core/ports";
import { contentBody } from "@/core/sync/payloads";
import {
  isInScope,
  markTokenRejected,
  requestEnvelope,
  uploadAttachments,
} from "@/core/sync/sync-steps";

/** Notes the server asked for (`content_requested`): the only path by which
 * note text leaves the vault under protocol 2. */
export function createContentQueue(deps: SyncDeps): ContentRequestQueue {
  return new ContentRequestQueue({
    read: (path) =>
      readRequestedNote(deps.vault, path, (p) => isInScope(deps, p)),
    send: (notes, missing) =>
      deps.api.postContent(contentBody(requestEnvelope(deps), notes, missing)),
    uploadAttachments: async (hashes, resolved) => {
      deps.attachments.remember(resolved);

      await uploadAttachments(deps, hashes);
    },
    onTokenRejected: () => markTokenRejected(deps),
    timers: deps.timers,
  });
}
