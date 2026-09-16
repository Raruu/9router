import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-models-support-"));
  process.env.DATA_DIR = tempDir;
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("provider models listing support flag", () => {
  it("reports supported for providers in the listing map", async () => {
    const { GET } = await import("../../src/app/api/providers/models-support/route.js");
    const res = await GET(new Request("http://localhost/api/providers/models-support?provider=anthropic"));
    expect(await res.json()).toEqual({ supported: true });
  });

  it("reports unsupported for unknown providers", async () => {
    const { GET } = await import("../../src/app/api/providers/models-support/route.js");
    const res = await GET(new Request("http://localhost/api/providers/models-support?provider=no-such-provider"));
    expect(await res.json()).toEqual({ supported: false });
  });
});

describe("pricing userOnly flag", () => {
  it("returns user override tables without merged defaults", async () => {
    const { GET } = await import("../../src/app/api/pricing/route.js");
    const res = await GET(new Request("http://localhost/api/pricing?userOnly=1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
  });
});
