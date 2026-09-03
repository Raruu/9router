"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";

export default function LatencyModelFilter({ entries, hidden, onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => e.label.toLowerCase().includes(q));
  }, [entries, search]);

  const visibleCount = useMemo(
    () => entries.reduce((n, e) => (hidden.has(e.key) ? n : n + 1), 0),
    [entries, hidden],
  );
  const filteredVisible = useMemo(
    () => filtered.reduce((n, e) => (hidden.has(e.key) ? n : n + 1), 0),
    [filtered, hidden],
  );

  const toggle = useCallback(
    (key) => {
      const next = new Set(hidden);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      onChange(next);
    },
    [hidden, onChange],
  );

  // Clear and Select all act on the current search result rather than the whole
  // list. That is what keeps them distinct from Reset, whose default state is
  // "everything visible".
  const hideFiltered = useCallback(() => {
    const next = new Set(hidden);
    for (const e of filtered) next.add(e.key);
    onChange(next);
  }, [filtered, hidden, onChange]);

  const showFiltered = useCallback(() => {
    const next = new Set(hidden);
    for (const e of filtered) next.delete(e.key);
    onChange(next);
  }, [filtered, hidden, onChange]);

  const reset = useCallback(() => {
    setSearch("");
    onChange(new Set());
  }, [onChange]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex h-8 items-center gap-1 rounded-lg border border-black/10 bg-black/[0.02] px-2 text-xs text-text-main transition-colors hover:bg-black/5 dark:border-white/10 dark:bg-white/[0.03] dark:hover:bg-white/10"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Show or hide models in the latency chart"
      >
        <span className="whitespace-nowrap">
          <span className="hidden sm:inline">
            {visibleCount} of {entries.length} models
          </span>
          <span className="sm:hidden">
            {visibleCount}/{entries.length}
          </span>
        </span>
        <span className="material-symbols-outlined text-[14px] text-text-muted">
          {open ? "expand_less" : "expand_more"}
        </span>
      </button>

      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-30 bg-transparent"
            aria-label="Close model filter"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 z-40 mt-2 w-[min(340px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-black/10 bg-surface/95 p-1.5 shadow-xl shadow-black/10 backdrop-blur dark:border-white/10">
            <div className="relative p-1">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[16px] text-text-muted">
                search
              </span>
              <input
                type="text"
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface py-1.5 pl-8 pr-3 text-xs text-text-main focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </div>

            <div className="max-h-72 overflow-y-auto pr-1">
              {filtered.length === 0 ? (
                <p className="px-3 py-4 text-center text-xs text-text-muted">
                  No models match
                </p>
              ) : (
                filtered.map((e) => {
                  const isHidden = hidden.has(e.key);
                  return (
                    <button
                      key={e.key}
                      type="button"
                      onClick={() => toggle(e.key)}
                      aria-pressed={!isHidden}
                      className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs transition-colors hover:bg-black/5 dark:hover:bg-white/10 ${isHidden ? "text-text-muted" : "font-medium text-text-main"}`}
                      title={e.label}
                    >
                      <span className="truncate">{e.label}</span>
                      {!isHidden && (
                        <span className="material-symbols-outlined ml-auto shrink-0 text-[16px] text-primary">
                          check
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>

            <div className="my-1 h-px bg-black/10 dark:bg-white/10" />

            <div className="grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={hideFiltered}
                disabled={filteredVisible === 0}
                className="rounded-xl px-3 py-2 text-xs font-medium text-text-main transition-colors hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/10"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={showFiltered}
                disabled={filteredVisible === filtered.length}
                className="rounded-xl px-3 py-2 text-xs font-medium text-text-main transition-colors hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/10"
              >
                Select all
              </button>
              <button
                type="button"
                onClick={reset}
                disabled={hidden.size === 0 && search === ""}
                className="col-span-2 rounded-xl px-3 py-2 text-xs font-medium text-text-main transition-colors hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/10"
              >
                Reset (to default)
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

LatencyModelFilter.propTypes = {
  entries: PropTypes.arrayOf(
    PropTypes.shape({
      key: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
    }),
  ).isRequired,
  hidden: PropTypes.instanceOf(Set).isRequired,
  onChange: PropTypes.func.isRequired,
};
