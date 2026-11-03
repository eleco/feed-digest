import type { IncomingMessage, ServerResponse } from "node:http";
import { readerResponse, MAX_UPLOAD, type ReaderStorage } from "./reader.js";

export async function serveReader(
  req: IncomingMessage,
  res: ServerResponse,
  storage: ReaderStorage,
  html: () => Promise<string>,
  env = process.env,
) {
  try {
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers))
      if (value !== undefined)
        headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    const host = req.headers.host;
    const protocol =
      req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
    const method = req.method ?? "GET";
    let body: Uint8Array<ArrayBuffer> | undefined;
    if (method === "PUT") {
      const parts: Buffer[] = [];
      let size = 0;
      for await (const part of req) {
        size += part.length;
        if (size > MAX_UPLOAD) {
          res.writeHead(413, { "Cache-Control": "no-store" });
          res.end("Export too large.");
          return;
        }
        parts.push(Buffer.from(part));
      }
      body = new Uint8Array(Buffer.concat(parts));
    }
    const response = await readerResponse(
      new Request(`${protocol}://${host}${req.url}`, { method, headers, body }),
      storage,
      html,
      env,
    );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(503, {
      "Cache-Control": "private, no-store",
      "Content-Type": "text/plain",
    });
    res.end("Reader storage is unavailable. Check the server configuration.");
  }
}
