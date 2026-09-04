// Pure helpers behind /dashboard/combos list ordering + search.
// Sort is client-side only: getCombos() has routing-facing callers
// (/v1/models, sse combo expansion) that must not see a reordered list.

export const SORT_OPTIONS = [
  { value: "name-asc", label: "Name — A to Z" },
  { value: "name-desc", label: "Name — Z to A" },
  { value: "created-desc", label: "Newest created" },
  { value: "created-asc", label: "Oldest created" },
  { value: "updated-desc", label: "Recently updated" },
];

export const DEFAULT_SORT = "created-asc";
export const SORT_STORAGE_KEY = "combos:sort";

export function readStoredSort() {
  if (typeof window === "undefined") return DEFAULT_SORT;
  try {
    const stored = window.localStorage.getItem(SORT_STORAGE_KEY);
    return SORT_OPTIONS.some((option) => option.value === stored) ? stored : DEFAULT_SORT;
  } catch {
    return DEFAULT_SORT;
  }
}

export function writeStoredSort(mode) {
  try {
    window.localStorage.setItem(SORT_STORAGE_KEY, mode);
  } catch (e) {
    console.error(`Failed to save ${SORT_STORAGE_KEY}:`, e);
  }
}

// Non-mutating. Timestamps fall back to name so equal times keep a stable,
// readable order across refetches; unknown modes fall back to oldest-first
// (the ordering the API has always returned).
export function sortCombos(combos, sortMode = DEFAULT_SORT) {
  const list = [...(combos || [])];
  const byName = (a, b) => String(a?.name || "").localeCompare(String(b?.name || ""));
  const byTime = (field, dir) => (a, b) => {
    const ta = Date.parse(a?.[field] || "") || 0;
    const tb = Date.parse(b?.[field] || "") || 0;
    return dir * (ta - tb) || byName(a, b);
  };
  switch (sortMode) {
    case "name-asc":
      return list.sort(byName);
    case "name-desc":
      return list.sort((a, b) => byName(b, a));
    case "created-desc":
      return list.sort(byTime("createdAt", -1));
    case "updated-desc":
      return list.sort(byTime("updatedAt", -1));
    case "created-asc":
    default:
      return list.sort(byTime("createdAt", 1));
  }
}

export function matchComboSearch(combo, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  return String(combo?.name || "").toLowerCase().includes(q);
}
