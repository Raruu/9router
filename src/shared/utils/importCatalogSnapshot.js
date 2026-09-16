// Mapping + persistence for the "save capabilities to Model Catalog" import
// option: snapshot a model's resolved /api/models/detail into a
// provider-scoped, exact-match user catalog rule (POST, PUT on 409).

export const SNAPSHOT_BOOL_CAPS = [
  "vision", "pdf", "audioInput", "videoInput",
  "imageOutput", "audioOutput", "tools", "reasoning",
];

export const SNAPSHOT_PRICING_KEYS = ["input", "output", "cached", "reasoning", "cache_creation"];

// detail: GET /api/models/detail response ({capabilities, pricing}).
// Returns the POST /api/models/catalog/user body, or null when there is
// nothing worth saving.
export function buildCatalogRuleBody({ provider, pattern, detail }) {
  const caps = detail?.capabilities;
  if (!caps || typeof caps !== "object") return null;
  const capabilities = {};
  for (const key of SNAPSHOT_BOOL_CAPS) {
    if (typeof caps[key] === "boolean") capabilities[key] = caps[key];
  }
  const body = { provider, pattern, matchType: "exact", capabilities };
  if (Number.isFinite(caps.contextWindow) && caps.contextWindow > 0) {
    body.contextWindow = Math.floor(caps.contextWindow);
  }
  if (Number.isFinite(caps.maxOutput) && caps.maxOutput > 0) {
    body.maxOutput = Math.floor(caps.maxOutput);
  }
  if (detail.pricing && typeof detail.pricing === "object") {
    const pricing = {};
    for (const key of SNAPSHOT_PRICING_KEYS) {
      const value = Number(detail.pricing[key]);
      if (Number.isFinite(value) && value >= 0) pricing[key] = value;
    }
    if (Object.keys(pricing).length > 0) body.pricing = pricing;
  }
  return body;
}

// fetchImpl defaults to global fetch so tests can inject a mock.
export async function saveCatalogRule(body, fetchImpl = fetch) {
  const post = (method, payload) => fetchImpl("/api/models/catalog/user", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  let res = await post("POST", body);
  if (res.status === 409) {
    res = await post("PUT", {
      ...body,
      originalIdentity: { provider: body.provider, pattern: body.pattern },
    });
  }
  return res.ok;
}
