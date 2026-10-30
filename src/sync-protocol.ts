import { isProtocolRejection } from "@/network";
import type {
  IngestEvent,
  ServerProtocol,
  UpsertEvent,
  UpsertEventV2,
} from "@/types";

export type ManifestOutcome = {
  protocol: ServerProtocol;
  sent: boolean;
};

/** Push the manifest as protocol 2. A server that predates it refuses with
 * 400/422; then the protocol 1 manifest (with note text) goes out when
 * `fallbackToV1` is set, or nothing does (a probe). Other errors propagate. */
export async function pushNegotiatedManifest(deps: {
  sendV2(): Promise<void>;
  sendV1(): Promise<void>;
  fallbackToV1: boolean;
  log(message: string): void;
}): Promise<ManifestOutcome> {
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

/** Queued events in the shape `protocol` expects: an upsert of the other shape
 * (e.g. one with text, saved by 1.0.x) is rebuilt from the vault, or dropped
 * when the note is gone (its delete or rename is already queued). */
export async function materializeEvents(
  events: readonly IngestEvent[],
  protocol: ServerProtocol,
  rebuild: {
    v1(path: string): Promise<UpsertEvent | null>;
    v2(path: string): Promise<UpsertEventV2 | null>;
  },
): Promise<IngestEvent[]> {
  const out: IngestEvent[] = [];

  for (const event of events) {
    // Protocol 1 upserts carry the text; protocol 2 upserts never do.
    if (event.op !== "upsert" || isLegacyUpsert(event) === (protocol === 1)) {
      out.push(event);
      continue;
    }

    const rebuilt =
      protocol === 1 ? await rebuild.v1(event.path) : await rebuild.v2(event.path);

    if (rebuilt) out.push(rebuilt);
  }

  return out;
}

function isLegacyUpsert(event: IngestEvent): event is UpsertEvent {
  return event.op === "upsert" && "content" in event;
}
