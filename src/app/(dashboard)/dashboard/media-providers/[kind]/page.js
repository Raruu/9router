"use client";

import { useParams, notFound, useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Card, Badge, Button, Toggle } from "@/shared/components";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { getProviderIconSrcForNode } from "@/shared/utils/providerIcon";
import { MEDIA_PROVIDER_KINDS, AI_PROVIDERS, isCustomEmbeddingProvider } from "@/shared/constants/providers";
import { listProvidersServingKind, customModelKindsByAlias, customNodeServesKind, CUSTOM_CAPABLE_KINDS } from "@/shared/utils/providerKinds";

// Kinds that support combos (currently disabled for image/tts — temporarily hidden).
// webSearch/webFetch handled by /web page.
const COMBO_KINDS = new Set([]);
const COMBO_BASE_NAMES = { image: "image-combo", tts: "tts-combo" };

function getEffectiveStatus(conn) {
  const isCooldown = Object.entries(conn).some(
    ([k, v]) => k.startsWith("modelLock_") && v && new Date(v).getTime() > Date.now()
  );
  return conn.testStatus === "unavailable" && !isCooldown ? "active" : conn.testStatus;
}

function MediaProviderCard({ provider, kind, connections, isCustom, onToggle, href }) {
  const providerInfo = AI_PROVIDERS[provider.id];
  const isNoAuth = !!providerInfo?.noAuth;

  const providerConns = connections.filter((c) => c.provider === provider.id);
  const connected = providerConns.filter((c) => { const s = getEffectiveStatus(c); return s === "active" || s === "success"; }).length;
  const error = providerConns.filter((c) => { const s = getEffectiveStatus(c); return s === "error" || s === "expired" || s === "unavailable"; }).length;
  const total = providerConns.length;
  const allDisabled = total > 0 && providerConns.every((c) => c.isActive === false);

  const handleToggleClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (onToggle) onToggle(provider.id, allDisabled);
  };

  const renderStatus = () => {
    if (isNoAuth) return <Badge variant="success" size="sm">Ready</Badge>;
    if (allDisabled) return <Badge variant="default" size="sm">Disabled</Badge>;
    if (total === 0) return <span className="text-xs text-text-muted">No connections</span>;
    return (
      <>
        {connected > 0 && <Badge variant="success" size="sm" dot>{connected} Connected</Badge>}
        {error > 0 && <Badge variant="error" size="sm" dot>{error} Error</Badge>}
        {connected === 0 && error === 0 && <Badge variant="default" size="sm">{total} Added</Badge>}
      </>
    );
  };

  return (
    <Link href={href || `/dashboard/media-providers/${kind}/${provider.id}`} className="group">
      <Card
        padding="xs"
        className={`h-full hover:bg-black/[0.01] dark:hover:bg-white/[0.01] transition-colors cursor-pointer ${allDisabled ? "opacity-50" : ""}`}
      >
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className="size-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ backgroundColor: `${provider.color?.length > 7 ? provider.color : (provider.color ?? "#888") + "15"}` }}
            >
              <ProviderIcon
                src={getProviderIconSrcForNode(provider.id, provider.iconVersion, provider.apiType)}
                alt={provider.name}
                size={30}
                className="object-contain rounded-lg max-w-[30px] max-h-[30px]"
                fallbackText={provider.textIcon || provider.id.slice(0, 2).toUpperCase()}
                fallbackColor={provider.color}
              />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-sm">{provider.name}</h3>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                {isCustom && <Badge variant="default" size="sm">Custom</Badge>}
                {renderStatus()}
              </div>
            </div>
          </div>
          {total > 0 && (
            <div
              className="shrink-0 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100"
              onClick={handleToggleClick}
            >
              <Toggle
                size="sm"
                checked={!allDisabled}
                onChange={() => {}}
                title={allDisabled ? "Enable provider" : "Disable provider"}
              />
            </div>
          )}
        </div>
      </Card>
    </Link>
  );
}

