"use client";

import PropTypes from "prop-types";
import CapacityBadges from "@/shared/components/CapacityBadges";

const CATALOG_CAPABILITY_KEYS = ["vision", "pdf", "audioInput", "videoInput", "imageOutput", "audioOutput", "tools", "reasoning"];

function first(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function rowCapabilities(row) {
  const capabilities = row.capabilities ?? row.caps ?? row.data?.capabilities ?? row.data?.caps ?? {};
  const input = row.modalities?.input ?? capabilities.modalities?.input ?? [];
  const output = row.modalities?.output ?? capabilities.modalities?.output ?? [];
  return {
    ...capabilities,
    vision: first(capabilities.vision, input.includes("image")),
    pdf: first(capabilities.pdf, input.includes("pdf")),
    audioInput: first(capabilities.audioInput, input.includes("audio")),
    videoInput: first(capabilities.videoInput, input.includes("video")),
    imageOutput: first(capabilities.imageOutput, output.includes("image")),
    audioOutput: first(capabilities.audioOutput, output.includes("audio")),
    tools: first(capabilities.tools, row.tool_call, row.supported_parameters?.includes?.("tools")),
    reasoning: first(capabilities.reasoning, row.reasoning),
  };
}

function rowPricing(row) {
  return row.pricing ?? row.cost ?? row.data?.pricing ?? row.data?.cost ?? {};
}

function rowIdentity(row) {
  const pattern = first(row.pattern, row.model, row.modelId, row.id, "Unknown model");
  const provider = first(row.provider, row.providerId, row.provider_slug, "*");
  return { pattern: String(pattern), provider: String(provider) };
}

function formatTokens(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "-";
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(number % 1_000_000 ? 1 : 0)}M`;
  if (number >= 1_000) return `${Math.round(number / 1_000)}K`;
  return String(number);
}

function pricePerMillion(value, alreadyPerMillion = false) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  const normalized = alreadyPerMillion ? number : number * 1_000_000;
  return `$${normalized.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
}

function Limits({ row }) {
  const capabilities = row.capabilities ?? row.caps ?? row.data?.capabilities ?? row.data?.caps ?? {};
  const context = first(
    row.contextWindow,
    row.context_length,
    row.limit?.context,
    row.top_provider?.context_length,
    capabilities.contextWindow,
  );
  const output = first(
    row.maxOutput,
    row.max_completion_tokens,
    row.limit?.output,
    row.top_provider?.max_completion_tokens,
    capabilities.maxOutput,
  );
  return (
    <span className="font-mono text-xs text-text-muted tabular-nums">
      {formatTokens(context)} / {formatTokens(output)}
    </span>
  );
}

Limits.propTypes = { row: PropTypes.object.isRequired };

function CapabilityBadges({ row }) {
  const capabilities = rowCapabilities(row);
  const enabled = Object.fromEntries(CATALOG_CAPABILITY_KEYS.map((key) => [key, capabilities[key] === true]));
  if (!Object.values(enabled).some(Boolean)) return <span className="text-xs text-text-muted">Text/default</span>;
  return <CapacityBadges caps={enabled} className="flex-wrap gap-1" />;
}

CapabilityBadges.propTypes = { row: PropTypes.object.isRequired };

function Pricing({ row }) {
  const pricing = rowPricing(row);
  // Every normalized catalog record uses the gateway's $/1M token convention.
  const alreadyPerMillion = row.pricingUnit === "per_million" || row.pricingPerMillion === true || row.data?.pricing !== undefined;
  const input = pricePerMillion(first(pricing.input, pricing.prompt, pricing.inputPerMillion), alreadyPerMillion || pricing.inputPerMillion !== undefined);
  const output = pricePerMillion(first(pricing.output, pricing.completion, pricing.outputPerMillion), alreadyPerMillion || pricing.outputPerMillion !== undefined);
  if (!input && !output) return <span className="text-xs text-text-muted">-</span>;
  return <span className="font-mono text-xs text-text-muted">{input ?? "-"} / {output ?? "-"}</span>;
}

Pricing.propTypes = { row: PropTypes.object.isRequired };

function TypeBadge({ row }) {
  const type = first(row.recordType, row.record_type, row.type, row.matchType, row.pattern?.includes?.("*") ? "Pattern" : null);
  if (!type) return null;
  const normalized = String(type).toLowerCase().replace(/[\s_-]+/g, " ");
  const label = {
    canonical: "Canonical exact",
    "canonical exact": "Canonical exact",
    "provider exact": "Provider exact",
    provider: "Provider exact",
    exact: "Exact",
    glob: "Ordered glob",
    pattern: "Ordered glob",
    "ordered glob": "Ordered glob",
  }[normalized] || type;
  return (
    <span className="rounded-md border border-border px-1.5 py-0.5 text-[10px] font-medium text-text-muted">
      {label}
    </span>
  );
}

TypeBadge.propTypes = { row: PropTypes.object.isRequired };

function Actions({ row, onEdit, onDelete }) {
  if (!onEdit && !onDelete) return null;
  return (
    <div className="flex shrink-0 items-center justify-end gap-1">
      {onEdit && (
        <button type="button" onClick={() => onEdit(row)} className="rounded-lg p-1.5 text-text-muted hover:bg-surface-2 hover:text-primary" aria-label="Edit entry">
          <span className="material-symbols-outlined text-[17px]">edit</span>
        </button>
      )}
      {onDelete && (
        <button type="button" onClick={() => onDelete(row)} className="rounded-lg p-1.5 text-text-muted hover:bg-red-500/10 hover:text-red-500" aria-label="Delete entry">
          <span className="material-symbols-outlined text-[17px]">delete</span>
        </button>
      )}
    </div>
  );
}

Actions.propTypes = {
  row: PropTypes.object.isRequired,
  onEdit: PropTypes.func,
  onDelete: PropTypes.func,
};

export function matchesCatalogRow(row, search, capability) {
  if (capability !== "all" && rowCapabilities(row)[capability] !== true) return false;
  const query = search.trim().toLowerCase();
  if (!query) return true;
  const { pattern, provider } = rowIdentity(row);
  return [pattern, provider, row.name, row.type, row.recordType, row.record_type, row.matchType, row.sourceId]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(query));
}

