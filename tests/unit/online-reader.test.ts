import { describe, it, expect, vi } from "vitest";
import { gzipSync, gunzipSync } from "node:zlib";
import {
  readerSnapshot,
  parseReaderSnapshot,
} from "../../src/shared/online-reader";
import { authorised, readerResponse } from "../../server/reader";
import { post } from "../fixtures/data";
const env = { READER_USERNAME: "reader", READER_PASSWORD: "test-password" };
const auth = "Basic " + Buffer.from("reader:test-password").toString("base64");
const snapshot = () =>
  readerSnapshot(
    [post("123", { text: "<script>danger()</script>", pinned: true })],
    [],
  );
const storage = () => ({
  read: vi.fn(async (): Promise<Uint8Array | null> => null),
  write: vi.fn(async (_value: Uint8Array) => {}),
});
const html = async () => "<html>Reader</html>";
function upload(body: Buffer, extra: Record<string, string> = {}) {
  return new Request("https://reader.example/api/reader?data=1", {
    method: "PUT",
    headers: {
      authorization: auth,
      origin: "https://reader.example",
      "content-type": "application/gzip",
      ...extra,
    },
    body: new Uint8Array(body),
  });
}
describe("online reader", () => {
  it("exports only reading data and keeps hostile text as text", () => {
    const raw = {
      ...snapshot(),
      secret: "provider-key",
      posts: [
        { ...snapshot().posts[0], token: "secret", url: "javascript:alert(1)" },
      ],
    };
    const value = parseReaderSnapshot(raw);
    expect(JSON.stringify(value)).not.toContain("secret");
    expect(value.posts[0].text).toBe("<script>danger()</script>");
    expect(value.posts[0].url).toBe("https://x.com/example/status/123");
    expect(value.posts[0].pinned).toBe(true);
    expect(() =>
      parseReaderSnapshot({
        ...snapshot(),
        posts: [{ ...snapshot().posts[0], links: ["javascript:alert(1)"] }],
      }),
    ).toThrow();
  });
  it("fails closed without configuration and authenticates before reading or writing storage", async () => {
    const store = storage();
    const noAuth = new Request("https://reader.example/api/reader?data=1");
    expect((await readerResponse(noAuth, store, html, {})).status).toBe(503);
    const denied = await readerResponse(noAuth, store, html, env);
    expect(denied.status).toBe(401);
    expect(denied.headers.get("www-authenticate")).toContain("Basic");
    expect(store.read).not.toHaveBeenCalled();
    expect(store.write).not.toHaveBeenCalled();
    expect(
      authorised(
        "Basic " + Buffer.from("reader:wrong").toString("base64"),
        env.READER_USERNAME,
        env.READER_PASSWORD,
      ),
    ).toBe(false);
  });
  it("requires authentication for the reader page and returns no-store responses", async () => {
    const response = await readerResponse(
      new Request("https://reader.example/reader", {
        headers: { authorization: auth },
      }),
      storage(),
      html,
      env,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<html>Reader</html>");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("rejects cross-origin uploads and invalid files without changing saved data", async () => {
    const store = storage(),
      bytes = gzipSync(JSON.stringify(snapshot()));
    expect(
      (
        await readerResponse(
          upload(bytes, { origin: "https://evil.example" }),
          store,
          html,
          env,
        )
      ).status,
    ).toBe(403);
    expect(
      (await readerResponse(upload(Buffer.from("not gzip")), store, html, env))
        .status,
    ).toBe(400);
    expect(store.write).not.toHaveBeenCalled();
  });
  it("validates uploads, strips extra fields and reads back the saved collection", async () => {
    const store = storage();
    const raw = { ...snapshot(), credentials: "do-not-save" };
    expect(
      (
        await readerResponse(
          upload(gzipSync(JSON.stringify(raw))),
          store,
          html,
          env,
        )
      ).status,
    ).toBe(200);
    const saved = store.write.mock.calls[0][0];
    const data = JSON.parse(gunzipSync(saved).toString());
    expect(data.credentials).toBeUndefined();
    expect(data.posts).toHaveLength(1);
    store.read.mockResolvedValue(saved);
    const response = await readerResponse(
      new Request("https://reader.example/api/reader?data=1", {
        headers: { authorization: auth },
      }),
      store,
      html,
      env,
    );
    expect(response.headers.get("content-encoding")).toBe("gzip");
    expect(
      JSON.parse(
        gunzipSync(Buffer.from(await response.arrayBuffer())).toString(),
      ),
    ).toEqual(data);
  });
  it("caps decompressed uploads before parsing", async () => {
    const store = storage();
    const body = gzipSync(" ".repeat(20_000_001));
    expect((await readerResponse(upload(body), store, html, env)).status).toBe(
      400,
    );
    expect(store.write).not.toHaveBeenCalled();
  });
});
