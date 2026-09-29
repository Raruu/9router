"use client";

// Allowed-model chips for the API-key editor, grouped by service kind so LLM
// and non-LLM entries are never mixed. Entries the resolver cannot classify
// (wildcards, bare names, unknown ids) fall under "Other".
//
// `resolver` lets the parent share one createAllowedModelKindResolver() with
// the per-kind "Add" buttons; when omitted (e.g. standalone use) the component
// builds its own from connections/nodes/customModels.
import { useMemo } from "react";
import PropTypes from "prop-types";
import { customModelTypeLabel } from "@/shared/constants/models";
import { createAllowedModelKindResolver, groupAllowedModelsByKind } from "@/shared/utils/allowedModelKind";

const GROUP_META = {
  llm: { label: "LLM", icon: "chat" },
  webSearch: { label: "Web Search", icon: "travel_explore" },
  webFetch: { label: "Web Fetch", icon: "language" },
  other: { label: "Other (patterns & names)", icon: "help" },
};

function groupLabel(kind) {
  return GROUP_META[kind]?.label || customModelTypeLabel(kind);
}

export default function AllowedModelChips({ models, connections, nodes, customModels, resolver, onRemove }) {
  const fallbackResolver = useMemo(
    () => (resolver ? null : createAllowedModelKindResolver({ connections, nodes, customModels })),
    [resolver, connections, nodes, customModels],
  );

  const groups = useMemo(
    () => groupAllowedModelsByKind(models, resolver || fallbackResolver),
    [models, resolver, fallbackResolver],
  );

  if (models.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {groups.map(([kind, values]) => (
        <div key={kind} className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-wide text-text-muted">
            {groupLabel(kind)} ({values.length})
          </span>
          <div className="flex flex-wrap gap-1.5">
            {values.map((m) => (
              <span
                key={m}
                className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-primary/10 border border-primary/20 rounded-md text-xs font-mono text-primary"
              >
                <span>{m}</span>
                {onRemove && (
                  <button
                    type="button"
                    onClick={() => onRemove(m)}
                    className="text-primary/60 hover:text-red-500 transition-colors cursor-pointer flex items-center justify-center w-3.5 h-3.5"
                    title="Remove"
                  >
                    <span className="material-symbols-outlined text-[13px]">close</span>
                  </button>
                )}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

AllowedModelChips.propTypes = {
  models: PropTypes.arrayOf(PropTypes.string).isRequired,
  connections: PropTypes.array,
  nodes: PropTypes.array,
  customModels: PropTypes.array,
  resolver: PropTypes.func,
  onRemove: PropTypes.func,
};
