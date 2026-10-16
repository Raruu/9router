// Search handling for the shared model picker (ModelSelectModal).
// A query that matches the provider itself keeps that provider's full model
// list — searching "agnes" or a compatible node's prefix must show its models
// instead of a header with a zero-model count. Otherwise models narrow by
// name/id and providers left with nothing are dropped.
//
// The query supports plain substrings plus the structured syntax parsed by
// modelSearchFilter (negation !token / -token, /regex/), and — when the caller
// enables provider wildcards — a provider id or `alias/*` term matches the
// whole group.
import { parseSearchQuery, matchesSearch } from "./modelSearchFilter.js";

export function sortModelSelectModels(models, addedModelValues = []) {
  const byName = (a, b) => String(a.name || "").localeCompare(String(b.name || ""));
  const added = [];
  const rest = [];
  for (const model of models) {
    (addedModelValues.includes(model.value) ? added : rest).push(model);
  }
  return [...added.sort(byName), ...rest.sort(byName)];
}

export function filterModelSelectGroups(groups, { query = "", parsedQuery = null, addedModelValues = [], allowProviderWildcard = false } = {}) {
  const parsed = parsedQuery || parseSearchQuery(query);
  const out = {};

  for (const [providerId, group] of Object.entries(groups || {})) {
    let models = Array.isArray(group.models) ? group.models : [];

    if (!parsed.isEmpty) {
      const providerMatches =
        matchesSearch(group.name, parsed) ||
        (group.alias && matchesSearch(group.alias, parsed)) ||
        (allowProviderWildcard &&
          ((providerId && matchesSearch(providerId, parsed)) ||
            matchesSearch(`${group.alias ?? ""}/*`, parsed)));

      if (!providerMatches) {
        models = models.filter((model) => matchesSearch(model, parsed));
        if (models.length === 0) continue;
      } else if (parsed.negativeTerms.length > 0) {
        // A provider hit keeps its models, but exclusion terms still apply.
        models = models.filter((model) => matchesSearch(model, { ...parsed, positiveTerms: [] }));
      }
    }

    out[providerId] = { ...group, models: sortModelSelectModels(models, addedModelValues) };
  }

  return out;
}
