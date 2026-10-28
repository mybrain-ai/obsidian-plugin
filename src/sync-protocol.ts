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

/** Push the manifest as protocol 2 (metadata only). A server that predates
 * protocol 2 refuses it with a validation error; then, when `fallbackToV1` is
 * set, the protocol 1 manifest (with note text) goes out instead, so a vault is
 * never left unsynced. Without the fallback the call only finds out which
 * protocol the server speaks. Other errors propagate. */
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

export function isLegacyUpsert(event: IngestEvent): event is UpsertEvent {
  return event.op === "upsert" && "content" in event;
}

/** Turn queued events into the shape `protocol` expects. Upserts are rebuilt
 * from the vault when the queued shape doesn't match (a protocol 1 upsert left
 * in a queue saved by 1.0.x must not send its text to a protocol 2 server; a
 * protocol 2 upsert needs the text for a protocol 1 server). A note that's gone
 * by now is dropped: its delete or rename event is already in the queue. */
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
    if (event.op !== "upsert") {
      out.push(event);
      continue;
    }

    const legacy = isLegacyUpsert(event);

    if (protocol === 1 && legacy) {
      out.push(event);
      continue;
    }

    if (protocol === 2 && !legacy) {
      out.push(event);
      continue;
    }

    const rebuilt =
      protocol === 1 ? await rebuild.v1(event.path) : await rebuild.v2(event.path);

    if (rebuilt) out.push(rebuilt);
  }

  return out;
}
