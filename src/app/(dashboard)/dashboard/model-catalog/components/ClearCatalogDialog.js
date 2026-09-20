"use client";

import { useMemo, useState } from "react";
import PropTypes from "prop-types";
import { Button, Modal, Select } from "@/shared/components";
import { clearScopeRules, summarizeClearRules } from "@/shared/utils/catalogUsage";

const SCOPES = [
  { value: "all", label: "Clear All" },
  { value: "glob", label: "Clear Glob" },
  { value: "exact", label: "Clear Exact" },
];

export default function ClearCatalogDialog({ isOpen, rules, pins, providerLabel, clearing, onClose, onConfirm }) {
  const [scope, setScope] = useState("all");
  const [includeBound, setIncludeBound] = useState(false);

  const summary = useMemo(() => summarizeClearRules(rules, pins), [rules, pins]);
  const affected = useMemo(() => clearScopeRules(summary, scope, includeBound), [summary, scope, includeBound]);
  // Models that would lose their binding and fall back to Automatic.
  const unbindCount = includeBound ? summary[scope]?.bound.length ?? 0 : 0;

  const options = SCOPES.map((entry) => {
    const bucket = summary[entry.value];
    const removed = clearScopeRules(summary, entry.value, includeBound).length;
    return { value: entry.value, label: `${entry.label} (${removed}/${bucket.rules.length})` };
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Clear model catalog rules"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={clearing}>Cancel</Button>
          <Button variant="danger" onClick={() => onConfirm({ scope, includeBound })} loading={clearing} disabled={affected.length === 0}>
            Clear
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Select
          label="Scope"
          value={scope}
          onChange={(event) => setScope(event.target.value)}
          options={options}
          disabled={clearing}
        />

        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border bg-bg-subtle p-3">
          <input
            type="checkbox"
            checked={includeBound}
            disabled={clearing}
            onChange={(event) => setIncludeBound(event.target.checked)}
            className="mt-0.5 size-3.5 shrink-0"
          />
          <span>
            <span className="block text-sm font-medium">Also clear bound patterns</span>
            <span className="block text-xs text-text-muted">
              Off keeps rules a custom model is pinned to. On clears them too and those models return to Automatic.
            </span>
          </span>
        </label>

        <p className="text-sm text-text-muted">
          Will clear <span className="font-semibold text-text-main">{affected.length}</span> rule{affected.length === 1 ? "" : "s"}
          {unbindCount > 0 && (
            <> · <span className="font-semibold text-text-main">{unbindCount}</span> bound pattern{unbindCount === 1 ? "" : "s"} released to Automatic</>
          )}
          . This cannot be undone.
        </p>

        {affected.length > 0 && (
          <div className="max-h-56 overflow-y-auto rounded-lg border border-border bg-bg-subtle p-2 custom-scrollbar">
            {affected.slice(0, 50).map((rule) => (
              <div key={`${rule.provider}|${rule.pattern}`} className="flex items-baseline justify-between gap-2 px-1 py-0.5 text-xs">
                <code className="truncate font-mono text-text-main" title={rule.pattern}>{rule.pattern}</code>
                <span className="shrink-0 text-text-muted" title={rule.provider}>{providerLabel(rule.provider)}</span>
              </div>
            ))}
            {affected.length > 50 && (
              <p className="px-1 pt-1 text-xs italic text-text-muted">+{affected.length - 50} more</p>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

ClearCatalogDialog.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  rules: PropTypes.array.isRequired,
  pins: PropTypes.array.isRequired,
  providerLabel: PropTypes.func.isRequired,
  clearing: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onConfirm: PropTypes.func.isRequired,
};
