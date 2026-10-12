"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Card, CardSkeleton, ConfirmModal, ModelSelectModal, Toggle } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { useNotificationStore } from "@/store/notificationStore";
import { getProviderByAlias } from "@/shared/constants/providers";
import { profileModels, normalizeClassifierModels } from "@/shared/constants/thinkingClassifier";
import ClassifierFormModal, { classifierToForm } from "./components/ClassifierFormModal";
import { buildClassifierExport, buildClassifierExportFilename, parseClassifierImport } from "./classifierTransfer";

// Human label for a classifier model id ("oc/jev-1.13-free" → "OpenCode · jev-1.13-free").
function modelLabel(modelId) {
  if (!modelId || !modelId.includes("/")) return modelId || "—";
  const [prefix, ...rest] = modelId.split("/");
  const provider = getProviderByAlias(prefix);
  return `${provider?.name || prefix} · ${rest.join("/")}`;
}

// "Model A" or "Model A (+2 more)" for a profile's ordered fallback list.
function modelsSummary(profile) {
  const models = profileModels(profile);
  if (models.length === 0) return "—";
  const first = modelLabel(models[0].model);
  return models.length > 1 ? `${first} (+${models.length - 1} more)` : first;
}

export default function ThinkingClassifierPage() {
  const [classifiers, setClassifiers] = useState([]);
  const [activeProviders, setActiveProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showFormModal, setShowFormModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmState, setConfirmState] = useState(null);
  const [showModelSelect, setShowModelSelect] = useState(false);
  const importFileRef = useRef(null);
  // Test inputs are keyed by classifier id so each card's box is independent.
  const [testTexts, setTestTexts] = useState({});
  const [testState, setTestState] = useState({ running: false, result: null, error: null, profileId: null });
  const { copied, copy } = useCopyToClipboard();
  const notify = useNotificationStore();

  const fetchData = useCallback(async () => {
    try {
      const [classifiersRes, providersRes] = await Promise.all([
        fetch("/api/thinking-classifiers", { cache: "no-store" }),
        fetch("/api/providers"),
      ]);
      const classifiersData = await classifiersRes.json();
      const providersData = providersRes.ok ? await providersRes.json() : {};
      if (classifiersRes.ok) setClassifiers(classifiersData.classifiers || []);
      setActiveProviders(providersData.connections || []);
    } catch (error) {
      console.log("Error fetching thinking classifiers:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const load = async () => { await fetchData(); };
    load();
  }, [fetchData]);

  const openCreateModal = () => {
    setEditing(null);
    setForm(classifierToForm({}));
    setShowFormModal(true);
  };

  const openEditModal = (classifier) => {
    setEditing(classifier);
    setForm(classifierToForm(classifier));
    setShowFormModal(true);
  };

  const handleSave = async (payload) => {
    setSaving(true);
    try {
      const res = await fetch(editing ? `/api/thinking-classifiers/${editing.id}` : "/api/thinking-classifiers", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        notify.error(data.error || "Failed to save classifier");
        return;
      }
      notify.success(editing ? "Classifier updated" : "Classifier created");
      setShowFormModal(false);
      setEditing(null);
      await fetchData();
    } catch (error) {
      console.log("Error saving classifier:", error);
      notify.error("Failed to save classifier");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (classifier) => {
    const next = !classifier.isActive;
    setClassifiers((prev) => prev.map((c) => (c.id === classifier.id ? { ...c, isActive: next } : c)));
    try {
      const res = await fetch(`/api/thinking-classifiers/${classifier.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...classifier, isActive: next }),
      });
      if (!res.ok) throw new Error("update failed");
    } catch (error) {
      console.log("Error toggling classifier:", error);
      setClassifiers((prev) => prev.map((c) => (c.id === classifier.id ? { ...c, isActive: classifier.isActive } : c)));
      notify.error("Failed to update active state");
    }
  };

  const handleDelete = (classifier) => {
    setConfirmState({
      title: "Delete classifier",
      message: `Delete "${classifier.name}"? Clients sending this tier will fall back to their own thinking setting.`,
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/thinking-classifiers/${classifier.id}`, { method: "DELETE" });
          if (!res.ok) throw new Error("delete failed");
          notify.success("Classifier deleted");
          setConfirmState(null);
          await fetchData();
        } catch (error) {
          console.log("Error deleting classifier:", error);
          notify.error("Failed to delete classifier");
          setConfirmState(null);
        }
      },
    });
  };

  const handleExport = (classifier) => {
    const payload = buildClassifierExport(classifier);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = buildClassifierExportFilename(classifier.name);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    notify.success(`Exported "${classifier.name}"`);
  };

  const handleImportFile = async (event) => {
    const file = event.target.files?.[0];
    if (importFileRef.current) importFileRef.current.value = "";
    if (!file) return;

    let parsed;
    try {
      parsed = parseClassifierImport(await file.text());
    } catch (err) {
      notify.error(err.message || "Invalid classifier file");
      return;
    }

    const { classifier } = parsed;
    const existing = classifiers.find((c) => c.name === classifier.name);
    setConfirmState({
      title: existing ? "Update classifier" : "Import classifier",
      message: existing
        ? `Replace the settings of "${classifier.name}" with the file's? Its active state is kept.`
        : `Create a new classifier "${classifier.name}"?`,
      confirmText: existing ? "Update" : "Create",
      onConfirm: async () => {
        try {
          const res = await fetch(
            existing ? `/api/thinking-classifiers/${existing.id}` : "/api/thinking-classifiers",
            {
              method: existing ? "PUT" : "POST",
              headers: { "Content-Type": "application/json" },
              // isActive is routing state a file must not flip: keep the stored
              // value on update; a new profile takes the server default (active).
              body: JSON.stringify(existing ? { ...classifier, isActive: existing.isActive } : classifier),
            },
          );
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            notify.error(data.error || "Import failed");
            setConfirmState(null);
            return;
          }
          notify.success(existing ? `Updated "${classifier.name}"` : `Created "${classifier.name}"`);
          setConfirmState(null);
          await fetchData();
        } catch (error) {
          console.log("Error importing classifier:", error);
          notify.error("Import failed");
          setConfirmState(null);
        }
      },
    });
  };

  const handleTest = async (classifier) => {
    const text = (testTexts[classifier.id] || "").trim();
    if (!text) {
      notify.error("Enter a test prompt first");
      return;
    }
    setTestState({ running: true, result: null, error: null, profileId: classifier.id });
    try {
      const res = await fetch(`/api/thinking-classifiers/${classifier.id}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTestState({ running: false, result: null, error: data.error || "Test failed", profileId: classifier.id });
        return;
      }
      setTestState({ running: false, result: data, error: null, profileId: classifier.id });
    } catch (error) {
      console.log("Error testing classifier:", error);
      setTestState({ running: false, result: null, error: "Test failed", profileId: classifier.id });
    }
  };

  return (
    <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-text-main">Thinking Effort Classifier</h1>
            <p className="text-sm text-text-muted">
              Named tiers backed by System One decision models. Active tiers are advertised in every
              reasoning model&apos;s <code className="font-mono text-xs">capabilities.effort_tiers</code> — a client
              selects one by sending its name as its effort value (e.g.{" "}
              <code className="font-mono text-xs">reasoning_effort: &quot;generic&quot;</code>), and the gateway
              replaces it with the level the classifier picks for the prompt.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="secondary"
              icon="upload"
              onClick={() => importFileRef.current?.click()}
              className="shrink-0"
            >
              Import
            </Button>
            <input
              ref={importFileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={handleImportFile}
            />
            <Button icon="add" onClick={openCreateModal} className="shrink-0">New classifier</Button>
          </div>
        </div>

      {loading ? (
        <CardSkeleton />
      ) : classifiers.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <span className="material-symbols-outlined text-3xl text-text-muted">psychology</span>
            <p className="text-sm text-text-muted">
              No classifiers yet. Create one to let clients hand thinking-effort decisions to a System One model.
            </p>
            <Button variant="secondary" size="sm" icon="add" onClick={openCreateModal}>Create the first one</Button>
          </div>
        </Card>
      ) : (
        classifiers.map((classifier) => (
          <Card key={classifier.id}>
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <code className="font-mono text-sm font-semibold text-text-main">{classifier.name}</code>
                <Badge variant={classifier.isActive ? "success" : "default"}>
                  {classifier.isActive ? "active" : "inactive"}
                </Badge>
                <Badge>{classifier.mode === "threshold" ? "score + thresholds" : "per-level (argmax)"}</Badge>
                <span className="text-xs text-text-muted">{modelsSummary(classifier)}</span>
                <span className="text-xs text-text-muted">fallback: {classifier.fallbackLevel || "medium"}</span>
                <div className="ml-auto flex items-center gap-2">
                  <Toggle checked={classifier.isActive !== false} onChange={() => handleToggleActive(classifier)} size="sm" />
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={copied === classifier.name ? "check" : "content_copy"}
                    onClick={() => copy(classifier.name)}
                    title="Copy the tier name clients send as their effort value"
                  >
                    Copy tier
                  </Button>
                  <Button variant="ghost" size="sm" icon="download" onClick={() => handleExport(classifier)} title="Export this classifier as JSON">
                    Export
                  </Button>
                  <Button variant="ghost" size="sm" icon="edit" onClick={() => openEditModal(classifier)}>Edit</Button>
                  <Button variant="ghost" size="sm" icon="delete" onClick={() => handleDelete(classifier)}>Delete</Button>
                </div>
              </div>

              <div className="flex flex-col gap-2 rounded-[10px] bg-surface-2 p-3">
                <p className="text-xs font-medium text-text-main">Test</p>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                  <textarea
                    value={testTexts[classifier.id] || ""}
                    onChange={(e) => setTestTexts((prev) => ({ ...prev, [classifier.id]: e.target.value }))}
                    placeholder="Paste a prompt to classify…"
                    rows={3}
                    className="flex-1 resize-y rounded-[10px] border border-transparent bg-surface px-3 py-2 text-sm text-text-main placeholder-text-muted/70 focus:border-brand-500/40 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                  />
                  <Button
                    variant="secondary"
                    size="md"
                    loading={testState.running && testState.profileId === classifier.id}
                    onClick={() => handleTest(classifier)}
                    className="shrink-0"
                  >
                    Classify
                  </Button>
                </div>
                {testState.profileId === classifier.id && (testState.result || testState.error) && (
                  <div className="text-xs">
                    {testState.error ? (
                      <p className="text-red-500">{testState.error}</p>
                    ) : (
                      <div className="flex flex-col gap-1">
                        <p className="text-text-main">
                          → <span className="font-semibold">{testState.result.levels?.join(",") || testState.result.level || "no decision"}</span>
                          {testState.result.usedModel ? ` · via ${testState.result.usedModel}` : ""}
                          {testState.result.latencyMs ? ` · ${testState.result.latencyMs}ms` : ""}
                          {testState.result.levels?.length > 1 ? " · first supported level is sent" : ""}
                          {!testState.result.level && testState.result.error ? ` · ${testState.result.error}` : ""}
                        </p>
                        {testState.result.answers && (
                          <pre className="max-h-32 overflow-auto rounded bg-surface p-2 font-mono text-[11px] text-text-muted">
                            {JSON.stringify(testState.result.answers, null, 2)}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </Card>
        ))
      )}

      {showFormModal && form && (
        <ClassifierFormModal
          isOpen={showFormModal}
          onClose={() => { setShowFormModal(false); setEditing(null); }}
          onSave={handleSave}
          form={form}
          onChange={setForm}
          saving={saving}
          onPickModel={() => setShowModelSelect(true)}
        />
      )}

      <ModelSelectModal
        isOpen={showModelSelect}
        onClose={() => setShowModelSelect(false)}
        onSelect={(model) => {
          if (!model?.value) return;
          setForm((prev) => {
            if (!prev) return prev;
            const models = normalizeClassifierModels(
              [...prev.models, { model: model.value, timeoutMs: prev.timeoutMs }],
              prev.timeoutMs,
            );
            return { ...prev, models };
          });
        }}
        onDeselect={(model) => {
          if (!model?.value) return;
          setForm((prev) => {
            if (!prev) return prev;
            const models = prev.models.filter((m) => m.model !== model.value);
            return { ...prev, models: models.length > 0 ? models : [{ model: "", timeoutMs: prev.timeoutMs }] };
          });
        }}
        activeProviders={activeProviders}
        title="Add classifier model"
        kindFilter="systemone"
        addedModelValues={form?.models?.map((m) => m.model).filter(Boolean) || []}
        closeOnSelect={false}
      />

      <ConfirmModal
        isOpen={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={confirmState?.onConfirm}
        title={confirmState?.title}
        message={confirmState?.message}
        confirmText={confirmState?.confirmText}
      />
    </div>
  );
}
