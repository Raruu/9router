// Helpers for finding combos that reference a model.
// A model can be stored under either its storage alias (node id) or its
// display alias (prefix), so callers pass every known full-model form and a
// combo matches when any member equals any of them.

// Combos shape: [{ id, name, models: ["provider/model", ...] }, ...]
export function filterCombosUsingModel(combos, fullModels) {
  const wanted = new Set((fullModels || []).filter(Boolean));
  if (wanted.size === 0) return [];
  return (combos || []).filter((combo) => {
    const members = combo?.models;
    if (!Array.isArray(members)) return false;
    return members.some((m) => wanted.has(m));
  });
}

// Remove every candidate form from a combo's member list (keeps the combo
// itself even when nothing is left — the user deletes empties explicitly).
export function stripModelsFromComboMembers(members, fullModels) {
  const remove = new Set((fullModels || []).filter(Boolean));
  return (members || []).filter((m) => !remove.has(m));
}
