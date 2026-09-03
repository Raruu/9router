"use client";

import { useCallback, useEffect, useState } from "react";
import PropTypes from "prop-types";
import Modal from "./Modal";
import ProviderIcon from "./ProviderIcon";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

// Order and labels for the capability object. Kept explicit rather than derived
// from Object.keys so the modal groups modalities before features and never
// renders an internal field the resolver happens to add later.
const INPUT_CAPS = [
  { key: "vision", label: "Images" },
  { key: "pdf", label: "PDF" },
  { key: "audioInput", label: "Audio" },
  { key: "videoInput", label: "Video" },
];
const OUTPUT_CAPS = [
  { key: "imageOutput", label: "Images" },
  { key: "audioOutput", label: "Audio" },
];
const FEATURE_CAPS = [
  { key: "tools", label: "Tool calling" },
  { key: "reasoning", label: "Reasoning" },
  { key: "search", label: "Web search" },
];
const PRICE_FIELDS = [
  { key: "input", label: "Input" },
  { key: "cached", label: "Cached input" },
  { key: "cache_creation", label: "Cache write" },
  { key: "output", label: "Output" },
  { key: "reasoning", label: "Reasoning" },
];

const fmtTokens = (n) => {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1000000) {
    const m = n / 1000000;
    return `${Number.isInteger(m) ? m : m.toFixed(2).replace(/\.?0+$/, "")}M`;
  }
  if (n >= 1000) {
    const k = n / 1000;
    return `${Number.isInteger(k) ? k : k.toFixed(1).replace(/\.0$/, "")}K`;
  }
  return String(n);
};

// Rates are dollars per 1M tokens and span four orders of magnitude
// (0.0125 → 75), so a fixed precision either rounds cheap models to $0.00 or
// pads expensive ones with noise.
const fmtRate = (n) => {
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "Free";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
};

function CapFlag({ label, on }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span
        className={`material-symbols-outlined text-[16px] ${on ? "text-green-600 dark:text-green-500" : "text-text-muted/40"}`}
      >
        {on ? "check_circle" : "remove"}
      </span>
      <span className={on ? "text-text-main" : "text-text-muted"}>{label}</span>
    </div>
  );
}

CapFlag.propTypes = {
  label: PropTypes.string.isRequired,
  on: PropTypes.bool,
};

function Section({ title, children, action }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-text-muted">{title}</h4>
        {action}
      </div>
      {children}
    </div>
  );
}

Section.propTypes = {
  title: PropTypes.string.isRequired,
  children: PropTypes.node,
  action: PropTypes.node,
};

function LimitsRow({ capabilities }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="rounded-lg border border-border bg-bg-alt/40 px-3 py-2">
        <p className="text-[10px] uppercase tracking-wide text-text-muted">Context window</p>
        <p className="font-mono text-lg font-medium" title={`${capabilities.contextWindow} tokens`}>
          {fmtTokens(capabilities.contextWindow)}
        </p>
      </div>
      <div className="rounded-lg border border-border bg-bg-alt/40 px-3 py-2">
        <p className="text-[10px] uppercase tracking-wide text-text-muted">Max output</p>
        <p className="font-mono text-lg font-medium" title={`${capabilities.maxOutput} tokens`}>
          {fmtTokens(capabilities.maxOutput)}
        </p>
      </div>
    </div>
  );
}

LimitsRow.propTypes = {
  capabilities: PropTypes.object.isRequired,
};

