import { NextResponse } from "next/server";
import { getCombos, getComboByName, getCustomModels, getModelAliases, getProviderConnections, getProviderNodes, getSettings } from "@/lib/localDb";
import { getPricingForModel, getUserPricingTables } from "@/lib/db/repos/pricingRepo.js";
import { buildProviderIdByPrefix } from "@/lib/providerPrefixMap";
import { PROVIDER_MODELS, getModelKind } from "@/shared/constants/models";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";
import { comboCapabilities, mergeMemberCapabilities, resolveComboMember } from "open-sse/providers/comboCapabilities.js";
import { getThinkingLevels } from "open-sse/providers/thinkingLevels.js";

const LLM_KIND = "llm";

// Built-in tables answer for most models; a row in the pricing kv scope means
// the user overrode it. Worth surfacing, because the modal labels these numbers
// as estimates and "your own override" is not an estimate.
async function resolvePricing(providerId, modelId) {
  const [resolved, userTables] = await Promise.all([
    getPricingForModel(providerId, modelId),
    getUserPricingTables().catch(() => null),
  ]);
  if (!resolved) return { pricing: null, pricingSource: null };
  const isUserOverride = Boolean(userTables?.[providerId]?.[modelId]);
  return { pricing: resolved, pricingSource: isUserOverride ? "user" : "builtin" };
}

// Registry metadata that has no home in the capability object but is useful on a
// detail screen. Absent for custom/user-added models.
function findRegistryModel(prefix, providerId, modelId) {
  const list = PROVIDER_MODELS[prefix] || PROVIDER_MODELS[providerId] || [];
  return list.find((m) => m.id === modelId) || null;
}

function buildModelDetail({ prefix, providerId, modelId, registryModel, capabilities, pricing, pricingSource, nodeNameById }) {
  const providerInfo = AI_PROVIDERS[providerId];
  const kind = registryModel ? getModelKind(registryModel, LLM_KIND) : LLM_KIND;
  const detail = {
    type: "model",
    id: `${prefix}/${modelId}`,
    object: "model",
    owned_by: prefix,
    name: registryModel?.name || modelId,
    kind,
    provider: {
      id: providerId,
      alias: prefix,
      // Compat provider nodes are not in the registry; prefer the node's
      // display name over leaking the raw "openai-compatible-chat-<uuid>" id.
      name: providerInfo?.name || nodeNameById?.get(providerId) || providerId,
    },
    capabilities,
    // Mirrored under the snake_case names /v1/models emits, so the two surfaces
    // report a model the same way.
    context_length: capabilities.contextWindow,
    max_completion_tokens: capabilities.maxOutput,
    pricing,
    pricingSource,
  };
  if (capabilities.reasoning) {
    detail.thinkingLevels = getThinkingLevels(providerId, modelId) || null;
  }
  const registry = {};
  if (registryModel?.contextLength) registry.contextLength = registryModel.contextLength;
  if (registryModel?.rateMultiplier) registry.rateMultiplier = registryModel.rateMultiplier;
  if (registryModel?.description) registry.description = registryModel.description;
  if (Object.keys(registry).length > 0) detail.registry = registry;
  return detail;
}

async function modelDetail(fullId, ctx) {
  const separator = fullId.indexOf("/");
  if (separator <= 0) return null;
  const prefix = fullId.slice(0, separator);
  const modelId = fullId.slice(separator + 1).trim();
  if (!modelId) return null;

  const providerId = ctx.providerIdByPrefix.get(prefix) || prefix;
  const capabilities = getCapabilitiesForModel(providerId, modelId);
  const { pricing, pricingSource } = await resolvePricing(providerId, modelId);

  return buildModelDetail({
    prefix,
    providerId,
    modelId,
    registryModel: findRegistryModel(prefix, providerId, modelId),
    capabilities,
    pricing,
    pricingSource,
    nodeNameById: ctx.nodeNameById,
  });
}

// One row per combo member. A member that resolves to nothing routable is kept
// and flagged rather than dropped, so a typo in a combo is visible here instead
// of silently shrinking the list.
async function comboMemberDetail(member, ctx) {
  const raw = typeof member === "string" ? member : String(member ?? "");
  const trimmed = raw.trim();

  if (trimmed && !trimmed.includes("/")) {
    const nested = ctx.comboByName.get(trimmed);
    if (nested) {
      return {
        raw,
        resolved: trimmed,
        name: trimmed,
        kind: "combo",
        capabilities: comboCapabilities(nested, ctx) || null,
        pricing: null,
      };
    }
    const aliasTarget = ctx.modelAliases?.[trimmed];
    if (typeof aliasTarget === "string" && aliasTarget.includes("/")) {
      const detail = await modelDetail(aliasTarget, ctx);
      if (detail) {
        return {
          raw,
          resolved: aliasTarget,
          name: detail.name,
          kind: detail.kind,
          capabilities: detail.capabilities,
          pricing: detail.pricing,
          pricingSource: detail.pricingSource,
        };
      }
    }
    return { raw, resolved: null, name: trimmed, unresolved: true, capabilities: null, pricing: null };
  }

  const parsed = resolveComboMember(trimmed, ctx);
  if (!parsed) {
    return { raw, resolved: null, name: trimmed, unresolved: true, capabilities: null, pricing: null };
  }
  const detail = await modelDetail(trimmed, ctx);
  if (!detail) {
    return { raw, resolved: null, name: trimmed, unresolved: true, capabilities: null, pricing: null };
  }
  return {
    raw,
    resolved: detail.id,
    name: detail.name,
    kind: detail.kind,
    capabilities: detail.capabilities,
    pricing: detail.pricing,
    pricingSource: detail.pricingSource,
  };
}

