import { TOKEN_REJECTED_NOTICE } from "@/core/constants";
import { TokenRejectedError } from "@/core/errors";
import type { SyncDeps } from "@/core/ports";
import { envelope } from "@/core/sync/payloads";
import { isPathInScope } from "@/core/sync/scope";
import type {
  IngestResponse,
  RequestEnvelope,
  UploadResult,
} from "@/core/sync/types";

/** Whether a path is inside the folders the user chose to sync, under the
 * live settings. */
export function isInScope(deps: SyncDeps, path: string): boolean {
  return isPathInScope(
    path,
    deps.settings().inScopeFolders,
    deps.vault.configDir(),
  );
}

/** The vault id, name and client time every request body starts with. */
export function requestEnvelope(deps: SyncDeps): RequestEnvelope {
  const settings = deps.settings();

  return envelope(
    settings.vaultId,
    settings.vaultName || deps.vault.vaultName(),
    new Date(deps.clock()),
  );
}

/** Flags the token as rejected, then tells the user, once until the flag is
 * cleared. */
export function markTokenRejected(
  deps: Pick<SyncDeps, "auth" | "notifier">,
): void {
  if (deps.auth.rejected) return;

  deps.auth.rejected = true;
  deps.notifier.notice(TOKEN_REJECTED_NOTICE);
}

/** Upload the attachments a response asked for; nothing is called when it
 * asked for none. */
export async function uploadNeeded(
  deps: SyncDeps,
  response: IngestResponse | undefined,
): Promise<void> {
  const needed = response?.attachmentsNeeded ?? [];

  if (needed.length > 0) await uploadAttachments(deps, needed);
}

/** Upload the attachments the server asked for, among those remembered; the
 * ones that fail go to the retry list. */
export async function uploadAttachments(
  deps: SyncDeps,
  hashes: string[],
): Promise<void> {
  // Callers have already stored the server's answer; a throw here must not
  // reach them.
  try {
    _handleUploadResult(deps, await deps.attachments.upload(hashes));
  } catch (e) {
    console.error("MyBrain: attachment upload failed unexpectedly", e);
  }
}

function _handleUploadResult(deps: SyncDeps, result: UploadResult): void {
  if (result.skipped.length > 0) {
    console.warn(
      "MyBrain: attachments asked for but not uploaded (unknown here, or uploads off on this device)",
      result.skipped,
    );
  }

  if (result.failed.length === 0) return;

  let tokenRejected = false;

  for (const { error } of result.failed) {
    console.warn("MyBrain: attachment upload failed", error);
    tokenRejected ||= error instanceof TokenRejectedError;
  }

  if (tokenRejected) markTokenRejected(deps);

  deps.failedUploads.record(result.failed);
}
