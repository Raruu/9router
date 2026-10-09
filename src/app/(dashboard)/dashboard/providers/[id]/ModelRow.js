import { useState } from "react";
import PropTypes from "prop-types";
import { CapacityBadges, ModelDetailModal } from "@/shared/components";

export default function ModelRow({ model, fullModel, alias, copied, onCopy, testStatus, isCustom, isFree, onDeleteAlias, onEdit, onTest, isTesting, onDisable, onToggleLock, locked, removeTitle, caps, thinkingSuffix }) {
  const [showDetail, setShowDetail] = useState(false);
  const displayModel = thinkingSuffix ? `${fullModel}(${thinkingSuffix})` : fullModel;
  const borderColor = testStatus === "ok"
    ? "border-green-500/40"
    : testStatus === "error"
    ? "border-red-500/40"
    : "border-border";

  const iconColor = testStatus === "ok"
    ? "#22c55e"
    : testStatus === "error"
    ? "#ef4444"
    : undefined;

  return (
    <div className={`group w-full sm:w-auto min-w-0 max-w-full rounded-lg border px-3 py-2 ${borderColor} hover:bg-sidebar/50`}>
      <div className="flex min-w-0 items-start gap-2 sm:items-center">
        <span
          className="material-symbols-outlined shrink-0 text-base mt-0.5 sm:mt-0"
          style={iconColor ? { color: iconColor } : undefined}
        >
          {testStatus === "ok" ? "check_circle" : testStatus === "error" ? "cancel" : "smart_toy"}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <code className="w-fit max-w-full break-all rounded bg-sidebar px-1.5 py-0.5 font-mono text-xs text-text-muted sm:max-w-[360px] sm:truncate">{displayModel}</code>
          <span className="flex min-w-0 items-center text-[9px] gap-1 pl-1">
            {model.name && <span className="break-all sm:truncate text-[9px] italic text-text-muted/70">{model.name}</span>}
            <CapacityBadges caps={caps} size={12} />
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
          {onTest && (
            <div className="relative shrink-0 group/btn">
              <button
                onClick={onTest}
                disabled={isTesting}
                className={`rounded p-0.5 text-text-muted transition-opacity hover:bg-sidebar hover:text-primary ${isTesting ? "opacity-100" : "opacity-50 group-hover:opacity-100"}`}
              >
                <span className="material-symbols-outlined text-sm" style={isTesting ? { animation: "spin 1s linear infinite" } : undefined}>
                  {isTesting ? "progress_activity" : "science"}
                </span>
              </button>
              <span className="pointer-events-none absolute mt-1 top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
                {isTesting ? "Testing..." : "Test"}
              </span>
            </div>
          )}
          <div className="relative shrink-0 group/btn">
            <button
              onClick={() => onCopy(displayModel, `model-${model.id}`)}
              className="rounded p-0.5 text-text-muted opacity-50 transition-opacity hover:bg-sidebar hover:text-primary group-hover:opacity-100"
            >
              <span className="material-symbols-outlined text-sm">
                {copied === `model-${model.id}` ? "check" : "content_copy"}
              </span>
            </button>
            <span className="pointer-events-none absolute mt-1 top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
              {copied === `model-${model.id}` ? "Copied!" : "Copy"}
            </span>
          </div>
          <div className="relative shrink-0 group/btn">
            <button
              onClick={() => setShowDetail(true)}
              className="rounded p-0.5 text-text-muted opacity-50 transition-opacity hover:bg-sidebar hover:text-primary group-hover:opacity-100"
              aria-label="View model info"
            >
              <span className="material-symbols-outlined text-sm">visibility</span>
            </button>
            <span className="pointer-events-none absolute mt-1 top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
              Info
            </span>
          </div>
          {onEdit && (
            <button
              onClick={onEdit}
              className="rounded p-0.5 text-text-muted opacity-50 transition-opacity hover:bg-sidebar hover:text-primary group-hover:opacity-100"
              title="Edit custom model"
            >
              <span className="material-symbols-outlined text-sm">edit</span>
            </button>
          )}
          {onToggleLock && (
            <button
              onClick={onToggleLock}
              className={`rounded p-0.5 transition-opacity hover:bg-sidebar group-hover:opacity-100 ${locked ? "text-amber-500 opacity-100" : "text-text-muted opacity-50 hover:text-primary"}`}
              title={locked ? "Unlock model (allow bulk clear)" : "Lock model (keep on bulk clear)"}
            >
              <span className="material-symbols-outlined text-sm">{locked ? "lock" : "lock_open"}</span>
            </button>
          )}
          {isCustom ? (
            <button
              onClick={onDeleteAlias}
              className="rounded p-0.5 text-text-muted opacity-50 transition-opacity hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100"
              title={removeTitle || "Remove custom model"}
            >
              <span className="material-symbols-outlined text-sm">close</span>
            </button>
          ) : onDisable ? (
            <button
              onClick={onDisable}
              className="rounded p-0.5 text-text-muted opacity-50 transition-opacity hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100"
              title="Disable this model"
            >
              <span className="material-symbols-outlined text-sm">close</span>
            </button>
          ) : null}
        </div>
      </div>

      {showDetail && (
        <ModelDetailModal
          isOpen={showDetail}
          onClose={() => setShowDetail(false)}
          modelId={fullModel}
        />
      )}
    </div>
  );
}

ModelRow.propTypes = {
  model: PropTypes.shape({
    id: PropTypes.string.isRequired,
  }).isRequired,
  fullModel: PropTypes.string.isRequired,
  alias: PropTypes.string,
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  testStatus: PropTypes.oneOf(["ok", "error"]),
  isCustom: PropTypes.bool,
  isFree: PropTypes.bool,
  onDeleteAlias: PropTypes.func,
  onEdit: PropTypes.func,
  onTest: PropTypes.func,
  isTesting: PropTypes.bool,
  onDisable: PropTypes.func,
  onToggleLock: PropTypes.func,
  locked: PropTypes.bool,
  removeTitle: PropTypes.string,
  caps: PropTypes.object,
  thinkingSuffix: PropTypes.string,
};
