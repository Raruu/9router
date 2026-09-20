"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, CardSkeleton, ConfirmModal, Select } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";
import CatalogSection from "./components/CatalogSection";
import UserCatalogDialog from "./components/UserCatalogDialog";
import ClearCatalogDialog from "./components/ClearCatalogDialog";
import { matchesCatalogRow } from "./components/CatalogTable";
import { buildCatalogProviderLabel } from "@/shared/utils/catalogDisplay";

const PRIORITY_OPTIONS = [
  { value: "user-openrouter-hardcoded", label: "user > openrouter > hardcoded" },
  { value: "user-hardcoded-openrouter", label: "user > hardcoded > openrouter" },
];

const CAPABILITY_OPTIONS = [
  { value: "all", label: "All capabilities" },
  { value: "vision", label: "Vision" },
  { value: "pdf", label: "PDF" },
  { value: "audioInput", label: "Audio input" },
  { value: "videoInput", label: "Video input" },
  { value: "imageOutput", label: "Image output" },
  { value: "audioOutput", label: "Audio output" },
  { value: "tools", label: "Tools" },
  { value: "reasoning", label: "Reasoning" },
];

async function requestJson(url, options) {
  const response = await fetch(url, { cache: "no-store", ...options });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

function formatFetchedTime(value) {
  if (!value) return "Never fetched";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Fetched time unavailable";
  return `Fetched ${date.toLocaleString()}`;
}

function rowsFrom(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.models)) return value.models;
  if (Array.isArray(value?.entries)) return value.entries;
  return [];
}

function openRouterStatus(catalog, rows) {
  const status = catalog?.status?.openrouter ?? catalog?.status?.openRouter ?? catalog?.status ?? {};
  const source = Array.isArray(catalog?.openrouter) ? {} : catalog?.openrouter ?? {};
  return {
    count: status.count ?? status.openrouterCount ?? source.count ?? rows.length,
    fetchedAt: status.fetchedAt ?? status.openrouterFetchedAt ?? source.fetchedAt ?? rows[0]?.fetchedAt ?? null,
  };
}

function invalidateModelCapabilities() {
  window.dispatchEvent(new CustomEvent("customModelChanged"));
}

