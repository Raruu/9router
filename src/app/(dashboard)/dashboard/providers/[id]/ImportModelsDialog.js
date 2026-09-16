"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Button, Modal } from "@/shared/components";

export default function ImportModelsDialog({ isOpen, models = [], existingIds = [], importing = false, onConfirm, onClose }) {
  const [selected, setSelected] = useState(() => new Set());
  const [fetchCapabilities, setFetchCapabilities] = useState(true);
  const [initializedFor, setInitializedFor] = useState(null);

  // (Re)initialize selection every time the dialog opens with a fresh list.
  // State adjustment during render — no effect needed.
  const signature = isOpen ? `${models.length}:${models.join(",")}` : null;
  if (signature !== initializedFor) {
    setInitializedFor(signature);
    setSelected(isOpen ? new Set(models.filter((id) => !existingIds.includes(id))) : new Set());
    setFetchCapabilities(true);
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

  const handleConfirm = () => {
    if (selected.size === 0 || importing) return;
    onConfirm({ ids: [...selected], fetchCapabilities });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Import Models from /models" size="lg">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-muted">{selected.size}/{available.length} new models selected</span>
          <div className="flex gap-1">
            <button onClick={() => setAll(true)} disabled={importing} className="text-xs text-primary hover:underline disabled:opacity-50">All</button>
            <span className="text-xs text-text-muted">·</span>
            <button onClick={() => setAll(false)} disabled={importing} className="text-xs text-primary hover:underline disabled:opacity-50">None</button>
          </div>
        </div>

        <div className="max-h-64 overflow-y-auto rounded-lg border border-border p-1 custom-scrollbar">
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
              Snapshots each model&apos;s resolved capabilities, context window and pricing as a provider-scoped user-defined rule.
            </span>
          </span>
        </label>

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
  existingIds: PropTypes.arrayOf(PropTypes.string),
  importing: PropTypes.bool,
  onConfirm: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};
