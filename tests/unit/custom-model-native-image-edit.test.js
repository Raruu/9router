// Image-only opt-in: "Use native image edit endpoint" on custom models.
// Covers repo persistence, the /api/models/custom sanitizer, and the row
// projection used by the edit dialog.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getProviderCustomModelRows } from "../../src/shared/utils/providerCustomModels.js";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

async function postCustomModel(payload) {
  vi.doMock("next/server", () => ({
    NextResponse: {
      json(body, init = {}) {
        return new Response(JSON.stringify(body), {
          status: init.status || 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  }));
  const { POST } = await import("../../src/app/api/models/custom/route.js");
  const response = await POST(new Request("http://localhost/api/models/custom", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }));
  return { response, body: await response.json() };
}

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-native-edit-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterEach(() => {
  vi.doUnmock("next/server");
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("nativeImageEdit persistence", () => {
  it("stores the flag on image models and exposes it to the dialog rows", async () => {
    await db.addCustomModel({
      providerAlias: "codex",
      id: "gpt-image-custom",
      type: "image",
      nativeImageEdit: true,
    });

    const models = await db.getCustomModels();
    const hit = models.find((m) => m.id === "gpt-image-custom");
    expect(hit.nativeImageEdit).toBe(true);
    expect(getProviderCustomModelRows({
      customModels: models,
      providerAlias: "codex",
      type: null,
    }).find((r) => r.id === "gpt-image-custom").nativeImageEdit).toBe(true);
  });

  it("clears on explicit false and keeps on an omitted key", async () => {
    await db.addCustomModel({ providerAlias: "codex", id: "img", type: "image", nativeImageEdit: true });
    await db.addCustomModel({ providerAlias: "codex", id: "img", type: "image" });
    expect((await db.getCustomModels()).find((m) => m.id === "img").nativeImageEdit).toBe(true);

    await db.addCustomModel({ providerAlias: "codex", id: "img", type: "image", nativeImageEdit: false });
    expect((await db.getCustomModels()).find((m) => m.id === "img").nativeImageEdit).toBeUndefined();
  });

  it("drops the flag when the model kind changes away from image", async () => {
    await db.addCustomModel({ providerAlias: "codex", id: "m", type: "image", nativeImageEdit: true });
    await db.addCustomModel({ providerAlias: "codex", id: "m", type: "llm", previousType: "image" });

    const models = await db.getCustomModels();
    expect(models.find((m) => m.id === "m")).toMatchObject({ type: "llm" });
    expect(models.find((m) => m.id === "m").nativeImageEdit).toBeUndefined();
  });
});

describe("POST /api/models/custom nativeImageEdit", () => {
  it("persists true on image models and returns it from GET", async () => {
    const { response } = await postCustomModel({
      providerAlias: "codex",
      id: "img-api",
      type: "image",
      nativeImageEdit: true,
    });
    expect(response.status).toBe(200);

    const models = await db.getCustomModels();
    expect(models.find((m) => m.id === "img-api").nativeImageEdit).toBe(true);
  });

  it("ignores the flag on non-image kinds", async () => {
    const { response } = await postCustomModel({
      providerAlias: "codex",
      id: "chat-api",
      type: "llm",
      nativeImageEdit: true,
    });
    expect(response.status).toBe(200);
    expect((await db.getCustomModels()).find((m) => m.id === "chat-api").nativeImageEdit).toBeUndefined();
  });

  it("clears the flag when the modal sends false", async () => {
    await db.addCustomModel({ providerAlias: "codex", id: "img-off", type: "image", nativeImageEdit: true });
    await postCustomModel({
      providerAlias: "codex",
      id: "img-off",
      type: "image",
      nativeImageEdit: false,
    });
    expect((await db.getCustomModels()).find((m) => m.id === "img-off").nativeImageEdit).toBeUndefined();
  });
});
