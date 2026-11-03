import { createHash, timingSafeEqual } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { parseReaderSnapshot } from "../src/shared/online-reader.js";

export const MAX_UPLOAD = 4_000_000;
export interface ReaderStorage {
  read(): Promise<Uint8Array | null>;
  write(value: Uint8Array): Promise<void>;
}
export function authorised(
  header: string | undefined,
  username: string,
  password: string,
) {
  if (!username || !password || !header?.startsWith("Basic ")) return false;
  const received = Buffer.from(header.slice(6), "base64");
  const expected = Buffer.from(`${username}:${password}`);
  const hash = (value: Uint8Array) =>
    createHash("sha256").update(value).digest();
  return timingSafeEqual(hash(received), hash(expected));
}
export async function readerResponse(
  request: Request,
  storage: ReaderStorage,
  html: () => Promise<string>,
  env = process.env,
): Promise<Response> {
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    Vary: "Authorization",
  };
  const reply = (body: string, status: number) =>
    new Response(body, { status, headers });
  if (!env.READER_USERNAME || !env.READER_PASSWORD)
    return reply("Online reader is not configured.", 503);
  if (
    !authorised(
      request.headers.get("authorization") ?? undefined,
      env.READER_USERNAME,
      env.READER_PASSWORD,
    )
  )
    return new Response("Sign in to your reader.", {
      status: 401,
      headers: {
        ...headers,
        "WWW-Authenticate": 'Basic realm="X Feed Digest", charset="UTF-8"',
      },
    });
  const url = new URL(request.url);
  if (request.method === "GET" && url.searchParams.get("data") !== "1")
    return new Response(await html(), {
      headers: { ...headers, "Content-Type": "text/html; charset=utf-8" },
    });
  if (request.method === "GET") {
    const value = await storage.read();
    if (!value) return Response.json({ posts: [], empty: true }, { headers });
    return new Response(Buffer.from(value), {
      headers: {
        ...headers,
        "Content-Type": "application/json",
        "Content-Encoding": "gzip",
      },
    });
  }
  if (request.method !== "PUT" || url.searchParams.get("data") !== "1")
    return new Response("Method not allowed.", {
      status: 405,
      headers: { ...headers, Allow: "GET, PUT" },
    });
  // No cross-origin writes through a browser's cached Basic Auth credentials.
  const origin = request.headers.get("origin");
  if (
    !origin ||
    origin !== url.origin ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    return reply("Upload from the reader page.", 403);
  if (request.headers.get("content-type") !== "application/gzip")
    return reply("Expected a compressed reader export.", 415);
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (!request.body) return reply("No file supplied.", 400);
  const reader = request.body.getReader();
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.length;
    if (size > MAX_UPLOAD) {
      await reader.cancel();
      return reply("Export is too large (4 MB compressed maximum).", 413);
    }
    chunks.push(chunk.value);
  }
  let compressed: Buffer;
  try {
    const text = gunzipSync(Buffer.concat(chunks), {
      maxOutputLength: 20_000_000,
    }).toString("utf8");
    const snapshot = parseReaderSnapshot(JSON.parse(text));
    compressed = gzipSync(JSON.stringify(snapshot));
    if (compressed.length > MAX_UPLOAD)
      return reply("Export is too large.", 413);
  } catch {
    return reply("Invalid reader export. Export your saved posts again.", 400);
  }
  await storage.write(compressed);
  return Response.json({ saved: true }, { headers });
}
