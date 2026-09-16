import { describe, it, expect, vi } from "vitest";
import {
  buildCatalogRuleBody,
  saveCatalogRule,
} from "../../src/shared/utils/importCatalogSnapshot.js";

const detail = {
  capabilities: {
    vision: true,
    pdf: false,
    tools: true,
    reasoning: false,
    contextWindow: 200000,
    maxOutput: 32000,
    extraUnknown: true,
  },
  pricing: { input: 3, output: 15, bogus: 1, negative: -2 },
};

describe("importCatalogSnapshot", () => {
  it("maps detail capabilities/context/pricing to a user rule body", () => {
    expect(buildCatalogRuleBody({ provider: "acme", pattern: "m1", detail })).toEqual({
      provider: "acme",
      pattern: "m1",
      matchType: "exact",
      capabilities: { vision: true, pdf: false, tools: true, reasoning: false },
      contextWindow: 200000,
      maxOutput: 32000,
      pricing: { input: 3, output: 15 },
    });
  });

  it("returns null without capabilities", () => {
    expect(buildCatalogRuleBody({ provider: "acme", pattern: "m1", detail: {} })).toBeNull();
    expect(buildCatalogRuleBody({ provider: "acme", pattern: "m1", detail: null })).toBeNull();
  });

  it("POSTs the rule and succeeds", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 }));
    const body = { provider: "acme", pattern: "m1", matchType: "exact", capabilities: {} };
    expect(await saveCatalogRule(body, fetchImpl)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/models/catalog/user");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual(body);
  });

  it("falls back to PUT with identity on 409", async () => {
    const fetchImpl = vi.fn(async (url, init) =>
      init.method === "POST" ? { ok: false, status: 409 } : { ok: true, status: 200 },
    );
    const body = { provider: "acme", pattern: "m1", matchType: "exact", capabilities: {} };
    expect(await saveCatalogRule(body, fetchImpl)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({
      ...body,
      originalIdentity: { provider: "acme", pattern: "m1" },
    });
  });

  it("returns false when both POST and PUT fail", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500 }));
    expect(
      await saveCatalogRule({ provider: "acme", pattern: "m1", matchType: "exact", capabilities: {} }, fetchImpl),
    ).toBe(false);
  });
});
