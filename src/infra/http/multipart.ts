import type { AttachmentFile } from "@/core/ports";

/** A `multipart/form-data` body: the fields in order, then the file. Built by
 * hand because `requestUrl` takes no FormData. */
export function buildMultipart(
  boundary: string,
  fields: Record<string, string>,
  file: AttachmentFile,
): ArrayBuffer {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];

  for (const [key, value] of Object.entries(fields)) {
    chunks.push(
      encoder.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="${_escapeFieldValue(key)}"\r\n\r\n${_escapeFieldValue(value)}\r\n`,
      ),
    );
  }

  chunks.push(
    encoder.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${_escapeFilename(file.name)}"\r\nContent-Type: ${_sanitizeContentType(file.contentType)}\r\n\r\n`,
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

function _escapeFieldValue(value: string): string {
  return value.replace(/[\r\n]/g, "");
}

function _escapeFilename(value: string): string {
  return _escapeFieldValue(value).replace(/[\\"]/g, (m) => `\\${m}`);
}

function _sanitizeContentType(value: string): string {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;

    if (code <= 0x1f || code === 0x7f) return "application/octet-stream";
  }

  return value;
}