function ComboList({ combos }) {
  if (combos.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {combos.map((combo) => (
        <Link key={combo.id} href={`/dashboard/media-providers/combo/${combo.id}`}>
          <Card padding="xs" className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors cursor-pointer">
            <div className="flex min-w-0 items-center gap-3">
              <span className="material-symbols-outlined text-primary text-[18px]">layers</span>
              <code className="text-sm font-mono font-medium flex-1 truncate">{combo.name}</code>
              <div className="flex flex-wrap items-center gap-1 sm:shrink-0">
                {combo.models.slice(0, 6).map((entry, i) => {
                  const pid = typeof entry === "string" ? entry.split("/")[0] : "";
                  const p = AI_PROVIDERS[pid];
                  return (
                    <div key={`${entry}-${i}`} title={p?.name || entry} className="size-5 rounded flex items-center justify-center" style={{ backgroundColor: `${(p?.color ?? "#888")}15` }}>
                      <ProviderIcon
                        src={`/providers/${pid}.png`}
                        alt={p?.name || pid}
                        size={18}
                        className="object-contain rounded max-w-[18px] max-h-[18px]"
                        fallbackText={p?.textIcon || pid.slice(0, 2).toUpperCase()}
                        fallbackColor={p?.color}
                      />
                    </div>
                  );
                })}
                {combo.models.length > 6 && (
                  <span className="text-[10px] text-text-muted ml-1">+{combo.models.length - 6}</span>
                )}
              </div>
              <span className="text-[11px] text-text-muted shrink-0">{combo.models.length}</span>
              <span className="material-symbols-outlined text-text-muted text-[16px]">chevron_right</span>
            </div>
          </Card>
        </Link>
      ))}
    </div>
  );
}

