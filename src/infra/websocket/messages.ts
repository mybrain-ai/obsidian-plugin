import type { WsServerMessage } from "@/core/sync/types";
import type { PathItem } from "@/infra/websocket/types";

/** A server message the plugin understands, or null for anything else. */
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
    return _parseContentRequested(parsed);
  }

  return null;
}

/** The id comes as `request_id` or `requestId`; `paths` items may be `{path}`
 * objects, so the server can add fields without breaking this plugin. */
function _parseContentRequested(
  message: Record<string, unknown>,
): WsServerMessage | null {
  const requestId = message.request_id ?? message.requestId;

  if (typeof requestId !== "string" || requestId === "") return null;

  if (!Array.isArray(message.paths)) return null;

  const paths: string[] = [];

  for (const item of message.paths as unknown[]) {
    const path =
      item && typeof item === "object" ? (item as PathItem).path : item;

    if (typeof path === "string") paths.push(path);
  }

  if (paths.length === 0) return null;

  return { type: "content_requested", requestId, paths };
}