function CapabilitiesGrid({ capabilities, thinkingLevels }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <p className="text-[10px] uppercase tracking-wide text-text-muted">Reads</p>
          {INPUT_CAPS.map((c) => (
            <CapFlag key={c.key} label={c.label} on={capabilities[c.key] === true} />
          ))}
        </div>
        <div className="flex flex-col gap-1.5">
          <p className="text-[10px] uppercase tracking-wide text-text-muted">Generates</p>
          {OUTPUT_CAPS.map((c) => (
            <CapFlag key={c.key} label={c.label} on={capabilities[c.key] === true} />
          ))}
        </div>
        <div className="flex flex-col gap-1.5">
          <p className="text-[10px] uppercase tracking-wide text-text-muted">Features</p>
          {FEATURE_CAPS.map((c) => (
            <CapFlag key={c.key} label={c.label} on={capabilities[c.key] === true} />
          ))}
        </div>
      </div>

      {capabilities.reasoning && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border bg-bg-alt/40 px-3 py-2 text-xs">
          <span className="text-text-muted">
            Thinking format{" "}
            <span className="font-mono text-text-main">{capabilities.thinkingFormat || "auto"}</span>
          </span>
          <span className="text-text-muted">
            Can disable{" "}
            <span className="font-mono text-text-main">{capabilities.thinkingCanDisable ? "yes" : "no"}</span>
          </span>
          {capabilities.thinkingRange && (
            <span className="text-text-muted">
              Budget{" "}
              <span className="font-mono text-text-main">
                {capabilities.thinkingRange.min}–{capabilities.thinkingRange.max}
              </span>
            </span>
          )}
          {capabilities.thinkingEffortSupported && (
            <span className="text-text-muted">Accepts reasoning effort</span>
          )}
          {thinkingLevels?.length > 0 && (
            <span className="text-text-muted">
              Levels <span className="font-mono text-text-main">{thinkingLevels.join(", ")}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

CapabilitiesGrid.propTypes = {
  capabilities: PropTypes.object.isRequired,
  thinkingLevels: PropTypes.array,
};

function PricingTable({ pricing, pricingSource }) {
  if (!pricing) {
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-text-muted">
        No pricing data for this model. Usage cost is recorded as $0.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
        {PRICE_FIELDS.map((f) => (
          <div key={f.key} className="flex items-baseline justify-between gap-2 text-xs">
            <span className="text-text-muted">{f.label}</span>
            <span className="font-mono text-text-main">{fmtRate(pricing[f.key])}</span>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-text-muted">
        Per 1M tokens.{" "}
        {pricingSource === "user"
          ? "From your pricing overrides."
          : "Built-in estimate — verify against the provider's own rates."}
      </p>
    </div>
  );
}

PricingTable.propTypes = {
  pricing: PropTypes.object,
  pricingSource: PropTypes.string,
};

function MembersTable({ members }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border bg-bg-alt/40">
            <th className="px-3 py-1.5 text-left font-medium text-text-muted">Member</th>
            <th className="px-3 py-1.5 text-right font-medium text-text-muted">Context</th>
            <th className="px-3 py-1.5 text-right font-medium text-text-muted">Output</th>
            <th className="px-3 py-1.5 text-center font-medium text-text-muted">Caps</th>
            <th className="px-3 py-1.5 text-right font-medium text-text-muted">In / Out</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m, index) => (
            <tr key={`${m.raw}-${index}`} className="border-b border-border/50 last:border-0">
              <td className="max-w-[220px] px-3 py-1.5">
                <span className="block truncate font-mono" title={m.raw}>
                  {m.raw}
                </span>
                {m.unresolved && (
                  <span className="text-[10px] text-amber-600 dark:text-amber-500">unresolved</span>
                )}
                {m.kind === "combo" && (
                  <span className="text-[10px] text-text-muted">nested combo</span>
                )}
              </td>
              <td className="px-3 py-1.5 text-right font-mono text-text-muted">
                {m.capabilities ? fmtTokens(m.capabilities.contextWindow) : "—"}
              </td>
              <td className="px-3 py-1.5 text-right font-mono text-text-muted">
                {m.capabilities ? fmtTokens(m.capabilities.maxOutput) : "—"}
              </td>
              <td className="px-3 py-1.5 text-center">
                <span className="inline-flex items-center gap-1">
                  {m.capabilities?.vision && (
                    <span className="material-symbols-outlined text-[14px] text-blue-500" title="Vision">
                      visibility
                    </span>
                  )}
                  {m.capabilities?.reasoning && (
                    <span className="material-symbols-outlined text-[14px] text-amber-500" title="Reasoning">
                      neurology
                    </span>
                  )}
                  {m.capabilities?.search && (
                    <span className="material-symbols-outlined text-[14px] text-green-600" title="Web search">
                      travel_explore
                    </span>
                  )}
                </span>
              </td>
              <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono text-text-muted">
                {m.pricing ? `${fmtRate(m.pricing.input)} / ${fmtRate(m.pricing.output)}` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

MembersTable.propTypes = {
  members: PropTypes.array.isRequired,
};

/**
 * Read-only detail view for one model or combo. Pass exactly one of `modelId`
 * (a `{prefix}/{model}` string, a model alias, or a combo name) or `comboName`.
 */
export default function ModelDetailModal({ isOpen, onClose, modelId, comboName }) {
  // One state slot holding the target it belongs to, so `loading` is derived
  // rather than set synchronously in the effect (which would trip
  // react-hooks/set-state-in-effect and cascade a render per open).
  const [result, setResult] = useState(null);
  const { copied, copy } = useCopyToClipboard();

  const target = comboName ? `combo=${encodeURIComponent(comboName)}` : `id=${encodeURIComponent(modelId || "")}`;
  const current = result?.target === target ? result : null;
  const loading = isOpen && !current;
  const detail = current?.detail || null;
  const error = current?.error || null;

  useEffect(() => {
    if (!isOpen) return undefined;
    let alive = true;
    fetch(`/api/models/detail?${target}`)
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!alive) return;
        if (!res.ok) {
          setResult({ target, detail: null, error: data?.error || `Request failed (${res.status})` });
          return;
        }
        setResult({ target, detail: data, error: null });
      })
      .catch((e) => {
        if (alive) setResult({ target, detail: null, error: e?.message || "Failed to load model detail" });
      });
    return () => { alive = false; };
  }, [isOpen, target]);

  // Modal registers a document-level Escape handler per instance and none of
  // them stop propagation, so an Escape here would also close the combo form
  // this modal can be opened from. Capture it first and swallow it.
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [isOpen, onClose]);

  // Modal's scroll-lock cleanup clears body overflow unconditionally on
  // unmount. When this modal was opened from another one, that leaves the outer
  // modal open over a scrollable page, so restore the lock on the way out.
  useEffect(() => {
    if (!isOpen) return undefined;
    return () => {
      if (document.querySelectorAll("[data-modal-root]").length > 1) {
        document.body.style.overflow = "hidden";
      }
    };
  }, [isOpen]);

  const handleCopyJson = useCallback(() => {
    if (detail) copy(JSON.stringify(detail, null, 2), "detail-json");
  }, [detail, copy]);

  const isCombo = detail?.type === "combo";
  const title = isCombo ? "Combo Info" : "Model Info";

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="full">
      {loading && (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-text-muted">
          <span className="material-symbols-outlined animate-spin text-[20px]">progress_activity</span>
          Loading...
        </div>
      )}

      {!loading && error && (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <span className="material-symbols-outlined text-[28px] text-red-500">error</span>
          <p className="text-sm text-text-main">{error}</p>
          <p className="font-mono text-xs text-text-muted">{comboName || modelId}</p>
        </div>
      )}

      {!loading && !error && detail && (
        <div className="flex min-w-0 flex-col gap-5">
          {/* Identity */}
          <div className="flex min-w-0 items-start gap-3">
            {isCombo ? (
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <span className="material-symbols-outlined text-[20px] text-primary">layers</span>
              </div>
            ) : (
              <ProviderIcon
                providerId={detail.provider?.id}
                alt={detail.provider?.name || ""}
                size={36}
                className="size-9 shrink-0 rounded-lg object-contain"
                fallbackText={(detail.provider?.name || detail.owned_by || "?").slice(0, 2).toUpperCase()}
              />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <code className="min-w-0 truncate font-mono text-sm font-medium text-text-main">{detail.id}</code>
                <button
                  onClick={() => copy(detail.id, "detail-id")}
                  className="shrink-0 rounded p-0.5 text-text-muted transition-colors hover:bg-surface-2 hover:text-primary"
                  title="Copy id"
                  aria-label="Copy id"
                >
                  <span className="material-symbols-outlined text-[16px]">
                    {copied === "detail-id" ? "check" : "content_copy"}
                  </span>
                </button>
              </div>
              <p className="truncate text-xs text-text-muted">
                {detail.name}
                {!isCombo && detail.provider?.name ? ` · ${detail.provider.name}` : ""}
                {detail.kind && detail.kind !== "llm" ? ` · ${detail.kind}` : ""}
                {detail.source === "unlisted" ? " · not in registry" : ""}
                {detail.source === "custom" ? " · custom model" : ""}
                {detail.requestedAlias ? ` · via alias ${detail.requestedAlias}` : ""}
              </p>
              {detail.registry?.description && (
                <p className="mt-1 text-xs text-text-muted">{detail.registry.description}</p>
              )}
            </div>
          </div>

          {detail.capabilities ? (
            <>
              <Section title="Limits">
                <LimitsRow capabilities={detail.capabilities} />
              </Section>

              <Section title="Capabilities">
                <CapabilitiesGrid
                  capabilities={detail.capabilities}
                  thinkingLevels={detail.thinkingLevels}
                />
              </Section>
            </>
          ) : (
            <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-text-muted">
              {isCombo
                ? "No member resolves to a routable model, so this combo advertises no capabilities."
                : "No capability data for this model."}
            </p>
          )}

          {!isCombo && (
            <Section title="Estimated price">
              <PricingTable pricing={detail.pricing} pricingSource={detail.pricingSource} />
            </Section>
          )}

          {isCombo && (
            <Section
              title={`Members (${detail.members?.length || 0})`}
              action={
                detail.strategy?.fallbackStrategy ? (
                  <span className="text-[10px] text-text-muted">
                    strategy: {detail.strategy.fallbackStrategy}
                  </span>
                ) : null
              }
            >
              {detail.members?.length > 0 ? (
                <>
                  <MembersTable members={detail.members} />
                  <p className="text-[10px] text-text-muted">
                    A combo advertises what its best member delivers: capabilities union, limits
                    take the maximum. Prices are per 1M tokens.
                  </p>
                </>
              ) : (
                <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-text-muted">
                  No models in this combo.
                </p>
              )}
            </Section>
          )}

          {/* Raw payload */}
          <details className="rounded-lg border border-border">
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-text-muted hover:text-text-main">
              Raw JSON
            </summary>
            <div className="border-t border-border p-2">
              <div className="mb-1 flex justify-end">
                <button
                  onClick={handleCopyJson}
                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-text-muted transition-colors hover:bg-surface-2 hover:text-primary"
                >
                  <span className="material-symbols-outlined text-[14px]">
                    {copied === "detail-json" ? "check" : "content_copy"}
                  </span>
                  {copied === "detail-json" ? "Copied" : "Copy"}
                </button>
              </div>
              <pre className="max-h-64 overflow-auto rounded bg-bg-alt/60 p-2 font-mono text-[11px] leading-relaxed text-text-muted">
                {JSON.stringify(detail, null, 2)}
              </pre>
            </div>
          </details>
        </div>
      )}
    </Modal>
  );
}

ModelDetailModal.propTypes = {
  isOpen: PropTypes.bool,
  onClose: PropTypes.func.isRequired,
  modelId: PropTypes.string,
  comboName: PropTypes.string,
};
