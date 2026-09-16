import { NextResponse } from "next/server";
import { getModelAliases, setModelAlias, getCustomModels, getProviderConnections, getProviderNodes } from "@/models";
import { getDisabledModels } from "@/lib/disabledModelsDb";
import { AI_MODELS } from "@/shared/constants/config";
import { getProviderAlias } from "@/shared/constants/providers";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";
import { getThinkingLevels } from "open-sse/providers/thinkingLevels.js";

// GET /api/models - Get models with aliases
export async function GET() {
  try {
    const modelAliases = await getModelAliases();
    const disabled = await getDisabledModels();
    // Compatible nodes are picked and stored under their display prefix
    // ("qwen-3.8/glm-5.3-flash") while capabilities are keyed by the raw node
    // id ("openai-compatible-chat-<uuid>"). Without the prefix form the client
    // lookup misses and combo badges fall back to a global id map that can
    // serve another provider's capabilities.
    const [providerNodes, connections] = await Promise.all([
      getProviderNodes().catch(() => []),
      getProviderConnections().catch(() => []),
    ]);
    const prefixByProvider = new Map();
    for (const node of providerNodes) {
      if (node?.id && typeof node.prefix === "string" && node.prefix.trim()) {
        prefixByProvider.set(node.id, node.prefix.trim());
      }
    }
    for (const conn of connections) {
      const prefix = conn?.providerSpecificData?.prefix;
      if (conn?.provider && typeof prefix === "string" && prefix.trim()) {
        prefixByProvider.set(conn.provider, prefix.trim());
      }
    }

    const models = AI_MODELS
      .filter((m) => {
        const alias = getProviderAlias(m.provider) || m.provider;
        const list = disabled[alias] || disabled[m.provider] || [];
        return !list.includes(m.model);
      })
      .map((m) => {
        const fullModel = `${m.provider}/${m.model}`;
        const providerAlias = getProviderAlias(m.provider) || m.provider;
        const routedModel = `${providerAlias}/${m.model}`;
        const c = getCapabilitiesForModel(m.provider, m.model);
        const levels = getThinkingLevels(m.provider, m.model, c);
        return {
          ...m,
          fullModel,
          routedModel,
          alias: modelAliases[fullModel] || m.model,
          caps: c,
          ...(levels ? { thinkingLevels: levels } : {}),
        };
      });

    // Custom models ride along with capabilities resolved by the live catalog.
    const seenFull = new Set(models.map((m) => m.fullModel));
    const customModels = (await getCustomModels()).filter((m) => {
      if (!m?.id || (m.kind || m.type || "llm") !== "llm") return false;
      return !seenFull.has(`${m.providerAlias}/${m.id}`);
    });
    for (const m of customModels) {
      const fullModel = `${m.providerAlias}/${m.id}`;
      const c = getCapabilitiesForModel(m.providerAlias, m.id);
      const levels = getThinkingLevels(m.providerAlias, m.id, c);
      const prefix = prefixByProvider.get(m.providerAlias);
      const prefixModel = prefix ? `${prefix}/${m.id}` : null;
      models.push({
        provider: m.providerAlias,
        model: m.id,
        name: m.name || m.id,
        fullModel,
        routedModel: fullModel,
        ...(prefixModel && prefixModel !== fullModel ? { prefixModel } : {}),
        alias: modelAliases[fullModel] || m.id,
        caps: c,
        ...(levels ? { thinkingLevels: levels } : {}),
      });
    }

    return NextResponse.json({ models });
  } catch (error) {
    console.log("Error fetching models:", error);
    return NextResponse.json({ error: "Failed to fetch models" }, { status: 500 });
  }
}

// PUT /api/models - Update model alias
export async function PUT(request) {
  try {
    const body = await request.json();
    const { model, alias } = body;

    if (!model || !alias) {
      return NextResponse.json({ error: "Model and alias required" }, { status: 400 });
    }

    const modelAliases = await getModelAliases();

    // Check if alias already exists for different model
    const existingModel = Object.entries(modelAliases).find(
      ([key, val]) => val === alias && key !== model
    );

    if (existingModel) {
      return NextResponse.json({ error: "Alias already in use" }, { status: 400 });
    }

    // Update alias
    await setModelAlias(model, alias);

    return NextResponse.json({ success: true, model, alias });
  } catch (error) {
    console.log("Error updating alias:", error);
    return NextResponse.json({ error: "Failed to update alias" }, { status: 500 });
  }
}
