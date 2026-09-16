"use client";

import { useState, useEffect, useCallback } from "react";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";

// Module cache: one /api/models fetch shared by every useModelCaps instance.
let cache = null; // maps | null
let inflight = null;

const EMPTY_MAPS = () => ({ byFull: {}, byId: {}, byLevelsFull: {}, byLevelsId: {} });

// Index the /api/models payload. A bare model id is only a safe key when exactly
// one provider declares it: the previous last-write-wins map let one provider's
// capabilities answer for another provider's model (wrong or missing icons for
// combo members). Callers pass every known prefixed form instead — fullModel,
// routedModel (provider alias) and prefixModel (compatible-node display prefix).
export function buildMaps(models) {
  const byFull = {};
  const byLevelsFull = {};
  const idCounts = new Map();
  const idCaps = {};
  const idLevels = {};

  for (const m of models || []) {
    if (!m.caps) continue;
    for (const key of [m.fullModel, m.routedModel, m.prefixModel]) {
      if (!key) continue;
      byFull[key] = m.caps;
      if (m.thinkingLevels) byLevelsFull[key] = m.thinkingLevels;
    }
    if (m.model) {
      idCounts.set(m.model, (idCounts.get(m.model) || 0) + 1);
      idCaps[m.model] = m.caps;
      if (m.thinkingLevels) idLevels[m.model] = m.thinkingLevels;
    }
  }

  const byId = {};
  const byLevelsId = {};
  for (const [id, count] of idCounts) {
    if (count !== 1) continue;
    byId[id] = idCaps[id];
    if (idLevels[id]) byLevelsId[id] = idLevels[id];
  }

  return { byFull, byId, byLevelsFull, byLevelsId };
}

function loadModelCaps() {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = fetch("/api/models")
    .then(async (res) => {
      if (!res.ok) throw new Error(`models ${res.status}`);
      const data = await res.json();
      cache = buildMaps(data.models);
      return cache;
    })
    .catch(() => {
      // Keep null so a later mount can retry
      return EMPTY_MAPS();
    })
    .finally(() => { inflight = null; });
  return inflight;
}

function bareModel(key) {
  return key.includes("/") ? key.slice(key.indexOf("/") + 1) : key;
}

// Resolve caps from a "provider/model" string or a bare model id.
function resolveCaps(maps, key) {
  if (!key) return null;
  if (maps.byFull[key]) return maps.byFull[key];
  const bare = bareModel(key);
  if (maps.byId[bare]) return maps.byId[bare];
  const provider = key.includes("/") ? key.slice(0, key.indexOf("/")) : null;
  return getCapabilitiesForModel(provider, bare);
}

// Server-resolved thinking levels, or undefined when this key is unknown — the
// caller then falls back to the local (catalog-free) getThinkingLevels.
function resolveLevels(maps, key) {
  if (!key) return undefined;
  if (maps.byLevelsFull[key]) return maps.byLevelsFull[key];
  const bare = bareModel(key);
  return maps.byLevelsId[bare];
}

export function useModelCaps() {
  const [maps, setMaps] = useState(() => cache || EMPTY_MAPS());

  useEffect(() => {
    let alive = true;
    const sync = (next) => {
      if (alive) setMaps(next);
    };
    if (cache) {
      sync(cache);
    } else {
      loadModelCaps().then(sync);
    }
    // Custom models change at runtime — drop the shared cache and refetch
    const invalidate = () => {
      cache = null;
      loadModelCaps().then(sync);
    };
    window.addEventListener("customModelChanged", invalidate);
    return () => {
      alive = false;
      window.removeEventListener("customModelChanged", invalidate);
    };
  }, []);

  const getCaps = useCallback(
    (key) => resolveCaps(maps, key),
    [maps],
  );

  const getLevels = useCallback(
    (key) => resolveLevels(maps, key),
    [maps],
  );

  return { getCaps, getLevels };
}
