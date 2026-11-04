import { TokenRejectedError } from "@/core/errors";
import type { AttachmentFile, MyBrainApi } from "@/core/ports";
import type {
  ContentBody,
  IngestBody,
  IngestResponse,
  ManifestV1Body,
  ManifestV2Body,
  PingReply,
} from "@/core/sync/types";
import type { LatestPluginRelease } from "@/core/update/types";
import { getJson, postJson, postMultipart } from "@/infra/http/client";
import type { Connection } from "@/infra/http/types";

/** The MyBrain API over Obsidian's `requestUrl`, with the connection read
 * fresh for every request so a new token applies at once. */
export class HttpMyBrainApi implements MyBrainApi {
  constructor(private readonly _connection: () => Connection) {}

  /** `POST /manifest`, either protocol. */
  async postManifest(
    body: ManifestV1Body | ManifestV2Body,
  ): Promise<IngestResponse | undefined> {
    return await this._postIngestResponse("/manifest", body);
  }

  /** `POST /ingest`: a batch of edit events. */
  async postIngest(body: IngestBody): Promise<IngestResponse | undefined> {
    return await this._postIngestResponse("/ingest", body);
  }

  /** `POST /content`: the notes the server asked for. */
  async postContent(body: ContentBody): Promise<IngestResponse | undefined> {
    return await this._postIngestResponse("/content", body);
  }

  /** `POST /attachments`: one attachment file with its fields. */
  async uploadAttachment(
    fields: Record<string, string>,
    file: AttachmentFile,
  ): Promise<void> {
    await postMultipart({
      connection: this._connection(),
      path: "/attachments",
      fields,
      file,
    });
  }

  /** `GET /ping`: the token's state. */
  async ping(): Promise<PingReply | undefined> {
    return await getJson<PingReply>(this._connection(), "/ping");
  }

  /** `GET /latest-release`; null on an empty reply or on a failure, which is
   * logged. A rejected token throws. */
  async latestRelease(): Promise<LatestPluginRelease | null> {
    try {
      return (
        (await getJson<LatestPluginRelease | null>(
          this._connection(),
          "/latest-release",
        )) ?? null
      );
    } catch (e) {
      if (e instanceof TokenRejectedError) throw e;

      console.warn("MyBrain: update check failed", e);

      return null;
    }
  }

  private async _postIngestResponse(
    path: string,
    body: unknown,
  ): Promise<IngestResponse | undefined> {
    return await postJson<IngestResponse>(this._connection(), path, body);
  }
}
