// Catalog source resolution for the shared model picker (ModelSelectModal).
//
// Some providers expose a per-account live catalog that is the authoritative
// list — Cursor's static registry carries no usable entitlement information,
// so the live fetch wins there. Cline/ClinePass deliberately do NOT use their
// live catalog here: api.cline.bot/api/v1/models returns the account-wide
// catalog (hundreds of ids), while the provider page shows the configured
// list (static registry + models the user imported via "Import from /models").
// The combo picker must mirror that configured list — otherwise it offers
// models the user never added, which is exactly the reported mismatch.

export const LIVE_CATALOG_PROVIDERS = ["cursor"];

// Pick the model list a provider's picker group should render: the live
// account catalog when the provider is opted in AND the fetch produced rows,
// otherwise the static/configured list. `liveModelsByProvider` is keyed by
// provider id; entries for providers outside LIVE_CATALOG_PROVIDERS are
// ignored on purpose (defense in depth, so a caller cannot reintroduce the
// cline live-catalog regression by passing models for it).
export function pickProviderCatalog({ providerId, liveModelsByProvider = {}, staticModels = [] }) {
  const live = LIVE_CATALOG_PROVIDERS.includes(providerId)
    ? (liveModelsByProvider[providerId] || [])
    : [];
  return live.length > 0 ? live : staticModels;
}
