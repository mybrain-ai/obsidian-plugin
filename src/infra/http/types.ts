import type { AttachmentFile } from "@/core/ports";

/** Form fields plus one file, sent as `multipart/form-data`. */
export type MultipartRequest = {
  connection: Connection;
  path: string;
  fields: Record<string, string>;
  file: AttachmentFile;
};

/** Extra headers and a body for a request. */
export type RequestOptions = {
  headers?: Record<string, string>;
  body?: string | ArrayBuffer;
};

/** Where and as whom a request goes; read fresh for every request. */
export type Connection = {
  endpoint: string;
  token: string;
  deviceId: string;
  pluginVersion: string;
};
