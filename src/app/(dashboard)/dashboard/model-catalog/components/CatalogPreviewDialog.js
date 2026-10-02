"use client";

import PropTypes from "prop-types";
import { Modal } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import {
  CapabilitiesGrid,
  LimitsRow,
  PricingTable,
  Section,
} from "@/shared/components/ModelInfoSections";
import { buildCatalogEntryView } from "@/shared/utils/catalogEntryView";

// Read-only preview of one catalog row, styled after the Model Info modal.
// Works for all three sources (user rule, OpenRouter, hardcoded): the row is
// normalized by catalogEntryView, nothing here resolves anything at runtime.
export default function CatalogPreviewDialog({ isOpen, entry, onClose }) {
  const { copied, copy } = useCopyToClipboard();
  const view = buildCatalogEntryView(entry);

  if (!view) return null;

  const capabilities = view.capabilities;
  const hasCapabilityData = Object.keys(capabilities).length > 0;
  const provenance = view.provenance;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Catalog Entry" size="full">
      <div className="flex min-w-0 flex-col gap-5">
        {/* Identity */}
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <span className="material-symbols-outlined text-[20px] text-primary">
              {view.source === "openrouter" ? "cloud_download" : view.source === "user" ? "person_edit" : "code"}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <code className="min-w-0 truncate font-mono text-sm font-medium text-text-main" title={view.pattern}>
                {view.pattern}
              </code>
              <button
                onClick={() => copy(view.pattern, "entry-pattern")}
                className="shrink-0 rounded p-0.5 text-text-muted transition-colors hover:bg-surface-2 hover:text-primary"
                title="Copy pattern"
                aria-label="Copy pattern"
              >
                <span className="material-symbols-outlined text-[16px]">
                  {copied === "entry-pattern" ? "check" : "content_copy"}
                </span>
              </button>
            </div>
            <p className="truncate text-xs text-text-muted">
              {view.name ? `${view.name} · ` : ""}
              provider: {view.provider}
              {view.sourceLabel ? ` · ${view.sourceLabel}` : ""}
            </p>
          </div>
          {view.typeLabel && (
            <span className="shrink-0 rounded-md border border-border px-1.5 py-0.5 text-[10px] font-medium text-text-muted">
              {view.typeLabel}
            </span>
          )}
        </div>

        {/* Applied pattern */}
        <Section title="Applied pattern">
          <div className="rounded-lg border border-border bg-bg-alt/40 px-3 py-2">
            <code className="block break-all font-mono text-xs text-text-main">
              [{view.source || "catalog"}] {view.provider} / {view.pattern}
            </code>
            <p className="mt-1 text-[10px] text-text-muted">
              Models matching this pattern inherit the values below.
              {view.source === "hardcoded"
                ? " This row ships with the gateway; a user rule or OpenRouter entry can refine it."
                : ""}
            </p>
          </div>
        </Section>

        {hasCapabilityData ? (
          <>
            {(Number.isFinite(capabilities.contextWindow) || Number.isFinite(capabilities.maxOutput) || Number.isFinite(capabilities.minOutput)) && (
              <Section title="Limits">
                <LimitsRow capabilities={capabilities} />
              </Section>
            )}

            <Section title="Capabilities">
              <CapabilitiesGrid capabilities={capabilities} thinkingLevels={view.thinkingLevels} />
            </Section>
          </>
        ) : (
          <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-text-muted">
            No capabilities in this entry. Lower-priority sources supply them for matching models.
          </p>
        )}

        <Section title="Pricing">
          <PricingTable pricing={view.pricing} pricingSource={view.pricingSource} />
        </Section>

        {provenance && (
          <Section title="OpenRouter provenance">
            <div className="rounded-lg border border-border bg-bg-alt/40 px-3 py-2 text-xs text-text-muted">
              <p>
                source id <span className="font-mono text-text-main">{provenance.sourceId}</span>
                {provenance.variantOnly ? " · variant-only offering" : ""}
              </p>
              {Array.isArray(provenance.sourceIds) && provenance.sourceIds.length > 1 && (
                <p className="mt-1 break-all">
                  merged from <span className="font-mono text-text-main">{provenance.sourceIds.join(", ")}</span>
                </p>
              )}
              {view.fetchedAt && <p className="mt-1">fetched {new Date(view.fetchedAt).toLocaleString()}</p>}
            </div>
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
                onClick={() => copy(JSON.stringify(view.raw, null, 2), "entry-json")}
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-text-muted transition-colors hover:bg-surface-2 hover:text-primary"
              >
                <span className="material-symbols-outlined text-[14px]">
                  {copied === "entry-json" ? "check" : "content_copy"}
                </span>
                {copied === "entry-json" ? "Copied" : "Copy"}
              </button>
            </div>
            <pre className="max-h-64 overflow-auto rounded bg-bg-alt/60 p-2 font-mono text-[11px] leading-relaxed text-text-muted">
              {JSON.stringify(view.raw, null, 2)}
            </pre>
          </div>
        </details>
      </div>
    </Modal>
  );
}

CatalogPreviewDialog.propTypes = {
  isOpen: PropTypes.bool,
  entry: PropTypes.object,
  onClose: PropTypes.func.isRequired,
};
