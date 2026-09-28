// Custom-model service kinds: the dropdown taxonomy, the rename-on-type-change
// contract in the repo, and the Available Models grouping helpers.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  CUSTOM_MODEL_TYPES,
  isCustomModelType,
  normalizeCustomModelType,
  customModelTypeLabel,
} from "../../src/shared/constants/models.js";
import {
  getProviderCustomModelRows,
  groupCustomModelRowsByKind,
  groupBuiltInModelsByKind,
} from "../../src/shared/utils/providerCustomModels.js";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-custom-types-"));
  process.env.DATA_DIR = tempDir;
  // The adapter lives on globalThis (Next.js hot-reload survival), so it would
  // otherwise keep pointing at the first test's temp DB.
  delete global._dbAdapter;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("CUSTOM_MODEL_TYPES taxonomy", () => {
  it("offers LLM plus every media kind that has a real route", () => {
    const ids = CUSTOM_MODEL_TYPES.map((t) => t.id);
    expect(ids).toContain("llm");
    for (const kind of ["image", "imageToText", "video", "stt", "tts", "embedding", "systemone"]) {
      expect(ids, `missing ${kind}`).toContain(kind);
    }
  });

  it("excludes music (no route) and the provider-as-model web kinds", () => {
    const ids = CUSTOM_MODEL_TYPES.map((t) => t.id);
    expect(ids).not.toContain("music");
    expect(ids).not.toContain("webSearch");
    expect(ids).not.toContain("webFetch");
  });

  it("labels and validates ids", () => {
    expect(isCustomModelType("stt")).toBe(true);
    expect(isCustomModelType("music")).toBe(false);
    expect(isCustomModelType(undefined)).toBe(false);
    expect(normalizeCustomModelType("nonsense")).toBe("llm");
    expect(normalizeCustomModelType("video")).toBe("video");
    expect(customModelTypeLabel("systemone")).toBe("System One");
    expect(customModelTypeLabel("unknown-kind")).toBe("unknown-kind");
  });
});

describe("getProviderCustomModelRows type filtering", () => {
  const customModels = [
    { providerAlias: "p", id: "chatty", type: "llm", name: "Chatty" },
    { providerAlias: "p", id: "listen", type: "stt", transport: "gemini-live" },
    { providerAlias: "p", id: "paint", type: "image" },
    { providerAlias: "q", id: "other", type: "image" },
  ];

  it("narrows to one kind by default (llm)", () => {
    const rows = getProviderCustomModelRows({ customModels, providerAlias: "p" });
    expect(rows.map((r) => r.id)).toEqual(["chatty"]);
  });

  it("returns every kind when type is null, carrying type + transport", () => {
    const rows = getProviderCustomModelRows({ customModels, providerAlias: "p", type: null });
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(Object.keys(byId).sort()).toEqual(["chatty", "listen", "paint"]);
    expect(byId.listen.type).toBe("stt");
    expect(byId.listen.transport).toBe("gemini-live");
    expect(byId.paint.type).toBe("image");
  });
});

describe("groupCustomModelRowsByKind", () => {
  it("orders LLM first, then taxonomy order, and keeps unknown kinds visible", () => {
    const groups = groupCustomModelRowsByKind([
      { id: "legacy", type: "whatever" },
      { id: "img", type: "image" },
      { id: "chat", type: "llm" },
      { id: "vid", type: "video" },
    ]);
    expect(groups.map((g) => g.id)).toEqual(["llm", "image", "video", "whatever"]);
    expect(groups[0].rows.map((r) => r.id)).toEqual(["chat"]);
  });

  it("treats a missing type as LLM and drops empty groups", () => {
    const groups = groupCustomModelRowsByKind([{ id: "a" }, { id: "b", type: "stt" }]);
    expect(groups.map((g) => g.id)).toEqual(["llm", "stt"]);
    expect(groups.find((g) => g.id === "image")).toBeUndefined();
  });

  it("labels groups from the shared taxonomy", () => {
    const groups = groupCustomModelRowsByKind([{ id: "a", type: "systemone" }]);
    expect(groups[0].label).toBe("System One");
  });

  it("groups legacy alias rows (type defaults to LLM) alongside custom rows", () => {
    // Both provider pages render one grouped list now, so alias rows must land
    // in the LLM section rather than a separate or missing bucket.
    const rows = getProviderCustomModelRows({
      customModels: [{ providerAlias: "p", id: "custom-a", type: "llm", name: "Custom A" }],
      modelAliases: { "legacy-b": "p/legacy-b" },
      providerAlias: "p",
      type: null,
    });
    const groups = groupCustomModelRowsByKind(rows);
    expect(groups.map((g) => g.id)).toEqual(["llm"]);
    expect(groups[0].rows.map((r) => r.id)).toEqual(["custom-a", "legacy-b"]);
  });
});

describe("getProviderCustomModelRows lock passthrough", () => {
  it("carries the locked flag so both pages can render the lock button", () => {
    const rows = getProviderCustomModelRows({
      customModels: [
        { providerAlias: "p", id: "kept", type: "stt", locked: true },
        { providerAlias: "p", id: "free", type: "llm" },
      ],
      providerAlias: "p",
      type: null,
    });
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId.kept.locked).toBe(true);
    expect(byId.free.locked).toBeUndefined();
  });
});

