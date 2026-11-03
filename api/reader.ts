import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { get, put } from "@vercel/blob";
import { serveReader } from "../server/node-reader.js";

export const config = { api: { bodyParser: false } };
const pathname = "reader/saved-posts.json.gz";
export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
) {
  await serveReader(
    req,
    res,
    {
      async read() {
        const result = await get(pathname, {
          access: "private",
          useCache: false,
        });
        if (!result || result.statusCode !== 200) return null;
        return new Uint8Array(await new Response(result.stream).arrayBuffer());
      },
      async write(value) {
        await put(pathname, Buffer.from(value), {
          access: "private",
          allowOverwrite: true,
          addRandomSuffix: false,
          contentType: "application/gzip",
        });
      },
    },
    () => readFile("site-dist/reader.html", "utf8"),
  );
}
