// Thinking observability in Usage → Details: the trace built in chatCore must
// survive the requestDetailsRepo field whitelist and round-trip through the
// API shape the drawer reads.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-thinking-trace-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  await db.updateSettings({ enableObservability: true, observabilityBatchSize: 1 });
});

afterAll(async () => {
  await db.flushRequestDetails?.();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

const { buildRequestDetail, buildThinkingTrace, describeThinkingIntent } = await import("../../open-sse/handlers/chatCore/requestDetail.js");

describe("describeThinkingIntent", () => {
  it("renders each intent shape like the console fmtThink", () => {
    expect(describeThinkingIntent({ mode: "none" })).toBe("off");
    expect(describeThinkingIntent({ mode: "auto" })).toBe("auto");
    expect(describeThinkingIntent({ mode: "budget", budget: 8192 })).toBe("8192");
    expect(describeThinkingIntent({ mode: "level", level: "high" })).toBe("high");
    expect(describeThinkingIntent(null)).toBeNull();
  });
});

describe("buildThinkingTrace", () => {
  it("is undefined when nothing is known (old-style rows stay clean)", () => {
    expect(buildThinkingTrace({ requested: null, applied: null, classifier: null })).toBeUndefined();
  });

  it("records a clamp as requested → applied", () => {
    expect(buildThinkingTrace({
      requested: { mode: "level", level: "max" },
      applied: { mode: "level", level: "high" },
      classifier: null,
    })).toEqual({ requested: "max", applied: "high" });
  });

  it("records the classifier profile, tier and fallback flag", () => {
    expect(buildThinkingTrace({
      requested: { mode: "level", level: "low" },
      applied: { mode: "level", level: "medium" },
      classifier: { profile: "laya", requested: "laya", fallback: true },
    })).toEqual({
      requested: "low",
      applied: "medium",
      classifier: "laya",
      requestedTier: "laya",
      fallback: true,
    });
  });
});

describe("request detail persistence", () => {
  it("persists the thinking trace through the repo whitelist", async () => {
    const trace = { requested: "max", applied: "high", classifier: "laya", requestedTier: "laya", fallback: false };
    await db.saveRequestDetail(buildRequestDetail({
      provider: "openai",
      model: "gpt-5.4",
      request: { messages: [], model: "gpt-5.4", stream: false },
      response: { content: "hi", thinking: null },
      thinking: trace,
      status: "success",
    }, { id: "thinking-trace-1" }));
    await db.flushRequestDetails();

    const detail = await db.getRequestDetailById("thinking-trace-1");
    expect(detail.thinking).toEqual(trace);
  });

  it("omits the key entirely when no trace was built", async () => {
    await db.saveRequestDetail(buildRequestDetail({
      provider: "openai",
      model: "gpt-5.4",
      request: { messages: [], model: "gpt-5.4", stream: false },
      response: { content: "hi", thinking: null },
      status: "success",
    }, { id: "thinking-trace-2" }));
    await db.flushRequestDetails();

    const detail = await db.getRequestDetailById("thinking-trace-2");
    expect("thinking" in detail).toBe(false);
  });
});