export default function MediaProviderKindPage() {
  const { kind } = useParams();
  const router = useRouter();
  const [connections, setConnections] = useState([]);
  // null = fetch still in flight. The custom section renders a circle loader
  // until both settle, so the cards never pop in silently; a failed fetch
  // resolves to [] rather than leaving the spinner up forever.
  const [customNodes, setCustomNodes] = useState(null);
  const [customModels, setCustomModels] = useState(null);
  const [combos, setCombos] = useState([]);

  // webSearch/webFetch listing pages are merged into /web
  useEffect(() => {
    if (kind === "webSearch" || kind === "webFetch") {
      router.replace("/dashboard/media-providers/web");
    }
  }, [kind, router]);

  const kindConfig = MEDIA_PROVIDER_KINDS.find((k) => k.id === kind);
  const supportsCombo = COMBO_KINDS.has(kind);

  useEffect(() => {
    if (!kindConfig) return;
    fetch("/api/providers", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setConnections(d.connections || []))
      .catch(() => {});
    // Nodes + custom models drive the union listing: a compatible node with
    // media models must appear here, and a chat provider that only gained a
    // custom media model must too.
    fetch("/api/provider-nodes", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setCustomNodes(d.nodes || []))
      .catch(() => setCustomNodes([]));
    fetch("/api/models/custom", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setCustomModels(d.models || []))
      .catch(() => setCustomModels([]));
    if (supportsCombo) {
      fetch("/api/combos", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => setCombos(d.combos || []))
        .catch(() => {});
    }
  }, [supportsCombo, kindConfig]);

  const customKindsByAlias = useMemo(() => customModelKindsByAlias(customModels ?? []), [customModels]);

  if (!kindConfig) return notFound();

  const customProvidersReady = customNodes !== null && customModels !== null;

  // Built-ins that serve this kind: declared, or carrying models of it (the
  // registry declarations drifted before; the model list is the ground truth).
  const providers = listProvidersServingKind(kind, { customModels: customModels ?? [] });
  const kindCombos = combos.filter((c) => c.kind === kind);

  // Custom providers are listed separately from the built-ins. A node only
  // qualifies when it can dispatch this kind AND actually carries a model of it
  // (except custom-embedding nodes, which live on the embedding page); the card
  // links to the provider page, which owns connections, per-kind endpoints and
  // model management.
  const customProviders = (customNodes ?? [])
    .filter((n) => customNodeServesKind(n, kind, customKindsByAlias))
    .map((n) => ({
      id: n.id,
      name: n.name || (n.type === "custom-embedding" ? "Custom Embedding" : "Custom Provider"),
      color: n.type === "custom-embedding" ? "#6366F1" : (n.type === "anthropic-compatible" ? "#D97757" : "#10A37F"),
      textIcon: n.type === "custom-embedding" ? "CE" : (n.type === "anthropic-compatible" ? "AC" : "OC"),
      prefix: n.prefix,
      // Compatible nodes have no /providers asset: the card resolves the
      // uploaded icon (served by /api/provider-nodes/{id}/icon) and then the
      // generic per-API-type fallback from these two fields.
      iconVersion: n.iconVersion,
      apiType: n.apiType,
    }));

  // The custom section exists for the kinds a user-created node can dispatch;
  // web kinds and music have no compat endpoint, so it would always be empty.
  const showCustomSection = CUSTOM_CAPABLE_KINDS.has(kind);
  const hasAnyProvider = providers.length > 0 || customProviders.length > 0;

  const handleToggleProvider = async (providerId, newActive) => {
    const providerConns = connections.filter((c) => c.provider === providerId);
    setConnections((prev) =>
      prev.map((c) => (c.provider === providerId ? { ...c, isActive: newActive } : c))
    );
    await Promise.allSettled(
      providerConns.map((c) =>
        fetch(`/api/providers/${c.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive: newActive }),
        })
      )
    );
  };

  const handleCreateCombo = async () => {
    const base = COMBO_BASE_NAMES[kind] || `${kind}-combo`;
    let name = base;
    let i = 1;
    const existing = new Set(combos.map((c) => c.name));
    while (existing.has(name)) { name = `${base}-${i++}`; }
    const res = await fetch("/api/combos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, models: [], kind }),
    });
    if (res.ok) {
      const created = await res.json();
      router.push(`/dashboard/media-providers/combo/${created.id}`);
    } else {
      const err = await res.json();
      alert(err.error || "Failed to create combo");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {supportsCombo && (
        <div className="flex items-center justify-end gap-2">
          <Button size="sm" icon="add" onClick={handleCreateCombo}>Create Combo</Button>
        </div>
      )}

      {supportsCombo && kindCombos.length > 0 && (
        <ComboList combos={kindCombos} />
      )}

      {providers.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {providers.map((provider) => (
            <MediaProviderCard
              key={provider.id}
              provider={provider}
              kind={kind}
              connections={connections}
              onToggle={handleToggleProvider}
            />
          ))}
        </div>
      )}

      {showCustomSection && (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-text-muted">Custom Providers</h2>
          {!customProvidersReady ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-text-muted">
              <span className="material-symbols-outlined animate-spin text-[20px]">progress_activity</span>
              Loading custom providers...
            </div>
          ) : customProviders.length === 0 ? (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-border py-4 text-sm text-text-muted">
              <span className="material-symbols-outlined text-[18px]">extension</span>
              <span>
                No custom providers — add one from the{" "}
                <Link href="/dashboard/providers" className="font-medium text-primary hover:underline">
                  Providers page
                </Link>
              </span>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {customProviders.map((provider) => (
                <MediaProviderCard
                  key={provider.id}
                  provider={provider}
                  kind={kind}
                  connections={connections}
                  isCustom
                  onToggle={handleToggleProvider}
                  // Compatible nodes are managed on the provider page
                  // (connections, per-kind endpoints, kind-grouped models);
                  // custom-embedding nodes keep their media detail page.
                  href={isCustomEmbeddingProvider(provider.id)
                    ? `/dashboard/media-providers/${kind}/${provider.id}`
                    : `/dashboard/providers/${provider.id}`}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Kinds without a custom section (web kinds, music) are the only ones
          that can read as empty at the page level — a custom-capable kind
          always shows the section above, whose hint covers this case. */}
      {!hasAnyProvider && !showCustomSection && (
        <div className="text-center py-12 border border-dashed border-border rounded-xl text-text-muted text-sm">
          No providers support <strong>{kindConfig.label}</strong> yet.
        </div>
      )}
    </div>
  );
}
