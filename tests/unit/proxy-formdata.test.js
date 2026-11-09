// The patched global fetch (proxyAwareFetch) runs npm-undici's fetch, which
// only understands its own FormData class. Multipart bodies built from Node's
// global FormData used to be sent as the string "[object FormData]" with a
// text/plain header — i.e. every uploaded file was silently dropped.
import http from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";

let server;
let port;
let received;

beforeEach(async () => {
  received = null;
  vi.stubEnv("NO_PROXY", "*");
  vi.stubEnv("no_proxy", "*");
  server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      received = {
        contentType: req.headers["content-type"] || "",
        body: Buffer.concat(chunks),
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
});

afterEach(async () => {
  vi.unstubAllEnvs();
  if (server) await new Promise((resolve) => server.close(resolve));
});

describe("proxyAwareFetch multipart bodies", () => {
  it("serializes a global FormData with its file bytes", async () => {
    const bytes = [137, 80, 78, 71, 1, 2, 3];
    const form = new FormData();
    form.append("model", "image-model");
    form.append("prompt", "edit this");
    form.append("image", new File([new Uint8Array(bytes)], "a.png", { type: "image/png" }), "a.png");

    const response = await proxyAwareFetch(`http://127.0.0.1:${port}/v1/images/edits`, {
      method: "POST",
      body: form,
    });

    expect(response.ok).toBe(true);
    expect(received.contentType).toContain("multipart/form-data");
    const raw = received.body.toString("latin1");
    expect(raw).toContain('name="image"; filename="a.png"');
    expect(raw).toContain('name="model"');
    expect(raw).toContain("image-model");
    expect(received.body.includes(Buffer.from(bytes))).toBe(true);
  });
});
