"use client";

import PropTypes from "prop-types";
import Card from "./Card";
import Select from "./Select";
import Toggle from "./Toggle";

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

export default function ModelsExposureCard({ value = "all", exposeNonLlm = false, disabled = false, onChange, onToggleNonLlm, variant = "profile" }) {
  const endpoint = variant === "endpoint";

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
        {onToggleNonLlm && (
          <div className="border-t border-border/50 pt-3">
            <Toggle
              checked={exposeNonLlm}
              onChange={onToggleNonLlm}
              disabled={disabled}
              label="Also expose non-LLM models"
              description="Adds image, video, speech, embeddings and classifier models (plus their combos) to GET /v1/models."
            />
            <p className="mt-2 text-xs italic text-text-muted">
              {exposeNonLlm
                ? "Clients discover media models from the default list too."
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
  exposeNonLlm: PropTypes.bool,
  disabled: PropTypes.bool,
  onChange: PropTypes.func.isRequired,
  onToggleNonLlm: PropTypes.func,
  variant: PropTypes.oneOf(["profile", "endpoint"]),
};
