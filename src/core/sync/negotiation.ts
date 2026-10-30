import { isProtocolRejection } from "@/core/errors";
import type {
  IngestEvent,
  IngestEventV1,
  IngestEventV2,
  ManifestOutcome,
  ManifestSenders,
  ServerProtocol,
  UpsertEvent,
  UpsertRebuilders,
} from "@/core/sync/types";

/** A server that predates protocol 2 refuses with 400/422; then protocol 1
 * goes out if `fallbackToV1` is set, else nothing (a probe). */
export async function pushNegotiatedManifest(
  deps: ManifestSenders,
): Promise<ManifestOutcome> {
  try {
    await deps.sendV2();

    return { protocol: 2, sent: true };
  } catch (e) {
    if (!isProtocolRejection(e)) throw e;
  }

  deps.log("MyBrain: server refused protocol 2, using protocol 1");

  if (!deps.fallbackToV1) return { protocol: 1, sent: false };

  await deps.sendV1();

  return { protocol: 1, sent: true };
}

/** An upsert of the other shape (e.g. one with text, saved by an older
 * version) is rebuilt from the vault, or dropped when the note is gone. */
export function materializeEvents(
  events: readonly IngestEvent[],
  protocol: 1,
  rebuild: UpsertRebuilders,
): Promise<IngestEventV1[]>;
export function materializeEvents(
  events: readonly IngestEvent[],
  protocol: 2,
  rebuild: UpsertRebuilders,
): Promise<IngestEventV2[]>;
export async function materializeEvents(
  events: readonly IngestEvent[],
  protocol: ServerProtocol,
  rebuild: UpsertRebuilders,
): Promise<IngestEvent[]> {
  const out: IngestEvent[] = [];

  for (const event of events) {
    // Protocol 1 upserts carry the text; protocol 2 upserts never do.
    if (event.op !== "upsert" || _isLegacyUpsert(event) === (protocol === 1)) {
      out.push(event);
      continue;
    }

    const rebuilt =
      protocol === 1
        ? await rebuild.v1(event.path)
        : await rebuild.v2(event.path);

    if (rebuilt) out.push(rebuilt);
  }

  return out;
}

function _isLegacyUpsert(event: IngestEvent): event is UpsertEvent {
  return event.op === "upsert" && "content" in event;
}
