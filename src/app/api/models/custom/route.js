import { NextResponse } from "next/server";
import { getCustomModels, addCustomModel, deleteCustomModel, setCustomModelLocked, clearProviderModels } from "@/models";
import { CAPACITY_META, isSttTransport, normalizeCustomModelType, isCustomModelType } from "@/shared/constants/models";
import { THINKING_FORMATS, sanitizeThinkingLevels } from "@/lib/modelCatalog/validation.js";

export const dynamic = "force-dynamic";

// Whitelist capability keys to boolean values — ignore anything else
function sanitizeCaps(caps) {
  if (!caps || typeof caps !== "object") return null;
  const clean = {};
  for (const key of Object.keys(CAPACITY_META)) {
    if (typeof caps[key] === "boolean") clean[key] = caps[key];
  }
  // Thinking overrides are opt-in and validated against the translator's list.
  if (typeof caps.thinkingCanDisable === "boolean") clean.thinkingCanDisable = caps.thinkingCanDisable;
  if (typeof caps.thinkingFormatOverride === "string" && THINKING_FORMATS.includes(caps.thinkingFormatOverride)) {
    clean.thinkingFormatOverride = caps.thinkingFormatOverride;
  }
  const levels = sanitizeThinkingLevels(caps.thinkingLevels);
  if (levels.length) clean.thinkingLevels = levels;
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

// Accepted STT transport markers live in the shared whitelist
// (src/shared/constants/models STT_TRANSPORT_META) — the dashboard transport
// select and this validator must agree on one set, so neither owns a copy.
// Unknown or mistyped values are silently dropped, the same policy
// sanitizeCaps applies to capability keys.
function sanitizeTransport(transport, type) {
  if (type !== "stt" || !isSttTransport(transport)) return null;
  return transport.trim();
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
    const { providerAlias, id, type, name, caps, transport } = body;
    if (!providerAlias || !id) {
      return NextResponse.json({ error: "providerAlias and id required" }, { status: 400 });
    }
    // Unknown kinds normalize to "llm" (the same silently-drop policy
    // sanitizeCaps applies), so a stale client cannot mint an unroutable type.
    const cleanType = isCustomModelType(type) ? type.trim() : normalizeCustomModelType(type);
    const cleanCaps = sanitizeCaps(caps);
    const cleanTransport = sanitizeTransport(transport, cleanType);
    const catalogRef = sanitizeCatalogRef(body.catalogRef);
    // `previousType` moves the record on a kind change instead of duplicating it.
    const previousType = isCustomModelType(body.previousType) ? body.previousType.trim() : null;
    const added = await addCustomModel({
      providerAlias,
      id,
      type: cleanType,
      name,
      ...(cleanCaps ? { caps: cleanCaps } : {}),
      // Transport semantics: a valid whitelisted marker persists; an explicit
      // empty string clears (the modal's "provider default"); an unknown value
      // is silently dropped and leaves the stored marker alone (T14 — a typo
      // must not clobber a working transport). Non-stt types clear in the repo.
      ...(cleanTransport ? { transport: cleanTransport } : transport === "" ? { transport: "" } : {}),
      ...(catalogRef ? { catalogRef } : {}),
      clearCatalogMetadata: Object.hasOwn(body, "catalogRef") && !catalogRef,
      previousType: previousType && previousType !== cleanType ? previousType : null,
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
