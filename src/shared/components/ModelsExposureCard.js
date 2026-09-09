"use client";

import PropTypes from "prop-types";
import Card from "./Card";
import Select from "./Select";

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

export default function ModelsExposureCard({ value = "all", disabled = false, onChange, variant = "profile" }) {
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
        <p className="border-t border-border/50 pt-2 text-xs italic text-text-muted">
          {exposureSummary(value)}
        </p>
      </div>
    </Card>
  );
}

ModelsExposureCard.propTypes = {
  value: PropTypes.oneOf(["all", "combos", "models"]),
  disabled: PropTypes.bool,
  onChange: PropTypes.func.isRequired,
  variant: PropTypes.oneOf(["profile", "endpoint"]),
};
