"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Button, Input, Modal, Select } from "@/shared/components";
import {
  SNAPSHOT_BOOL_CAPS,
  buildCatalogRuleBodyFromRaw,
  detectImportMapping,
  detectCurrencyFromKey,
  detectPriceUnit,
} from "@/shared/utils/importCatalogSnapshot";

const CAP_LABELS = {
  vision: "Vision",
  pdf: "PDF",
  audioInput: "Audio input",
  videoInput: "Video input",
  imageOutput: "Image output",
  audioOutput: "Audio output",
  tools: "Tools",
  reasoning: "Reasoning",
};

// Target fields the mapping panel can fill. Paths are one or two segments into
// the mapping object ({ caps: {...}, pricing: {...} }).
const MAPPING_TARGETS = [
  { path: "contextWindow", label: "Context window" },
  { path: "maxOutput", label: "Max output" },
  ...SNAPSHOT_BOOL_CAPS.map((cap) => ({ path: `caps.${cap}`, label: CAP_LABELS[cap] })),
  { path: "pricing.input", label: "Input price" },
  { path: "pricing.output", label: "Output price" },
  { path: "pricing.cached", label: "Cached input price" },
];

// Keys that are never catalog targets — keeps the source dropdowns readable.
const IGNORED_SOURCE_KEYS = new Set(["id", "object", "owned_by", "name", "created", "created_at", "updated_at"]);

// Shared Select reserves "" for its disabled placeholder, so "no source"
// travels as a sentinel that updateMapping turns back into null.
const NONE_SOURCE = "__none__";

const DEFAULT_IDR_RATE = "16300";

