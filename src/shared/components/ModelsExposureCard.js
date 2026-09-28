"use client";

import PropTypes from "prop-types";
import Card from "./Card";
import Select from "./Select";
import { EXPOSABLE_NON_LLM_KINDS } from "@/shared/constants/models";

const OPTIONS = [
  { value: "all", label: "Combos + Models" },
  { value: "combos", label: "Combos only" },
  { value: "models", label: "Models only" },
];

function exposureSummary(value) {
  if (value === "combos") return "Clients see combo names only — provider models stay routable, just unlisted.";
  if (value === "models") return "Clients see provider models only — combos stay routable, just unlisted.";
  return "Clients see every combo and provider model.";
}

export default function ModelsExposureCard({ value = "all", exposeKinds = [], disabled = false, onChange, onToggleNonLlmKind, variant = "profile" }) {
  const endpoint = variant === "endpoint";
  const checked = new Set(exposeKinds);

  return (
    <Card>
      {endpoint ? (
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <span className="material-symbols-outlined text-primary">format_list_bulleted</span>
          Model List
        </h2>
      ) : (
        <div className="mb-4 flex items-center gap-3">
          <div className="shrink-0 rounded-lg bg-teal-500/10 p-2 text-teal-500">
            <span className="material-symbols-outlined text-[20px]">format_list_bulleted</span>
          </div>
          <h3 className="text-base font-semibold sm:text-lg">Model List</h3>
        </div>
      )}

      <div className="flex flex-col gap-4">
        <Select
          label="Expose in /v1/models"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          options={OPTIONS}
          hint="Applies to GET /v1/models only. The per-kind lists (/v1/models/image, /tts, /stt, /embedding, /web) always expose everything, and the CLI Tools model pickers are unaffected."
        />
        {onToggleNonLlmKind && (
          <div className="border-t border-border/50 pt-3">
            <p className="text-sm font-medium text-text-main">Also expose in /v1/models</p>
            <p className="mb-3 mt-0.5 text-xs text-text-muted">
              Pick the non-LLM kinds the default list should advertise, alongside chat models.
            </p>
            <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
              {EXPOSABLE_NON_LLM_KINDS.map((kind) => (
                <label key={kind.id} className="flex cursor-pointer select-none items-center gap-2">
                  <input
                    type="checkbox"
                    checked={checked.has(kind.id)}
                    onChange={() => onToggleNonLlmKind(kind.id)}
                    disabled={disabled}
                    className="h-3.5 w-3.5 cursor-pointer accent-primary disabled:cursor-not-allowed"
                  />
                  <span className="material-symbols-outlined text-[16px] text-text-muted">{kind.icon}</span>
                  <span className="text-xs text-text-muted">{kind.label}</span>
                </label>
              ))}
            </div>
            <p className="mt-3 text-xs italic text-text-muted">
              {checked.size > 0
                ? `Clients also discover: ${EXPOSABLE_NON_LLM_KINDS.filter((k) => checked.has(k.id)).map((k) => k.label).join(", ")}.`
                : "The default list stays chat-only; media models remain reachable via /v1/models/{kind}."}
            </p>
          </div>
        )}
        <p className="border-t border-border/50 pt-2 text-xs italic text-text-muted">
          {exposureSummary(value)}
        </p>
      </div>
    </Card>
  );
}

ModelsExposureCard.propTypes = {
  value: PropTypes.oneOf(["all", "combos", "models"]),
  exposeKinds: PropTypes.arrayOf(PropTypes.string),
  disabled: PropTypes.bool,
  onChange: PropTypes.func.isRequired,
  onToggleNonLlmKind: PropTypes.func,
  variant: PropTypes.oneOf(["profile", "endpoint"]),
};
