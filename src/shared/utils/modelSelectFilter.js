// Search handling for the shared model picker (ModelSelectModal).
// A query that matches the provider itself keeps that provider's full model
// list — searching "agnes" or a compatible node's prefix must show its models
// instead of a header with a zero-model count. Otherwise models narrow by
// name/id and providers left with nothing are dropped.

export function sortModelSelectModels(models, addedModelValues = []) {
  const byName = (a, b) => String(a.name || "").localeCompare(String(b.name || ""));
  const added = [];
  const rest = [];
  for (const model of models) {
    (addedModelValues.includes(model.value) ? added : rest).push(model);
  }
  return [...added.sort(byName), ...rest.sort(byName)];
}

export function filterModelSelectGroups(groups, { query = "", addedModelValues = [] } = {}) {
  const normalized = String(query || "").trim().toLowerCase();
  const out = {};

  for (const [providerId, group] of Object.entries(groups || {})) {
    let models = Array.isArray(group.models) ? group.models : [];

    if (normalized) {
      const providerMatches = [group.name, group.alias]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized));
      if (!providerMatches) {
        models = models.filter((model) =>
          String(model?.name || "").toLowerCase().includes(normalized) ||
          String(model?.id || "").toLowerCase().includes(normalized)
        );
        if (models.length === 0) continue;
      }
    }

    out[providerId] = { ...group, models: sortModelSelectModels(models, addedModelValues) };
  }

  return out;
}
