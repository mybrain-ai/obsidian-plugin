import { TokenRejectedError } from "@/core/errors";
import type { SyncDeps } from "@/core/ports";
import { errorMessage } from "@/core/shared/text";
import { canSync } from "@/core/sync/settings";

/** Pings the server and describes the token's state for the settings UI. */
export async function checkConnection(
  deps: Pick<SyncDeps, "api" | "auth" | "settings">,
): Promise<string> {
  if (!canSync(deps.settings())) {
    return "endpoint or token not set";
  }

  try {
    const body = await deps.api.ping();

    deps.auth.rejected = false;

    if (body === undefined) return "unexpected server reply";

    return body.status === "active"
      ? "token active"
      : "token pending — POST to activate";
  } catch (e) {
    if (e instanceof TokenRejectedError) return "token rejected";

    return errorMessage(e);
  }
}