export default function ModelCatalogPage() {
  const [catalog, setCatalog] = useState(null);
  const [providerNodes, setProviderNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [capability, setCapability] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [deletingOpenRouter, setDeletingOpenRouter] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [clearPins, setClearPins] = useState([]);
  const notify = useNotificationStore();

  // Display label for rule provider scopes: custom node ids render as their
  // user-chosen prefix (openai-compatible-chat-<uuid> → myprovider).
  const providerLabel = useMemo(() => buildCatalogProviderLabel(providerNodes), [providerNodes]);

  const load = useCallback(async (showLoader = false) => {
    if (showLoader) setLoading(true);
    try {
      const [data, nodes] = await Promise.all([
        requestJson("/api/models/catalog"),
        requestJson("/api/provider-nodes").then((res) => res.nodes || []).catch(() => []),
      ]);
      setCatalog(data);
      setProviderNodes(nodes);
    } catch (error) {
      notify.error(error.message || "Failed to load model catalog");
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const filtered = useMemo(() => {
    const apply = (rows) => rowsFrom(rows).filter((row) => matchesCatalogRow(row, "", capability, providerLabel));
    return {
      user: apply(catalog?.userDefined ?? catalog?.user),
      openrouter: apply(catalog?.openrouter),
      hardcoded: apply(catalog?.hardcoded),
    };
  }, [capability, catalog, providerLabel]);

  const openrouterRows = rowsFrom(catalog?.openrouter);
  const openrouterStatus = openRouterStatus(catalog, openrouterRows);

  const changePriority = async (event) => {
    const priority = event.target.value;
    const previous = catalog.priority;
    setCatalog((current) => ({ ...current, priority }));
    setBusy("priority");
    try {
      await requestJson("/api/models/catalog/priority", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority }),
      });
      invalidateModelCapabilities();
      notify.success("Catalog priority updated");
    } catch (error) {
      setCatalog((current) => ({ ...current, priority: previous }));
      notify.error(error.message);
    } finally {
      setBusy("");
    }
  };

  const saveUser = async (entry) => {
    const wasEditing = editing?.source === "user";
    setBusy("user");
    try {
      await requestJson("/api/models/catalog/user", {
        method: wasEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(wasEditing ? {
          ...entry,
          originalIdentity: { provider: editing.provider, pattern: editing.pattern },
        } : entry),
      });
      setDialogOpen(false);
      setEditing(null);
      await load();
      invalidateModelCapabilities();
      notify.success(wasEditing ? "User model updated" : "User model added");
    } catch (error) {
      notify.error(error.message);
    } finally {
      setBusy("");
    }
  };

  const deleteUser = async () => {
    if (!deleting) return;
    setBusy("delete");
    try {
      await requestJson("/api/models/catalog/user", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: deleting.id, provider: deleting.provider, pattern: deleting.pattern }),
      });
      setDeleting(null);
      await load();
      invalidateModelCapabilities();
      notify.success("User model deleted");
    } catch (error) {
      notify.error(error.message);
    } finally {
      setBusy("");
    }
  };

  const fetchOpenRouter = async () => {
    setBusy("fetch");
    try {
      const result = await requestJson("/api/models/catalog/openrouter", { method: "POST" });
      await load();
      invalidateModelCapabilities();
      notify.success(`Fetched ${result.count} OpenRouter models`);
    } catch (error) {
      notify.error(error.message);
    } finally {
      setBusy("");
    }
  };

  const clearOpenRouter = async () => {
    setBusy("clear");
    try {
      await requestJson("/api/models/catalog/openrouter", { method: "DELETE" });
      setConfirmClear(false);
      await load();
      invalidateModelCapabilities();
      notify.success("OpenRouter catalog cleared");
    } catch (error) {
      notify.error(error.message);
    } finally {
      setBusy("");
    }
  };

  const deleteOpenRouter = async () => {
    if (!deletingOpenRouter) return;
    setBusy("delete-openrouter");
    try {
      await requestJson(`/api/models/catalog/openrouter?pattern=${encodeURIComponent(deletingOpenRouter.pattern)}`, { method: "DELETE" });
      setDeletingOpenRouter(null);
      await load();
      invalidateModelCapabilities();
      notify.success("OpenRouter model deleted");
    } catch (error) {
      notify.error(error.message);
    } finally {
      setBusy("");
    }
  };

  const editAsUserOverride = (entry) => {
    setEditing({ ...entry, id: null, provider: entry.provider || "*" });
    setDialogOpen(true);
  };

  // Load the catalog pins (custom models bound to a user rule) before opening
  // the Clear dialog, so the scope counts reflect what each option would remove.
  const openClearDialog = async () => {
    setBusy("clear-open");
    try {
      const usage = await requestJson("/api/models/catalog/user");
      setClearPins(rowsFrom(usage?.customModels));
      setClearDialogOpen(true);
    } catch (error) {
      notify.error(error.message);
    } finally {
      setBusy("");
    }
  };

  const clearRules = async ({ scope, includeBound }) => {
    setBusy("clear-rules");
    try {
      const result = await requestJson("/api/models/catalog/user", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, includeBound }),
      });
      setClearDialogOpen(false);
      await load();
      invalidateModelCapabilities();
      const unboundNote = result?.unbound > 0 ? `, ${result.unbound} model${result.unbound === 1 ? "" : "s"} back to Automatic` : "";
      const skippedNote = result?.skippedBound > 0 ? ` (${result.skippedBound} bound kept)` : "";
      notify.success(`Cleared ${result?.deleted ?? 0} rule${result?.deleted === 1 ? "" : "s"}${unboundNote}${skippedNote}`);
    } catch (error) {
      notify.error(error.message);
    } finally {
      setBusy("");
    }
  };

  if (loading || !catalog) {
    return <div className="space-y-4"><CardSkeleton /><CardSkeleton /><CardSkeleton /></div>;
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface/70 p-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Resolution order</p>
          <p className="mt-1 text-xs text-text-muted">The first matching source supplies model metadata.</p>
          {catalog.status?.message && <p className="mt-1 text-xs text-text-muted">{catalog.status.message}</p>}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Select aria-label="Catalog priority" value={catalog.priority} onChange={changePriority} options={PRIORITY_OPTIONS} disabled={busy === "priority"} selectClassName="sm:min-w-64" />
          <Select aria-label="Filter by capability" value={capability} onChange={(event) => setCapability(event.target.value)} options={CAPABILITY_OPTIONS} selectClassName="sm:min-w-44" />
        </div>
      </div>

      <CatalogSection
        title="User Defined"
        description="Your exact and glob overrides. These always have highest priority."
        icon="person_edit"
        rows={filtered.user}
        emptyText={capability !== "all" ? "No user entries match the capability filter." : "No user-defined models yet."}
        onEdit={(entry) => { setEditing(entry); setDialogOpen(true); }}
        onDelete={setDeleting}
        providerLabel={providerLabel}
        actions={
          <>
            <Button icon="add" onClick={() => { setEditing(null); setDialogOpen(true); }}>Add model</Button>
            <Button
              variant="danger"
              icon="delete_sweep"
              loading={busy === "clear-open"}
              disabled={!filtered.user.length || busy === "clear-rules"}
              onClick={openClearDialog}
            >
              Clear
            </Button>
          </>
        }
      />

      <CatalogSection
        title="OpenRouter"
        description={`${formatFetchedTime(openrouterStatus.fetchedAt)} · ${openrouterStatus.count} stored models`}
        icon="cloud_download"
        rows={filtered.openrouter}
        emptyText={capability !== "all" ? "No OpenRouter models match the capability filter." : "Fetch the OpenRouter catalog to populate this source."}
        onEdit={editAsUserOverride}
        onDelete={setDeletingOpenRouter}
        providerLabel={providerLabel}
        actions={
          <>
            <Button variant="secondary" icon="download" loading={busy === "fetch"} onClick={fetchOpenRouter}>Fetch Models</Button>
            <Button variant="danger" icon="delete_sweep" disabled={!openrouterStatus.count} onClick={() => setConfirmClear(true)}>Clear All</Button>
          </>
        }
      />

      <CatalogSection
        title="Hardcoded"
        description="Built-in canonical exact, provider exact, and ordered glob capability rules."
        icon="code"
        rows={filtered.hardcoded}
        emptyText="No hardcoded entries match the filters."
        onEdit={editAsUserOverride}
        providerLabel={providerLabel}
      />

      <UserCatalogDialog key={editing ? `${editing.provider}:${editing.pattern}` : "new"} isOpen={dialogOpen} entry={editing} saving={busy === "user"} onClose={() => { setDialogOpen(false); setEditing(null); }} onSave={saveUser} />
      <ConfirmModal isOpen={Boolean(deleting)} onClose={() => setDeleting(null)} onConfirm={deleteUser} loading={busy === "delete"} title="Delete user model" message={`Delete ${deleting?.pattern || deleting?.model || "this entry"}?`} confirmText="Delete" />
      <ConfirmModal isOpen={Boolean(deletingOpenRouter)} onClose={() => setDeletingOpenRouter(null)} onConfirm={deleteOpenRouter} loading={busy === "delete-openrouter"} title="Delete OpenRouter model" message={`Delete ${deletingOpenRouter?.pattern || "this cached entry"}? Fetching OpenRouter again may restore it.`} confirmText="Delete" />
      <ConfirmModal isOpen={confirmClear} onClose={() => setConfirmClear(false)} onConfirm={clearOpenRouter} loading={busy === "clear"} title="Clear OpenRouter catalog" message="Remove all fetched OpenRouter models? User-defined and hardcoded entries will not be changed." confirmText="Clear All" />

      <ClearCatalogDialog
        isOpen={clearDialogOpen}
        rules={rowsFrom(catalog?.userDefined ?? catalog?.user)}
        pins={clearPins}
        providerLabel={providerLabel}
        clearing={busy === "clear-rules"}
        onClose={() => setClearDialogOpen(false)}
        onConfirm={clearRules}
      />
    </div>
  );
}