export default function CatalogTable({ rows, emptyText, onEdit, onDelete }) {
  if (!rows.length) {
    return (
      <div className="flex min-h-24 items-center justify-center rounded-xl border border-dashed border-border text-sm text-text-muted">
        {emptyText}
      </div>
    );
  }

  return (
    <>
      <div className="hidden overflow-hidden rounded-xl border border-border md:block">
        <table className="w-full table-fixed text-left">
          <thead className="bg-surface-2/70 text-[11px] uppercase tracking-wide text-text-muted">
            <tr>
              <th className="w-[36%] px-3 py-2 font-semibold">Model / Pattern</th>
              <th className="w-[26%] px-3 py-2 font-semibold">Capabilities</th>
              <th className="w-[14%] px-3 py-2 font-semibold">Context / Out</th>
              <th className="w-[16%] px-3 py-2 font-semibold">Input / Output</th>
              <th className="w-[8%] px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {rows.map((row, index) => {
              const { pattern, provider } = rowIdentity(row);
              return (
                <tr key={row.id ?? `${provider}:${pattern}:${index}`} className="hover:bg-surface-2/40">
                  <td className="px-3 py-2.5 align-top">
                    <div className="flex min-w-0 items-center gap-2">
                      <code className="truncate text-xs font-semibold text-text-main" title={pattern}>{pattern}</code>
                      <TypeBadge row={row} />
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-text-muted">{row.name || provider}</p>
                  </td>
                  <td className="px-3 py-2.5 align-top"><CapabilityBadges row={row} /></td>
                  <td className="px-3 py-2.5 align-top"><Limits row={row} /></td>
                  <td className="px-3 py-2.5 align-top"><Pricing row={row} /></td>
                  <td className="px-2 py-1.5 align-top"><Actions row={row} onEdit={onEdit} onDelete={onDelete} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid gap-2 md:hidden">
        {rows.map((row, index) => {
          const { pattern, provider } = rowIdentity(row);
          return (
            <article key={row.id ?? `${provider}:${pattern}:${index}`} className="rounded-xl border border-border bg-surface-2/30 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <code className="truncate text-xs font-semibold" title={pattern}>{pattern}</code>
                    <TypeBadge row={row} />
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-text-muted">{row.name || provider}</p>
                </div>
                <Actions row={row} onEdit={onEdit} onDelete={onDelete} />
              </div>
              <div className="mt-2"><CapabilityBadges row={row} /></div>
              <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border-subtle pt-2">
                <div><p className="text-[10px] uppercase text-text-muted">Context / Out</p><Limits row={row} /></div>
                <div><p className="text-[10px] uppercase text-text-muted">Input / Output</p><Pricing row={row} /></div>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}

CatalogTable.propTypes = {
  rows: PropTypes.arrayOf(PropTypes.object).isRequired,
  emptyText: PropTypes.string.isRequired,
  onEdit: PropTypes.func,
  onDelete: PropTypes.func,
};
