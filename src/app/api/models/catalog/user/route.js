import { NextResponse } from "next/server";
import {
  deleteUserEntry,
  errorResponse,
  saveUserEntry,
  updateUserEntry,
  validateUserEntry,
} from "../_backend.js";
import {
  getCombos,
  getCustomModels,
  getDisabledModels,
  getModelAliases,
  getMitmAlias,
  getProviderNodes,
  getSettings,
} from "@/lib/db/index.js";
import { getUserPricingTables } from "@/lib/db/repos/pricingRepo.js";

// GET /api/models/catalog/user/usage - everything a user rule could be
// referenced by: pins (customModels catalogRef), combos, aliases, mitm
// targets, user pricing overrides, capacity-adapter lists, disabled entries,
// and nodes (id/prefix) so the client can canonicalize prefix-scoped forms.
// powers the "Clear Unused" preview client-side; no writes.
export async function GET() {
  try {
    const [customModels, combos, aliases, mitmAlias, userPricing, settings, disabled, nodes] = await Promise.all([
      getCustomModels(),
      getCombos(),
      getModelAliases(),
      getMitmAlias(),
      getUserPricingTables(),
      getSettings(),
      getDisabledModels(),
      getProviderNodes(),
    ]);
    return NextResponse.json({
      customModels: (customModels || [])
        .filter((m) => m?.catalogRef?.source === "user")
        .map((m) => ({ provider: m.catalogRef.provider || "*", pattern: m.catalogRef.pattern })),
      combos: (combos || []).map((c) => ({ id: c.id, name: c.name, models: c.models || [] })),
      aliasTargets: Object.values(aliases || {}),
      mitmAlias: mitmAlias || {},
      userPricing: userPricing || {},
      capacityAdapter: settings?.capacityAdapter || {},
      disabled: disabled || {},
      nodes: (nodes || []).map((n) => ({ id: n.id, prefix: n.prefix })),
    });
  } catch (error) {
    console.error("Error fetching user catalog usage:", error);
    return NextResponse.json({ error: "Failed to fetch usage data" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const entry = validateUserEntry(await request.json());
    return NextResponse.json({ success: true, entry: await saveUserEntry(entry) });
  } catch (error) {
    const { status, body } = errorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function PUT(request) {
  try {
    const body = await request.json();
    const entry = validateUserEntry(body);
    return NextResponse.json({
      success: true,
      entry: await updateUserEntry(body?.originalIdentity, entry),
    });
  } catch (error) {
    const { status, body } = errorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function DELETE(request) {
  try {
    const identity = await request.json();
    await deleteUserEntry(identity);
    return NextResponse.json({ success: true });
  } catch (error) {
    const { status, body } = errorResponse(error);
    return NextResponse.json(body, { status });
  }
}