describe("groupBuiltInModelsByKind", () => {
  it("groups registry entries by their own kind", () => {
    const groups = groupBuiltInModelsByKind([
      { id: "m1", kind: "image" },
      { id: "m2" },
      { id: "m3", kind: "stt" },
    ]);
    expect(groups.map((g) => g.id)).toEqual(["llm", "image", "stt"]);
    expect(groups.find((g) => g.id === "llm").models.map((m) => m.id)).toEqual(["m2"]);
  });
});

describe("addCustomModel rename on type change", () => {
  it("moves the record to the new type key instead of duplicating it", async () => {
    const repo = await import("@/lib/db/repos/aliasRepo.js");
    await repo.addCustomModel({ providerAlias: "p", id: "m", type: "llm", name: "Mine", caps: { vision: true } });
    await repo.addCustomModel({ providerAlias: "p", id: "m", type: "stt", previousType: "llm" });

    const all = await repo.getCustomModels();
    const mine = all.filter((m) => m.id === "m");
    expect(mine).toHaveLength(1);
    expect(mine[0].type).toBe("stt");
    // Metadata carries over: it is a rename, not a fresh record.
    expect(mine[0].name).toBe("Mine");
    expect(mine[0].caps).toEqual({ vision: true });
  });

  it("keeps a transport when moving to stt and clears it when moving away", async () => {
    const repo = await import("@/lib/db/repos/aliasRepo.js");
    await repo.addCustomModel({ providerAlias: "p", id: "m", type: "llm" });
    await repo.addCustomModel({ providerAlias: "p", id: "m", type: "stt", previousType: "llm", transport: "gemini-live" });
    let row = (await repo.getCustomModels()).find((m) => m.id === "m");
    expect(row.transport).toBe("gemini-live");

    await repo.addCustomModel({ providerAlias: "p", id: "m", type: "image", previousType: "stt" });
    row = (await repo.getCustomModels()).find((m) => m.id === "m");
    expect(row.type).toBe("image");
    expect(row.transport).toBeUndefined();
  });

  it("clears an stt transport when the modal sends an explicit empty value", async () => {
    const repo = await import("@/lib/db/repos/aliasRepo.js");
    await repo.addCustomModel({ providerAlias: "p", id: "m", type: "stt", transport: "gemini-live" });
    await repo.addCustomModel({ providerAlias: "p", id: "m", type: "stt", transport: "" });
    const row = (await repo.getCustomModels()).find((m) => m.id === "m");
    expect(row.transport).toBeUndefined();
  });

  it("leaves the transport untouched when the caller omits it", async () => {
    const repo = await import("@/lib/db/repos/aliasRepo.js");
    await repo.addCustomModel({ providerAlias: "p", id: "m", type: "stt", transport: "gemini-live" });
    // e.g. the media-page add button re-saving the same model without a marker.
    await repo.addCustomModel({ providerAlias: "p", id: "m", type: "stt", name: "Renamed" });
    const row = (await repo.getCustomModels()).find((m) => m.id === "m");
    expect(row.transport).toBe("gemini-live");
    expect(row.name).toBe("Renamed");
  });
});

describe("POST /api/models/custom type handling", () => {
  async function post(body) {
    vi.doMock("next/server", () => ({
      NextResponse: {
        json(payload, init = {}) {
          return new Response(JSON.stringify(payload), {
            status: init.status || 200,
            headers: { "Content-Type": "application/json" },
          });
        },
      },
    }));
    const { POST } = await import("@/app/api/models/custom/route.js");
    const res = await POST(new Request("https://9router.local/api/models/custom", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }));
    return { status: res.status, body: await res.json() };
  }

  it("stores a known kind and rejects nothing", async () => {
    const res = await post({ providerAlias: "p", id: "vid", type: "video" });
    expect(res.status).toBe(200);
    const repo = await import("@/lib/db/repos/aliasRepo.js");
    const row = (await repo.getCustomModels()).find((m) => m.id === "vid");
    expect(row.type).toBe("video");
  });

  it("normalizes an unknown kind to llm instead of minting an unroutable type", async () => {
    const res = await post({ providerAlias: "p", id: "weird", type: "banana" });
    expect(res.status).toBe(200);
    const repo = await import("@/lib/db/repos/aliasRepo.js");
    const row = (await repo.getCustomModels()).find((m) => m.id === "weird");
    expect(row.type).toBe("llm");
  });

  it("moves the record when previousType is supplied", async () => {
    await post({ providerAlias: "p", id: "m", type: "llm" });
    await post({ providerAlias: "p", id: "m", type: "stt", previousType: "llm", transport: "gemini-live" });
    const repo = await import("@/lib/db/repos/aliasRepo.js");
    const rows = (await repo.getCustomModels()).filter((m) => m.id === "m");
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("stt");
    expect(rows[0].transport).toBe("gemini-live");
  });
});
