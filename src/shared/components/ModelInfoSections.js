"use client";

import PropTypes from "prop-types";

// Presentation blocks shared by the model detail modal and the model-catalog
// entry preview. Kept in one place so both dialogs render capabilities, limits
// and pricing identically; ModelDetailModal passes combo-aware props, the
// catalog preview passes a single catalog entry.

export const INPUT_CAPS = [
  { key: "vision", label: "Images" },
  { key: "pdf", label: "PDF" },
  { key: "audioInput", label: "Audio" },
  { key: "videoInput", label: "Video" },
];
export const OUTPUT_CAPS = [
  { key: "imageOutput", label: "Images" },
  { key: "audioOutput", label: "Audio" },
];
export const FEATURE_CAPS = [
  { key: "tools", label: "Tool calling" },
  { key: "reasoning", label: "Reasoning" },
  { key: "search", label: "Web search" },
];
export const PRICE_FIELDS = [
  { key: "input", label: "Input" },
  { key: "cached", label: "Cached input" },
  { key: "cache_creation", label: "Cache write" },
  { key: "output", label: "Output" },
  { key: "reasoning", label: "Reasoning" },
];

export const fmtTokens = (n) => {
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
export const fmtRate = (n) => {
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "Free";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
};

export function CapFlag({ label, on }) {
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

export function Section({ title, children, action }) {
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

export function LimitsRow({ capabilities }) {
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

export function CapabilitiesGrid({ capabilities, thinkingLevels }) {
  // Combos advertise member thinking levels inside capabilities.effort_tiers;
  // direct models keep the legacy thinkingLevels prop. Prefer the former.
  const levels = capabilities.effort_tiers?.length > 0 ? capabilities.effort_tiers : thinkingLevels;
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
          {levels?.length > 0 && (
            <span className="text-text-muted">
              Levels <span className="font-mono text-text-main">{levels.join(", ")}</span>
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

const PRICING_SOURCE_NOTES = {
  user: "From your pricing overrides.",
  "user catalog": "From your model catalog rule.",
  openrouter: "From the fetched OpenRouter catalog.",
};

export function PricingTable({ pricing, pricingSource }) {
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
        Per 1M tokens. {PRICING_SOURCE_NOTES[pricingSource] || "Built-in estimate — verify against the provider's own rates."}
      </p>
    </div>
  );
}

PricingTable.propTypes = {
  pricing: PropTypes.object,
  pricingSource: PropTypes.string,
};
