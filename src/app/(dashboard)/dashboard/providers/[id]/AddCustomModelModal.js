"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import PropTypes from "prop-types";
import { Button, Modal } from "@/shared/components";
import {
  AUTOMATIC_PATTERN_OPTION,
  catalogPatternOptions,
  catalogRefKey,
  filterCatalogPatternOptions,
} from "./catalogPatternOptions";

export default function AddCustomModelModal({ isOpen, providerAlias = "", existingModel, initialModelId = "", onSave, onClose }) {
  const [modelId, setModelId] = useState(() => existingModel?.id || initialModelId);
  const [selectedKey, setSelectedKey] = useState(() => catalogRefKey(existingModel?.catalogRef));
  const [options, setOptions] = useState([]);
  const [patternQuery, setPatternQuery] = useState(() => existingModel?.catalogRef
    ? `[${existingModel.catalogRef.source}] ${existingModel.catalogRef.provider || "*"} / ${existingModel.catalogRef.pattern}`
    : AUTOMATIC_PATTERN_OPTION.label);
  const [patternOpen, setPatternOpen] = useState(false);
  const [activeOption, setActiveOption] = useState(0);
  const [catalogError, setCatalogError] = useState("");
  const [testStatus, setTestStatus] = useState(null); // null | "testing" | "ok" | "error"
  const [testError, setTestError] = useState("");
  const [saving, setSaving] = useState(false);
  const patternRef = useRef(null);

  const reset = () => {
    setModelId("");
    setSelectedKey("");
    setPatternQuery(AUTOMATIC_PATTERN_OPTION.label);
    setPatternOpen(false);
    setTestStatus(null);
    setTestError("");
  };

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    fetch("/api/models/catalog", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Failed to load catalog patterns");
        if (!cancelled) setOptions(catalogPatternOptions(data));
      })
      .catch((error) => { if (!cancelled) setCatalogError(error.message); });
    return () => { cancelled = true; };
  }, [isOpen]);

  useEffect(() => {
    if (!patternOpen) return;
    const closeOnOutsideClick = (event) => {
      if (!patternRef.current?.contains(event.target)) setPatternOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [patternOpen]);

  const visibleOptions = useMemo(() => [
    AUTOMATIC_PATTERN_OPTION,
    ...filterCatalogPatternOptions(options, patternQuery === AUTOMATIC_PATTERN_OPTION.label ? "" : patternQuery),
  ], [options, patternQuery]);

  const selectPattern = (option) => {
    setSelectedKey(option.key);
    setPatternQuery(option.label);
    setPatternOpen(false);
    setActiveOption(0);
  };

  const handlePatternKeyDown = (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setPatternOpen(true);
      setActiveOption((current) => Math.min(current + 1, visibleOptions.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setPatternOpen(true);
      setActiveOption((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter" && patternOpen) {
      event.preventDefault();
      selectPattern(visibleOptions[activeOption] || AUTOMATIC_PATTERN_OPTION);
    } else if (event.key === "Escape") {
      setPatternOpen(false);
    }
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  // Strip provider's own alias prefix (e.g. "cc/model" -> "model" for cc provider)
  const stripAlias = (id) => {
    const prefix = `${providerAlias}/`;
    return id.startsWith(prefix) ? id.slice(prefix.length) : id;
  };

  const handleTest = async () => {
    const cleanId = stripAlias(modelId.trim());
    if (!cleanId) return;
    setTestStatus("testing");
    setTestError("");
    try {
      const res = await fetch("/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: `${providerAlias}/${cleanId}` }),
      });
      const data = await res.json();
      setTestStatus(data.ok ? "ok" : "error");
      setTestError(data.error || "");
    } catch (err) {
      setTestStatus("error");
      setTestError(err.message);
    }
  };

  const handleSave = async () => {
    const cleanId = stripAlias(modelId.trim());
    if (!cleanId || saving) return;
    setSaving(true);
    try {
      const selected = options.find((option) => option.key === selectedKey);
      await onSave(cleanId, selected?.ref || null);
      reset();
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleTest();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={existingModel ? "Edit Custom Model" : "Add Custom Model"}>
      <div className="flex flex-col gap-4">
        <div>
          <label className="text-sm font-medium mb-1.5 block">Model ID</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={modelId}
              onChange={(e) => { setModelId(e.target.value); setTestStatus(null); setTestError(""); }}
              onKeyDown={handleKeyDown}
              disabled={!!existingModel}
              placeholder="e.g. claude-opus-4-5"
              className="flex-1 px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
              autoFocus
            />
            <Button
              variant="secondary"
              icon="science"
              loading={testStatus === "testing"}
              onClick={handleTest}
              disabled={!modelId.trim() || testStatus === "testing"}
            >
              {testStatus === "testing" ? "Testing..." : "Test"}
            </Button>
          </div>
          <p className="text-xs text-text-muted mt-1">
            Sent to provider as: <code className="font-mono bg-sidebar px-1 rounded">{stripAlias(modelId.trim()) || "model-id"}</code>
          </p>
        </div>

        <div ref={patternRef}>
          <label htmlFor="catalog-pattern-combobox" className="text-sm font-medium mb-1.5 block">Model pattern</label>
          <div className="relative">
            <input
              id="catalog-pattern-combobox"
              type="text"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={patternOpen}
              aria-controls="catalog-pattern-listbox"
              aria-activedescendant={patternOpen ? `catalog-pattern-option-${activeOption}` : undefined}
              value={patternQuery}
              onFocus={(event) => { event.target.select(); setPatternOpen(true); setActiveOption(0); }}
              onChange={(event) => { setPatternQuery(event.target.value); setSelectedKey(""); setPatternOpen(true); setActiveOption(0); }}
              onKeyDown={handlePatternKeyDown}
              placeholder="Search available model patterns"
              className="w-full rounded-lg border border-border bg-background py-2 pl-3 pr-9 text-sm outline-none focus:border-primary"
            />
            <button
              type="button"
              onClick={() => setPatternOpen((open) => !open)}
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-text-muted hover:text-primary"
              aria-label="Toggle model patterns"
              tabIndex={-1}
            >
              <span className="material-symbols-outlined text-[18px]">{patternOpen ? "expand_less" : "expand_more"}</span>
            </button>
          </div>
          {patternOpen && (
            <div id="catalog-pattern-listbox" role="listbox" className="mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-xl">
              {visibleOptions.map((option, index) => (
                <button
                  key={option.key || "automatic"}
                  id={`catalog-pattern-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={selectedKey === option.key}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveOption(index)}
                  onClick={() => selectPattern(option)}
                  className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-xs ${index === activeOption ? "bg-primary/10 text-primary" : "text-text-main hover:bg-surface-2"}`}
                >
                  <span className="truncate font-mono">{option.label}</span>
                  {selectedKey === option.key && <span className="material-symbols-outlined shrink-0 text-[16px]">check</span>}
                </button>
              ))}
              {visibleOptions.length === 1 && patternQuery !== AUTOMATIC_PATTERN_OPTION.label && (
                <p className="px-2.5 py-3 text-center text-xs text-text-muted">No catalog patterns match.</p>
              )}
            </div>
          )}
          <p className="mt-1 text-xs text-text-muted">The model follows this source pattern live, including future metadata changes.</p>
          {catalogError && <p className="mt-1 text-xs text-red-500">{catalogError}</p>}
        </div>

        {/* Test result */}
        {testStatus === "ok" && (
          <div className="flex items-center gap-2 text-sm text-green-600">
            <span className="material-symbols-outlined text-base">check_circle</span>
            Model is reachable
          </div>
        )}
        {testStatus === "error" && (
          <div className="flex items-start gap-2 text-sm text-red-500">
            <span className="material-symbols-outlined text-base shrink-0">cancel</span>
            <span>{testError || "Model not reachable"}</span>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <Button onClick={handleClose} variant="ghost" fullWidth size="sm">Cancel</Button>
          <Button
            onClick={handleSave}
            fullWidth
            size="sm"
            disabled={!modelId.trim() || saving}
          >
            {saving ? (existingModel ? "Saving..." : "Adding...") : (existingModel ? "Save Changes" : "Add Model")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

AddCustomModelModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  providerAlias: PropTypes.string,
  existingModel: PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string,
    caps: PropTypes.object,
    catalogRef: PropTypes.shape({
      source: PropTypes.oneOf(["user", "openrouter", "hardcoded"]).isRequired,
      provider: PropTypes.string.isRequired,
      pattern: PropTypes.string.isRequired,
    }),
  }),
  initialModelId: PropTypes.string,
  onSave: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};
