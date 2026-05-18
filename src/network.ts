import { requestUrl, type RequestUrlResponse } from "obsidian";

export type Auth = { endpoint: string; token: string };

export class TokenRejectedError extends Error {
  constructor() {
    super("token rejected");
    this.name = "TokenRejectedError";
  }
}

type MultipartFile = { name: string; bytes: ArrayBuffer; contentType: string };

export async function postJson<T>(
  auth: Auth,
  path: string,
  body: unknown,
): Promise<T> {
  const response = await request(auth, "POST", path, {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.json as T;
}

export async function getJson<T>(auth: Auth, path: string): Promise<T> {
  const response = await request(auth, "GET", path);
  return response.json as T;
}

export async function postMultipart(args: {
  auth: Auth;
  path: string;
  fields: Record<string, string>;
  file: MultipartFile;
}): Promise<void> {
  const boundary = `----mybrain-${crypto.randomUUID()}`;
  const body = buildMultipart(boundary, args.fields, args.file);
  await request(args.auth, "POST", args.path, {
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body,
  });
}

async function request(
  auth: Auth,
  method: "GET" | "POST",
  path: string,
  init: { headers?: Record<string, string>; body?: string | ArrayBuffer } = {},
): Promise<RequestUrlResponse> {
  const response = await requestUrl({
    url: `${auth.endpoint}${path}`,
    method,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${auth.token}`,
    },
    body: init.body,
    throw: false,
  });
  guard(response);
  return response;
}

function guard(response: RequestUrlResponse): void {
  if (response.status === 401) {
    throw new TokenRejectedError();
  }
  if (response.status < 200 || response.status >= 300) {
    console.warn(`MyBrain ${response.status}: ${response.text}`);
    throw new Error(`MyBrain request failed (status ${response.status})`);
  }
}

function buildMultipart(
  boundary: string,
  fields: Record<string, string>,
  file: MultipartFile,
): ArrayBuffer {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];

  for (const [key, value] of Object.entries(fields)) {
    chunks.push(
      encoder.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="${escapeFieldValue(key)}"\r\n\r\n${escapeFieldValue(value)}\r\n`,
      ),
    );
  }

  chunks.push(
    encoder.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${escapeFilename(file.name)}"\r\nContent-Type: ${sanitizeContentType(file.contentType)}\r\n\r\n`,
    ),
    new Uint8Array(file.bytes),
    encoder.encode(`\r\n--${boundary}--\r\n`),
  );

  const total = chunks.reduce((acc, c) => acc + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;

  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  
  return out.buffer;
}

function escapeFilename(value: string): string {
  return escapeFieldValue(value).replace(/[\\"]/g, (m) => `\\${m}`);
}

function escapeFieldValue(value: string): string {
  return value.replace(/[\r\n]/g, "");
}

function sanitizeContentType(value: string): string {
  if (/[\u0000-\u001f\u007f]/.test(value)) return "application/octet-stream";
  return value;
}
