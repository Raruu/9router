import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-model-catalog-api-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
  vi.doMock("../../src/lib/modelCatalog/runtime.js", () => ({
    refreshModelCatalogRuntime: vi.fn(async () => null),
  }));
});

afterEach(() => {
  vi.doUnmock("../../src/lib/modelCatalog/runtime.js");
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("model catalog API backend", () => {
  it("validates and persists user rules in the runtime data shape", async () => {
    const backend = await import("../../src/app/api/models/catalog/_backend.js");
    const entry = backend.validateUserEntry({
      provider: "Acme",
      pattern: "foo-*",
      matchType: "glob",
      name: "Foo",
      capabilities: { vision: false, reasoning: true },
      contextWindow: 123456,
      maxOutput: 4096,
      pricing: { input: 1.5, output: 8, cached: 0.2 },
    });

    await backend.saveUserEntry(entry);
    const catalog = await backend.getCatalog();
    expect(catalog.userDefined).toMatchObject([{
      provider: "acme",
      pattern: "foo-*",
      name: "Foo",
      capabilities: { vision: false, reasoning: true, contextWindow: 123456, maxOutput: 4096 },
      pricing: { input: 1.5, output: 8, cached: 0.2 },
    }]);
    expect(catalog.hardcoded.some((row) => row.type === "Pattern")).toBe(true);
  });

  it("normalizes and atomically stores OpenRouter models", async () => {
    const backend = await import("../../src/app/api/models/catalog/_backend.js");
    const result = await backend.replaceOpenRouter([
      {
        id: "anthropic/claude-sonnet-5:batch",
        architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
        pricing: { prompt: "0.1", completion: "0.2" },
      },
      {
        id: "anthropic/claude-sonnet-5",
        name: "Claude Sonnet 5",
        context_length: 200000,
        top_provider: { max_completion_tokens: 64000 },
        architecture: { input_modalities: ["text"], output_modalities: ["text"] },
        supported_parameters: ["tools"],
        pricing: { prompt: "0.000003", completion: "0.000015" },
      },
    ], "2026-09-08T00:00:00.000Z");

    expect(result).toEqual({ count: 1 });
    const catalog = await backend.getCatalog();
    expect(catalog.openrouter.models).toMatchObject([{
      pattern: "*claude-sonnet-5*",
      normalizedModel: "claude-sonnet-5",
      sourceId: "anthropic/claude-sonnet-5",
      capabilities: { vision: false, tools: true, contextWindow: 200000, maxOutput: 64000 },
      pricing: { input: 3, output: 15 },
    }]);
  });

  it("deletes one OpenRouter entry", async () => {
    const backend = await import("../../src/app/api/models/catalog/_backend.js");
    await backend.replaceOpenRouter([{ id: "acme/first" }, { id: "acme/second" }], "2026-09-08T00:00:00.000Z");

    expect(await backend.deleteOpenRouterEntry({ pattern: "*first*" })).toBe(true);
    expect((await backend.getCatalog()).openrouter.models).toMatchObject([{ pattern: "*second*" }]);
  });
});
