"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import ModelRow from "./ModelRow";
import { getProviderCustomModelRows, groupCustomModelRowsByKind } from "@/shared/utils/providerCustomModels";

export default function CompatibleModelsSection({ providerStorageAlias, providerDisplayAlias, modelAliases, customModels, copied, onCopy, onDeleteAlias, onEditModel, onDeleteCustomModel, onToggleLock, getModelCaps, connections, isAnthropic }) {
  const [testingModelId, setTestingModelId] = useState(null);
  const [modelTestResults, setModelTestResults] = useState({});

  const handleTestModel = async (modelId, kind = "llm") => {
    if (testingModelId) return;
    setTestingModelId(modelId);
    try {
      const res = await fetch("/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: `${providerStorageAlias}/${modelId}`, kind }),
      });
      const data = await res.json();
      setModelTestResults((prev) => ({ ...prev, [modelId]: data.ok ? "ok" : "error" }));
    } catch {
      setModelTestResults((prev) => ({ ...prev, [modelId]: "error" }));
    } finally {
      setTestingModelId(null);
    }
  };

  // Compatible nodes are chat providers by default; custom entries may carry a
  // media kind, which is why the rows return every type here. The list renders
  // exactly like the built-in provider page: one section per service kind,
  // header only when there is more than one group.
  const allModels = getProviderCustomModelRows({
    customModels,
    modelAliases,
    providerAlias: providerStorageAlias,
    type: null,
  });
  const groups = groupCustomModelRowsByKind(allModels);
  const showHeaders = groups.length > 1;

  const canImport = connections.some((conn) => conn.isActive !== false);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">
        Add {isAnthropic ? "Anthropic" : "OpenAI"}-compatible models manually or import them from the /models endpoint.
      </p>

      {!canImport && (
        <p className="text-xs text-text-muted">
          Add a connection to enable importing models.
        </p>
      )}

      {groups.map((group) => (
        <div key={group.id} className="flex flex-col gap-2">
          {showHeaders && (
            <p className="text-xs font-medium text-text-muted">
              {group.label} ({group.rows.length})
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            {group.rows.map(({ id, name, alias, source, type, locked, transport, catalogRef }) => {
              const isCustom = source === "custom";
              return (
                <ModelRow
                  key={`${source}-${providerStorageAlias}/${id}`}
                  model={{ id, name }}
                  fullModel={`${providerDisplayAlias}/${id}`}
                  alias={alias}
                  copied={copied}
                  onCopy={onCopy}
                  onDeleteAlias={() => isCustom ? onDeleteCustomModel(id, type) : onDeleteAlias(alias)}
                  onEdit={isCustom ? () => onEditModel({ id, name, catalogRef, type, transport }) : undefined}
                  onToggleLock={isCustom ? () => onToggleLock(id, !locked, type) : undefined}
                  locked={locked}
                  removeTitle={isCustom ? undefined : "Remove alias"}
                  testStatus={modelTestResults[id]}
                  onTest={connections.length > 0 ? () => handleTestModel(id, type) : undefined}
                  isTesting={testingModelId === id}
                  isCustom
                  isFree={false}
                  caps={getModelCaps?.(`${providerStorageAlias}/${id}`)}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

CompatibleModelsSection.propTypes = {
  providerStorageAlias: PropTypes.string.isRequired,
  providerDisplayAlias: PropTypes.string.isRequired,
  modelAliases: PropTypes.object.isRequired,
  customModels: PropTypes.arrayOf(PropTypes.object),
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  onDeleteAlias: PropTypes.func.isRequired,
  onEditModel: PropTypes.func.isRequired,
  onDeleteCustomModel: PropTypes.func.isRequired,
  onToggleLock: PropTypes.func.isRequired,
  getModelCaps: PropTypes.func,
  connections: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string,
    isActive: PropTypes.bool,
  })).isRequired,
  isAnthropic: PropTypes.bool,
};
