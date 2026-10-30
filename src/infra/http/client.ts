import { type RequestUrlResponse, requestUrl } from "obsidian";

import { HttpError, TokenRejectedError } from "@/core/errors";
import { buildMultipart } from "@/infra/http/multipart";
import type {
  Connection,
  MultipartRequest,
  RequestOptions,
} from "@/infra/http/types";

/** POSTs a JSON body and parses the JSON reply; undefined when the reply has
 * an empty body. */
export async function postJson<T>(
  connection: Connection,
  path: string,
  body: unknown,
): Promise<T | undefined> {
  const response = await _request(connection, "POST", path, {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  return _parseJsonBody<T>(response);
}

/** GETs and parses the JSON reply; undefined when the reply has an empty
 * body. */
export async function getJson<T>(
  connection: Connection,
  path: string,
): Promise<T | undefined> {
  const response = await _request(connection, "GET", path);

  return _parseJsonBody<T>(response);
}

/** Sends form fields plus one file as `multipart/form-data`. */
export async function postMultipart(args: MultipartRequest): Promise<void> {
  const boundary = `----mybrain-${crypto.randomUUID()}`;
  const body = buildMultipart(boundary, args.fields, args.file);

  await _request(args.connection, "POST", args.path, {
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body,
  });
}

async function _request(
  connection: Connection,
  method: "GET" | "POST",
  path: string,
  init: RequestOptions = {},
): Promise<RequestUrlResponse> {
  const response = await requestUrl({
    url: `${connection.endpoint}${path}`,
    method,
    headers: {
      ...init.headers,
      "X-MyBrain-Device-Id": connection.deviceId,
      "X-MyBrain-Plugin-Version": connection.pluginVersion,
      Authorization: `Bearer ${connection.token}`,
    },
    body: init.body,
    throw: false,
  });

  _guard(response);

  return response;
}

/** The one place an HTTP status becomes a core error. */
function _guard(response: RequestUrlResponse): void {
  if (response.status === 401) {
    throw new TokenRejectedError();
  }

  if (response.status < 200 || response.status >= 300) {
    console.warn(`MyBrain ${response.status}: ${response.text}`);
    throw new HttpError(response.status);
  }
}

function _parseJsonBody<T>(response: RequestUrlResponse): T | undefined {
  if (!response.text) return undefined;

  return response.json as T;
}
