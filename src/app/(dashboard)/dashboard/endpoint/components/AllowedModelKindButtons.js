"use client";

// Per-kind "Add <kind>" buttons for the API-key editor. Replaces the single
// "Select Models from Catalog" button: the kind is chosen up front as a
// full-size button (the old kind tabs inside the picker were too small to
// notice). Labels/icons come from KEY_PICKER_KINDS so the kind taxonomy stays
// one source. Counts show where the current whitelist lives.
import PropTypes from "prop-types";
import { Button } from "@/shared/components";
import { KEY_PICKER_KINDS } from "@/shared/constants/modelSelectKinds";

export default function AllowedModelKindButtons({ counts, onPick }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[11px] font-medium text-text-muted">Add models by kind</p>
      <div className="grid grid-cols-2 gap-1.5">
        {KEY_PICKER_KINDS.map((kind) => {
          const count = counts?.(kind.id) || 0;
          return (
            <Button
              key={kind.id}
              type="button"
              variant="outline"
              size="sm"
              icon={kind.icon}
              onClick={() => onPick(kind.id)}
              className="justify-start h-8 font-medium text-[11px] rounded-lg"
              title={`Select ${kind.label} models`}
            >
              <span className="truncate">Add {kind.label}</span>
              {count > 0 && (
                <span className="ml-auto shrink-0 px-1.5 rounded-full bg-primary/10 text-primary text-[10px] font-semibold">
                  {count}
                </span>
              )}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

AllowedModelKindButtons.propTypes = {
  counts: PropTypes.func,
  onPick: PropTypes.func.isRequired,
};
