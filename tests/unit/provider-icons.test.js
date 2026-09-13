import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-provider-icons-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
  vi.doMock("../../src/lib/modelCatalog/runtime.js", () => ({ refreshModelCatalogRuntime: vi.fn(async () => null) }));
});

afterEach(() => {
  vi.doUnmock("../../src/lib/modelCatalog/runtime.js");
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

async function pngBuffer() {
  const { default: sharp } = await import("sharp");
  return sharp({ create: { width: 512, height: 256, channels: 4, background: "#10a37f" } }).png().toBuffer();
}

async function createNode(db, id = "openai-compatible-chat-icon-test") {
  return db.createProviderNode({
    id,
    type: "openai-compatible",
    name: "Icon test",
    prefix: "icon-test",
    apiType: "chat",
    baseUrl: "https://example.test/v1",
  });
}

describe("filesystem-backed provider icons", () => {
  it("converts uploads to bounded WebP outside SQLite", async () => {
    const { convertProviderIcon, saveProviderIcon, readProviderIcon, PROVIDER_ICON_LIMITS } = await import("@/lib/providerIcons.js");
    const { default: sharp } = await import("sharp");
    const converted = await convertProviderIcon(await pngBuffer());
    const metadata = await sharp(converted).metadata();

    expect(metadata.format).toBe("webp");
    expect(metadata.width).toBe(PROVIDER_ICON_LIMITS.MAX_DIMENSION);
    expect(metadata.height).toBe(128);

    await saveProviderIcon("openai-compatible-chat-icon-test", await pngBuffer());
    expect(await readProviderIcon("openai-compatible-chat-icon-test")).toEqual(expect.any(Buffer));
    expect(fs.existsSync(path.join(tempDir, "provider-icons", "openai-compatible-chat-icon-test.webp"))).toBe(true);
  });

  it("rejects non-images", async () => {
    const { convertProviderIcon } = await import("@/lib/providerIcons.js");
    await expect(convertProviderIcon(Buffer.from("not an image"))).rejects.toThrow();
  });

  it("accepts SVG and converts it to WebP", async () => {
    const { convertProviderIcon } = await import("@/lib/providerIcons.js");
    const { default: sharp } = await import("sharp");
    const icon = await convertProviderIcon(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="16"><rect width="32" height="16" fill="#10a37f"/></svg>'));
    const metadata = await sharp(icon).metadata();
    expect(metadata).toMatchObject({ format: "webp", width: 32, height: 16 });
  });

  it("removes an icon when its provider is deleted", async () => {
    const db = await import("@/lib/db/index.js");
    const { saveProviderIcon, readProviderIcon } = await import("@/lib/providerIcons.js");
    const node = await createNode(db);
    await saveProviderIcon(node.id, await pngBuffer());

    await db.deleteProviderNode(node.id);
    expect(await readProviderIcon(node.id)).toBeNull();
  });

  it("keeps the icon through a compatible-provider type conversion", async () => {
    const db = await import("@/lib/db/index.js");
    const { saveProviderIcon, readProviderIcon } = await import("@/lib/providerIcons.js");
    const node = await createNode(db);
    await saveProviderIcon(node.id, await pngBuffer());
    await db.updateProviderNode(node.id, { iconVersion: 1 });

    const converted = await db.convertProviderNodeType(node.id, {
      type: "anthropic-compatible",
      name: "Icon test",
      prefix: "icon-test",
      baseUrl: "https://example.test/v1",
    });

    expect(converted.iconVersion).toBe(1);
    expect(await readProviderIcon(node.id)).toBeNull();
    expect(await readProviderIcon(converted.id)).toEqual(expect.any(Buffer));
  });
});

describe("provider icon route", () => {
  it("uploads, serves, and removes a custom-provider icon", async () => {
    const db = await import("@/lib/db/index.js");
    const node = await createNode(db, "openai-compatible-chat-icon-route");
    const { PUT, GET, DELETE } = await import("../../src/app/api/provider-nodes/[id]/icon/route.js");
    const form = new FormData();
    form.set("icon", new Blob([await pngBuffer()], { type: "image/png" }), "icon.png");

    const uploaded = await PUT(new Request("http://localhost/api/provider-nodes/x/icon", { method: "PUT", body: form }), { params: Promise.resolve({ id: node.id }) });
    expect(uploaded.status).toBe(200);
    const payload = await uploaded.json();
    expect(payload.iconVersion).toEqual(expect.any(Number));

    const fetched = await GET(new Request("http://localhost/api/provider-nodes/x/icon"), { params: Promise.resolve({ id: node.id }) });
    expect(fetched.headers.get("content-type")).toBe("image/webp");
    expect(Buffer.from(await fetched.arrayBuffer()).subarray(0, 4).toString("ascii")).toBe("RIFF");

    const removed = await DELETE(new Request("http://localhost/api/provider-nodes/x/icon", { method: "DELETE" }), { params: Promise.resolve({ id: node.id }) });
    expect(removed.status).toBe(200);
    const missing = await GET(new Request("http://localhost/api/provider-nodes/x/icon"), { params: Promise.resolve({ id: node.id }) });
    expect(missing.status).toBe(404);
  });
});
