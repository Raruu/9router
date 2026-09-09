import { NextResponse } from "next/server";
import { getCustomModels, addCustomModel, deleteCustomModel, setCustomModelLocked, clearProviderModels } from "@/models";
import { CAPACITY_META } from "@/shared/constants/models";

export const dynamic = "force-dynamic";

// Whitelist capability keys to boolean values — ignore anything else
function sanitizeCaps(caps) {
  if (!caps || typeof caps !== "object") return null;
  const clean = {};
  for (const key of Object.keys(CAPACITY_META)) {
    if (typeof caps[key] === "boolean") clean[key] = caps[key];
  }
  return Object.keys(clean).length ? clean : null;
}

const CATALOG_SOURCES = new Set(["user", "openrouter", "hardcoded"]);

function sanitizeCatalogRef(ref) {
  if (ref === null || ref === undefined) return null;
  if (!ref || typeof ref !== "object" || Array.isArray(ref)) throw new Error("Invalid catalog pattern");
  const source = String(ref.source || "").trim().toLowerCase();
  const provider = String(ref.provider || "*").trim().toLowerCase();
  const pattern = String(ref.pattern || "").trim();
  if (!CATALOG_SOURCES.has(source) || !provider || !pattern || pattern.length > 512) throw new Error("Invalid catalog pattern");
  return { source, provider, pattern };
}

// GET /api/models/custom - List all custom models
export async function GET() {
  try {
    const models = await getCustomModels();
    return NextResponse.json({ models });
  } catch (error) {
    console.log("Error fetching custom models:", error);
    return NextResponse.json({ error: "Failed to fetch custom models" }, { status: 500 });
  }
}

// POST /api/models/custom - Add custom model
export async function POST(request) {
  try {
    const body = await request.json();
    const { providerAlias, id, type, name, caps } = body;
    if (!providerAlias || !id) {
      return NextResponse.json({ error: "providerAlias and id required" }, { status: 400 });
    }
    const cleanCaps = sanitizeCaps(caps);
    const catalogRef = sanitizeCatalogRef(body.catalogRef);
    const added = await addCustomModel({
      providerAlias,
      id,
      type: type || "llm",
      name,
      ...(cleanCaps ? { caps: cleanCaps } : {}),
      ...(catalogRef ? { catalogRef } : {}),
      clearCatalogMetadata: Object.hasOwn(body, "catalogRef") && !catalogRef,
    });
    return NextResponse.json({ success: true, added });
  } catch (error) {
    console.log("Error adding custom model:", error);
    const invalidCatalogRef = error?.message === "Invalid catalog pattern";
    return NextResponse.json({ error: invalidCatalogRef ? error.message : "Failed to add custom model" }, { status: invalidCatalogRef ? 400 : 500 });
  }
}

// PUT /api/models/custom - Toggle the locked (bulk-clear protection) flag
export async function PUT(request) {
  try {
    const body = await request.json();
    const { providerAlias, id, type, locked } = body;
    if (!providerAlias || !id) {
      return NextResponse.json({ error: "providerAlias and id required" }, { status: 400 });
    }
    if (typeof locked !== "boolean") {
      return NextResponse.json({ error: "locked must be a boolean" }, { status: 400 });
    }
    const updated = await setCustomModelLocked({ providerAlias, id, type: type || "llm", locked });
    if (!updated) {
      return NextResponse.json({ error: "Custom model not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, locked });
  } catch (error) {
    console.log("Error updating custom model lock:", error);
    return NextResponse.json({ error: "Failed to update custom model" }, { status: 500 });
  }
}

// DELETE /api/models/custom?providerAlias=xxx&id=yyy&type=zzz
// Without `id`: remove every custom model of the provider except locked ones,
// plus all legacy aliases pointing at that provider.
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const providerAlias = searchParams.get("providerAlias");
    const id = searchParams.get("id");
    const type = searchParams.get("type") || "llm";
    if (!providerAlias) {
      return NextResponse.json({ error: "providerAlias required" }, { status: 400 });
    }
    if (!id) {
      const result = await clearProviderModels(providerAlias);
      return NextResponse.json({ success: true, ...result });
    }
    await deleteCustomModel({ providerAlias, id, type });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error deleting custom model:", error);
    return NextResponse.json({ error: "Failed to delete custom model" }, { status: 500 });
  }
}