function formatCount(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "-";
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(number % 1_000_000 ? 1 : 0)}M`;
  if (number >= 1_000) return `${Math.round(number / 1_000)}K`;
  return String(number);
}

function formatUsd(value) {
  return `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 6 })}`;
}

function describeRuleBody(body) {
  if (!body) return null;
  const parts = [];
  if (body.contextWindow) parts.push(`ctx ${formatCount(body.contextWindow)}`);
  if (body.maxOutput) parts.push(`out ${formatCount(body.maxOutput)}`);
  const caps = SNAPSHOT_BOOL_CAPS.filter((cap) => body.capabilities?.[cap] === true);
  if (caps.length) parts.push(caps.join(", "));
  if (body.pricing) {
    const prices = ["input", "output", "cached"]
      .filter((key) => body.pricing[key] !== undefined)
      .map((key) => `${key} ${formatUsd(body.pricing[key])}`);
    if (prices.length) parts.push(prices.join(" / "));
  }
  return parts.length ? parts.join(" · ") : null;
}

function priceOptionLabel(key) {
  const suffix = [
    detectPriceUnit(key) === "per_1k" ? "per 1K" : detectPriceUnit(key) === "per_1m" ? "per 1M" : null,
    detectCurrencyFromKey(key),
  ].filter(Boolean).join(" · ");
  return suffix ? `${key} · ${suffix}` : key;
}

function collectSourceKeys(entriesById, models) {
  const keys = [];
  const seen = new Set();
  for (const id of models) {
    const entry = entriesById?.[id];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    for (const key of Object.keys(entry)) {
      if (seen.has(key) || IGNORED_SOURCE_KEYS.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

export default function ImportModelsDialog({ isOpen, models = [], entriesById = {}, existingIds = [], importing = false, onConfirm, onClose }) {
  const [selected, setSelected] = useState(() => new Set());
  const [fetchCapabilities, setFetchCapabilities] = useState(false);
  const [mapping, setMapping] = useState({});
  const [currencyRate, setCurrencyRate] = useState(DEFAULT_IDR_RATE);
  const [initializedFor, setInitializedFor] = useState(null);

  // (Re)initialize selection every time the dialog opens with a fresh list.
  // State adjustment during render — no effect needed.
  const signature = isOpen ? `${models.length}:${models.join(",")}` : null;
  if (signature !== initializedFor) {
    setInitializedFor(signature);
    setSelected(isOpen ? new Set(models.filter((id) => !existingIds.includes(id))) : new Set());
    setFetchCapabilities(false);
    setMapping(isOpen ? detectImportMapping(models.map((id) => entriesById?.[id])) : {});
    setCurrencyRate(DEFAULT_IDR_RATE);
  }

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const setAll = (on) => {
    setSelected(on ? new Set(models.filter((id) => !existingIds.includes(id))) : new Set());
  };

  const available = models.filter((id) => !existingIds.includes(id));

  const sourceKeys = collectSourceKeys(entriesById, models);
  const sourceOptions = [
    { value: NONE_SOURCE, label: "— none —" },
    ...sourceKeys.map((key) => ({ value: key, label: key })),
  ];
  const priceSourceOptions = [
    { value: NONE_SOURCE, label: "— none —" },
    ...sourceKeys.map((key) => ({ value: key, label: priceOptionLabel(key) })),
  ];
  const mappingValue = (path) => {
    const [head, tail] = path.split(".");
    const value = tail ? mapping?.[head]?.[tail] : mapping?.[head];
    return value || NONE_SOURCE;
  };
  const updateMapping = (path, value) => {
    const next = value === NONE_SOURCE ? null : value;
    setMapping((current) => {
      const [head, tail] = path.split(".");
      if (!tail) return { ...current, [head]: next };
      return { ...current, [head]: { ...(current[head] || {}), [tail]: next } };
    });
  };

  // Preview the first selected model that has raw data, so a wrong source
  // field or rate is visible before the batch import runs.
  const previewId = fetchCapabilities ? models.find((id) => selected.has(id) && entriesById?.[id]) || null : null;
  const previewBody = previewId
    ? buildCatalogRuleBodyFromRaw({ provider: "preview", pattern: previewId, raw: entriesById[previewId], mapping, currencyRate })
    : null;
  const currency = mapping.currency || "USD";

  const handleConfirm = () => {
    if (selected.size === 0 || importing) return;
    onConfirm({ ids: [...selected], fetchCapabilities, mapping, currencyRate });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Import Models from /models"
      size="lg"
      className={fetchCapabilities ? "lg:max-w-5xl xl:max-w-6xl" : undefined}
      bodyClassName={fetchCapabilities ? "lg:flex lg:flex-col lg:overflow-hidden" : undefined}
    >
      <div className={fetchCapabilities ? "flex flex-col gap-4 lg:min-h-0 lg:flex-1" : "flex flex-col gap-4"}>
        {/* Wide screens: the mapping panel sits beside the list; below lg it stays stacked. */}
        <div className={fetchCapabilities ? "flex flex-col gap-4 lg:grid lg:grid-cols-2 lg:min-h-0 lg:flex-1 xl:gap-6" : "flex flex-col gap-4"}>
          <div className="flex min-w-0 flex-col gap-4 lg:min-h-0">
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-muted">{selected.size}/{available.length} new models selected</span>
              <div className="flex gap-1">
                <button onClick={() => setAll(true)} disabled={importing} className="text-xs text-primary hover:underline disabled:opacity-50">All</button>
                <span className="text-xs text-text-muted">·</span>
                <button onClick={() => setAll(false)} disabled={importing} className="text-xs text-primary hover:underline disabled:opacity-50">None</button>
              </div>
            </div>

            <div className={`max-h-64 overflow-y-auto rounded-lg border border-border p-1 custom-scrollbar${fetchCapabilities ? " lg:max-h-none lg:min-h-0 lg:flex-1" : ""}`}>
              {models.map((id) => {
                const alreadyAdded = existingIds.includes(id);
                return (
                  <label
                    key={id}
                    className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${alreadyAdded ? "text-text-muted" : "cursor-pointer hover:bg-surface-2"}`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(id)}
                      disabled={alreadyAdded || importing}
                      onChange={() => toggle(id)}
                      className="size-3.5 shrink-0"
                    />
                    <span className="truncate font-mono text-xs">{id}</span>
                    {alreadyAdded && <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide">already added</span>}
                  </label>
                );
              })}
              {models.length === 0 && (
                <p className="px-2 py-3 text-center text-xs text-text-muted">No models returned.</p>
              )}
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-4 lg:min-h-0">
            <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border bg-bg-subtle p-3">
              <input
                type="checkbox"
                checked={fetchCapabilities}
                disabled={importing}
                onChange={(e) => setFetchCapabilities(e.target.checked)}
                className="mt-0.5 size-3.5 shrink-0"
              />
              <span>
                <span className="block text-sm font-medium">Save capabilities to Model Catalog</span>
                <span className="block text-xs text-text-muted">
                  Optional. Snapshots each model&apos;s capabilities, context window and pricing as a
                  provider-scoped user-defined rule, so re-imports can pre-fill them.
                </span>
              </span>
            </label>

            {fetchCapabilities && (
              <div className="rounded-lg border border-border bg-bg-subtle p-3 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-hidden">
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-1">
                  <span className="text-sm font-medium">Field mapping</span>
                  <span className="text-[10px] text-text-muted">Auto-detected from the /models payload — adjust as needed</span>
                </div>

                <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto custom-scrollbar">
                  {sourceKeys.length === 0 ? (
                    <p className="text-xs text-text-muted">
                      No extra fields in this payload. Each model&apos;s resolved capabilities will be snapshotted instead.
                    </p>
                  ) : (
                    <>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {MAPPING_TARGETS.map(({ path, label }) => (
                          <Select
                            key={path}
                            label={label}
                            value={mappingValue(path)}
                            disabled={importing}
                            onChange={(event) => updateMapping(path, event.target.value)}
                            options={path.startsWith("pricing.") ? priceSourceOptions : sourceOptions}
                          />
                        ))}
                      </div>

                      <div className="mt-3 flex flex-wrap items-end gap-3">
                        <Select
                          label="Price currency"
                          value={currency}
                          disabled={importing}
                          onChange={(event) => setMapping((current) => ({ ...current, currency: event.target.value }))}
                          options={[{ value: "USD", label: "USD" }, { value: "IDR", label: "IDR" }]}
                        />
                        {currency !== "USD" && (
                          <Input
                            label={`1 USD = ? ${currency}`}
                            type="number"
                            min="1"
                            step="any"
                            value={currencyRate}
                            disabled={importing}
                            onChange={(event) => setCurrencyRate(event.target.value)}
                            placeholder={DEFAULT_IDR_RATE}
                          />
                        )}
                      </div>
                      {currency !== "USD" && (
                        <p className="mt-1 text-[10px] text-text-muted">
                          Prices are stored in USD per 1M tokens; sources marked per 1K are scaled ×1000 first.
                        </p>
                      )}

                      {previewId && (
                        <p className="mt-3 rounded-md border border-border bg-surface px-2 py-1.5 text-[11px] text-text-muted">
                          <span className="font-mono font-medium text-text-main">{previewId}</span>
                          {": "}
                          {describeRuleBody(previewBody) || "nothing mapped — falls back to resolved capabilities"}
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <Button onClick={onClose} variant="ghost" fullWidth size="sm" disabled={importing}>Cancel</Button>
          <Button onClick={handleConfirm} fullWidth size="sm" disabled={selected.size === 0 || importing}>
            {importing ? "Importing..." : `Import ${selected.size} model${selected.size === 1 ? "" : "s"}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

ImportModelsDialog.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  models: PropTypes.arrayOf(PropTypes.string),
  entriesById: PropTypes.object,
  existingIds: PropTypes.arrayOf(PropTypes.string),
  importing: PropTypes.bool,
  onConfirm: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};