async function comboDetail(combo, ctx) {
  const members = [];
  for (const member of combo.models || []) {
    members.push(await comboMemberDetail(member, ctx));
  }

  // Merge from the same member capabilities the rows show, so the headline
  // numbers and the table can never disagree.
  const capabilities = mergeMemberCapabilities(
    members.map((m) => m.capabilities).filter(Boolean),
    ctx.comboLimitStrategy,
  );

  const detail = {
    type: "combo",
    id: combo.name,
    object: "model",
    owned_by: "combo",
    name: combo.name,
    kind: combo.kind || LLM_KIND,
    strategy: ctx.comboStrategies?.[combo.name] || null,
    comboLimitStrategy: ctx.comboLimitStrategy === "min" ? "min" : "max",
    capabilities,
    members,
  };
  if (capabilities) {
    detail.context_length = capabilities.contextWindow;
    detail.max_completion_tokens = capabilities.maxOutput;
  }
  return detail;
}

async function buildContext() {
  const [connections, combos, modelAliases, settings, nodes] = await Promise.all([
    getProviderConnections().catch(() => []),
    getCombos().catch(() => []),
    getModelAliases().catch(() => ({})),
    getSettings().catch(() => ({})),
    getProviderNodes().catch(() => []),
  ]);

  const nodeNameById = new Map();
  for (const node of nodes) {
    if (node?.id && typeof node.name === "string" && node.name.trim()) {
      nodeNameById.set(node.id, node.name.trim());
    }
  }

  const comboByName = new Map();
  for (const combo of combos) {
    if (typeof combo?.name !== "string") continue;
    if ((combo.kind || LLM_KIND) !== LLM_KIND) continue;
    if (!comboByName.has(combo.name)) comboByName.set(combo.name, combo);
  }

  return {
    providerIdByPrefix: buildProviderIdByPrefix(connections),
    nodeNameById,
    modelAliases,
    comboByName,
    comboStrategies: settings?.comboStrategies || {},
    comboLimitStrategy: settings?.comboLimitStrategy,
  };
}

// GET /api/models/detail?id={prefix}/{model} | ?combo={name}
// Read-only metadata for one model or combo: the full capability object,
// token limits, and resolved pricing. Dashboard-only (the /api/models prefix is
// auth-gated), and unlike /v1/models it ignores the modelsExposure setting so a
// combos-only install can still inspect a member model.
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const comboName = searchParams.get("combo");

    if (!id && !comboName) {
      return NextResponse.json(
        { error: "Missing required query param: id or combo" },
        { status: 400 },
      );
    }

    const ctx = await buildContext();

    if (comboName) {
      const combo = ctx.comboByName.get(comboName) || (await getComboByName(comboName));
      if (!combo) {
        return NextResponse.json({ error: `Combo not found: ${comboName}` }, { status: 404 });
      }
      return NextResponse.json(await comboDetail(combo, ctx));
    }

    if (!id.includes("/")) {
      // A bare id is a model alias or a combo name — resolve it the way routing
      // does (combos before aliases) instead of 404ing on a valid input.
      const combo = ctx.comboByName.get(id) || (await getComboByName(id));
      if (combo) return NextResponse.json(await comboDetail(combo, ctx));
      const aliasTarget = ctx.modelAliases?.[id];
      if (typeof aliasTarget === "string" && aliasTarget.includes("/")) {
        const detail = await modelDetail(aliasTarget, ctx);
        if (detail) return NextResponse.json({ ...detail, requestedAlias: id });
      }
      return NextResponse.json({ error: `Model not found: ${id}` }, { status: 404 });
    }

    const detail = await modelDetail(id, ctx);
    if (!detail) {
      return NextResponse.json({ error: `Model not found: ${id}` }, { status: 404 });
    }

    // Flag ids that match neither the registry nor a user-added custom model, so
    // the modal can say the numbers are pattern-derived rather than declared.
    if (!findRegistryModel(detail.owned_by, detail.provider.id, id.slice(id.indexOf("/") + 1))) {
      const customModels = await getCustomModels().catch(() => []);
      const modelId = id.slice(id.indexOf("/") + 1);
      const isCustom = customModels.some(
        (m) => m?.id === modelId && (m.providerAlias === detail.owned_by || m.providerAlias === detail.provider.id),
      );
      detail.source = isCustom ? "custom" : "unlisted";
    } else {
      detail.source = "registry";
    }

    return NextResponse.json(detail);
  } catch (error) {
    console.log("Error building model detail:", error);
    return NextResponse.json({ error: "Failed to build model detail" }, { status: 500 });
  }
}
