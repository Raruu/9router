"use client";

import { useEffect, useState } from "react";
import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";
import Input from "@/shared/components/Input";
import Toggle from "@/shared/components/Toggle";
import Modal from "@/shared/components/Modal";
import { cn } from "@/shared/utils/cn";

const fmtBytes = (n) => {
  if (!Number.isFinite(n)) return null;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
};

const ESTIMATE_DEBOUNCE_MS = 400;

// Asks the server for the dry-run size of a purge. `sectionsKey` is a stable
// string (sections joined) so the content dialog re-runs the estimate when the
// selection changes; the server caches by target+selection+file state.
//
// "Estimating" is derived, not stored: the result carries the key it belongs
// to, so a result for an older selection reads as stale. That keeps the effect
// free of synchronous setState (react-hooks/set-state-in-effect).
function usePurgeEstimate(target, sectionsKey = "") {
  const [state, setState] = useState(null); // { key, data }
  const key = target ? `${target}|${sectionsKey}` : "";

  useEffect(() => {
    if (!target) return undefined;
    let cancelled = false;
    const sections = sectionsKey ? sectionsKey.split(",") : null;

    // Debounced: rapid checkbox toggles collapse into one request.
    const timer = setTimeout(() => {
      fetch("/api/usage/purge/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sections ? { target, sections } : { target }),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!cancelled && data) setState({ key, data });
        })
        .catch((err) => console.error("Failed to estimate purge size:", err));
    }, ESTIMATE_DEBOUNCE_MS);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [target, sectionsKey, key]);

  const fresh = Boolean(state) && state.key === key;
  return { estimate: fresh ? state.data : null, estimating: !fresh };
}

// One line shown inside the purge dialogs: "Database size: 46.0 MB → ~0.2 MB".
// Renders nothing when the estimate is unavailable (unsupported driver, DB too
// large, no temp space) — the purge itself still works in those cases.
function EstimateLine({ estimate, estimating }) {
  const before = fmtBytes(estimate?.sizeBefore);
  const after = fmtBytes(estimate?.sizeAfter);

  if (!before || !after) {
    return estimating
      ? <p className="text-xs text-text-muted">Estimating database size…</p>
      : null;
  }

  return (
    <p className="rounded-lg border border-border bg-bg-subtle p-3 text-xs text-text-muted">
      Database size: <span className="font-mono text-text-main">{before}</span>
      {" → "}
      <span className="font-mono font-medium text-text-main">~{after}</span>
    </p>
  );
}

// Checkbox-gated confirm dialog. ConfirmModal can't disable its action button,
// so the destructive buttons live in a plain Modal whose Confirm stays disabled
// until the acknowledgement checkbox is ticked. Callers mount it only while
// open (keyed by target), so `acknowledged` resets by unmount — no effect needed.
function PurgeDialog({
  isOpen,
  target,
  title,
  description,
  checkboxLabel,
  note,
  confirmText,
  purging,
  onClose,
  onConfirm,
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const { estimate, estimating } = usePurgeEstimate(isOpen ? target : null);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={purging}>Cancel</Button>
          <Button
            variant="danger"
            onClick={onConfirm}
            loading={purging}
            disabled={!acknowledged}
          >
            {confirmText}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text-muted">{description}</p>

        <EstimateLine estimate={estimate} estimating={estimating} />

        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 p-3">
          <input
            type="checkbox"
            checked={acknowledged}
            disabled={purging}
            onChange={(event) => setAcknowledged(event.target.checked)}
            className="mt-0.5 size-3.5 shrink-0 accent-red-500"
          />
          <span className="text-sm font-medium text-text-main">{checkboxLabel}</span>
        </label>

        {note && <p className="text-xs text-text-muted">{note}</p>}
        <p className="text-xs font-medium text-red-500">This cannot be undone.</p>
      </div>
    </Modal>
  );
}

// The four payload fields stored per request detail, with drawer-facing labels.
const CONTENT_SECTIONS = [
  { key: "request", label: "1. Client Request (Input)" },
  { key: "providerRequest", label: "2. Provider Request (Translated)" },
  { key: "providerResponse", label: "3. Provider Response (Raw)" },
  { key: "response", label: "4. Client Response (Final)" },
];

// Content-only purge: section picker + acknowledgement. Keeps every row and its
// metadata; replaces the selected payloads with { redacted: true }.
function PurgeContentDialog({ isOpen, purging, onClose, onConfirm }) {
  const [sections, setSections] = useState(() => CONTENT_SECTIONS.map((s) => s.key));
  const [acknowledged, setAcknowledged] = useState(false);
  // Re-estimated as the selection changes (debounced inside the hook); the
  // server caches, so toggling back and forth is cheap.
  const { estimate, estimating } = usePurgeEstimate(
    isOpen ? "details-content" : null,
    sections.join(","),
  );

  const toggleSection = (key, checked) => {
    setSections((prev) => (checked ? [...prev, key] : prev.filter((s) => s !== key)));
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Purge request detail content"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={purging}>Cancel</Button>
          <Button
            variant="danger"
            onClick={() => onConfirm(sections)}
            loading={purging}
            disabled={!acknowledged || sections.length === 0}
          >
            Purge content
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text-muted">
          Deletes the stored payloads of the selected sections on every request detail.
          Rows and their metadata (tokens, latency, status) are kept.
        </p>

        <div className="flex flex-col gap-2 rounded-lg border border-border bg-bg-subtle p-3">
          {CONTENT_SECTIONS.map((section) => (
            <label key={section.key} className="flex cursor-pointer items-center gap-2 text-sm text-text-main">
              <input
                type="checkbox"
                checked={sections.includes(section.key)}
                disabled={purging}
                onChange={(event) => toggleSection(section.key, event.target.checked)}
                className="size-3.5 shrink-0 accent-red-500"
              />
              <span>{section.label}</span>
            </label>
          ))}
        </div>

        {sections.length > 0 && <EstimateLine estimate={estimate} estimating={estimating} />}

        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 p-3">
          <input
            type="checkbox"
            checked={acknowledged}
            disabled={purging}
            onChange={(event) => setAcknowledged(event.target.checked)}
            className="mt-0.5 size-3.5 shrink-0 accent-red-500"
          />
          <span className="text-sm font-medium text-text-main">
            I understand the selected request/response payloads will be permanently deleted.
          </span>
        </label>

        <p className="text-xs text-text-muted">
          Sections keep showing as <span className="font-mono">{"{ \"redacted\": true }"}</span> afterwards.
        </p>
        <p className="text-xs font-medium text-red-500">This cannot be undone.</p>
      </div>
    </Modal>
  );
}

export default function SettingsTab() {
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [retentionInput, setRetentionInput] = useState("");
  const [retentionSaving, setRetentionSaving] = useState(false);
  const [retentionStatus, setRetentionStatus] = useState({ type: "", message: "" });
  const [purgeTarget, setPurgeTarget] = useState(null); // "overview" | "details" | null
  const [purging, setPurging] = useState(false);
  const [purgeStatus, setPurgeStatus] = useState({ type: "", message: "" });

  // State lands in .then() callbacks, not the effect body: react-hooks/
  // set-state-in-effect treats a synchronous setState call as a cascading
  // render, and UsageStats uses the same fetch-chain shape.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setSettings(data);
        const days = data?.observabilityRetentionDays;
        setRetentionInput(Number.isFinite(Number(days)) ? String(days) : "60");
      })
      .catch((err) => console.error("Failed to fetch settings:", err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const patchSetting = async (patch) => {
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      const data = await res.json();
      setSettings((prev) => ({ ...prev, ...data }));
      return data;
    }
    return null;
  };

  const updateObservabilityEnabled = async (enabled) => {
    await patchSetting({ enableObservability: enabled });
  };

  const updateObservabilityShowBodies = async (enabled) => {
    await patchSetting({ observabilityShowBodies: enabled });
  };

  const saveRetention = async () => {
    // Guard the empty field explicitly: Number("") is 0, which would silently
    // save "keep forever" when the user just cleared the input.
    const raw = String(retentionInput).trim();
    const days = Number(raw);
    if (!raw || !Number.isInteger(days) || days < 0 || days > 3650) {
      setRetentionStatus({ type: "error", message: "Enter a whole number of days between 0 and 3650" });
      return;
    }
    setRetentionSaving(true);
    setRetentionStatus({ type: "", message: "" });
    try {
      const data = await patchSetting({ observabilityRetentionDays: days });
      if (data) {
        setRetentionStatus({ type: "success", message: "Retention window saved" });
      } else {
        setRetentionStatus({ type: "error", message: "Failed to save retention window" });
      }
    } finally {
      setRetentionSaving(false);
    }
  };

  const runPurge = async (sections = null) => {
    const target = purgeTarget;
    if (!target) return;
    setPurging(true);
    setPurgeStatus({ type: "", message: "" });
    try {
      const res = await fetch("/api/usage/purge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sections ? { target, sections } : { target }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Purge failed");

      const before = fmtBytes(data.sizeBefore);
      const after = fmtBytes(data.sizeAfter);
      const freed = before && after ? ` Database ${before} → ${after}.` : "";
      const countText = target === "details-content"
        ? `Cleared content on ${data.updated ?? 0} row${data.updated === 1 ? "" : "s"}.`
        : `Deleted ${data.deleted ?? 0} row${data.deleted === 1 ? "" : "s"}.`;
      setPurgeStatus({ type: "success", message: `${countText}${freed}` });
      setPurgeTarget(null);
    } catch (err) {
      setPurgeStatus({ type: "error", message: err.message || "Purge failed" });
    } finally {
      setPurging(false);
    }
  };

  const observabilityEnabled = settings.enableObservability === true;
  const observabilityShowBodies = settings.observabilityShowBodies === true;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {/* Observability */}
      <Card>
        <div className="flex items-center gap-3 mb-4">
          <div className="size-10 rounded-lg bg-orange-500/10 text-orange-500 flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-[20px]">monitoring</span>
          </div>
          <div>
            <h3 className="text-base sm:text-lg font-semibold">Observability</h3>
            <p className="text-xs text-text-muted">
              Controls the Details tab, which stores request and response payloads.
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-4">
          <div className="flex items-start sm:items-center justify-between gap-4">
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm sm:text-base">Enable Observability</p>
              <p className="text-xs sm:text-sm text-text-muted">
                Record request details for inspection in the logs view
              </p>
            </div>
            <Toggle
              checked={observabilityEnabled}
              onChange={updateObservabilityEnabled}
              disabled={loading}
            />
          </div>
          <div className="flex items-start sm:items-center justify-between gap-4 pt-4 border-t border-border">
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm sm:text-base">Show request bodies</p>
              <p className="text-xs sm:text-sm text-text-muted">
                Serve full request/response payloads in request details instead of
                redacting them. Disable this if the dashboard is shared with others.
              </p>
            </div>
            <Toggle
              checked={observabilityShowBodies}
              onChange={updateObservabilityShowBodies}
              disabled={loading}
            />
          </div>
        </div>
      </Card>

      {/* Retention */}
      <Card>
        <div className="flex items-center gap-3 mb-4">
          <div className="size-10 rounded-lg bg-blue-500/10 text-blue-500 flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-[20px]">schedule</span>
          </div>
          <div>
            <h3 className="text-base sm:text-lg font-semibold">Request-detail retention</h3>
            <p className="text-xs text-text-muted">
              How long stored request details are kept before automatic pruning.
            </p>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <Input
            label="Retention window (days)"
            type="number"
            min={0}
            max={3650}
            step={1}
            value={retentionInput}
            onChange={(e) => setRetentionInput(e.target.value)}
            disabled={loading || retentionSaving}
            className="sm:w-48"
          />
          <Button
            variant="primary"
            onClick={saveRetention}
            loading={retentionSaving}
            disabled={loading}
          >
            Save
          </Button>
        </div>
        <p className="mt-3 text-xs text-text-muted">
          Applies to request details only (Details tab payloads). <span className="font-medium">0</span> keeps
          them forever. Overview usage history (cards, charts, tables) is never pruned automatically.
        </p>
        {retentionStatus.message && (
          <p className={cn(
            "mt-2 text-xs sm:text-sm",
            retentionStatus.type === "error" ? "text-red-500" : "text-green-600 dark:text-green-400"
          )}>
            {retentionStatus.message}
          </p>
        )}
      </Card>

      {/* Data management */}
      <Card className="border-red-500/30">
        <div className="flex items-center gap-3 mb-4">
          <div className="size-10 rounded-lg bg-red-500/10 text-red-500 flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-[20px]">delete_forever</span>
          </div>
          <div>
            <h3 className="text-base sm:text-lg font-semibold">Purge data</h3>
            <p className="text-xs text-text-muted">
              Permanently delete stored usage data. API-key quota counters are not affected.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg bg-bg border border-border">
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">Overview data</p>
              <p className="text-xs text-text-muted">
                Deletes all usage history and daily rollups: Overview cards, charts and
                tables, and the Logs view.
              </p>
            </div>
            <Button
              variant="danger"
              size="sm"
              icon="delete_sweep"
              onClick={() => { setPurgeStatus({ type: "", message: "" }); setPurgeTarget("overview"); }}
              disabled={purging}
              className="shrink-0"
            >
              Purge Overview data
            </Button>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg bg-bg border border-border">
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">Request details</p>
              <p className="text-xs text-text-muted">
                Deletes all stored request/response payloads shown in the Details tab.
              </p>
            </div>
            <Button
              variant="danger"
              size="sm"
              icon="delete_sweep"
              onClick={() => { setPurgeStatus({ type: "", message: "" }); setPurgeTarget("details"); }}
              disabled={purging}
              className="shrink-0"
            >
              Purge request details
            </Button>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg bg-bg border border-border">
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">Request detail content only</p>
              <p className="text-xs text-text-muted">
                Deletes the stored request/response payloads of the sections you pick, but
                keeps every row and its metadata (tokens, latency, status).
              </p>
            </div>
            <Button
              variant="danger"
              size="sm"
              icon="backspace"
              onClick={() => { setPurgeStatus({ type: "", message: "" }); setPurgeTarget("details-content"); }}
              disabled={purging}
              className="shrink-0"
            >
              Purge content only
            </Button>
          </div>
        </div>

        {purgeStatus.message && (
          <p className={cn(
            "mt-3 text-xs sm:text-sm",
            purgeStatus.type === "error" ? "text-red-500" : "text-green-600 dark:text-green-400"
          )}>
            {purgeStatus.message}
          </p>
        )}
      </Card>

      {purgeTarget === "overview" && (
        <PurgeDialog
          isOpen
          target="overview"
          title="Purge Overview data"
          description="All usage history, daily rollups and the lifetime request counter will be deleted. Overview cards, charts, tables and the Logs view will be empty."
          checkboxLabel="I understand all Overview usage history (requests, tokens, cost, charts, Logs) will be permanently deleted."
          note="API-key quota counters (used tokens/requests per key) are not affected."
          confirmText="Purge"
          purging={purging}
          onClose={() => setPurgeTarget(null)}
          onConfirm={runPurge}
        />
      )}

      {purgeTarget === "details" && (
        <PurgeDialog
          isOpen
          target="details"
          title="Purge request details"
          description="All stored request and response payloads will be deleted. The Details tab will be empty; new requests will be recorded again if Observability is enabled."
          checkboxLabel="I understand all stored request/response details will be permanently deleted."
          note="Overview usage history (cards, charts, tables) is not affected."
          confirmText="Purge"
          purging={purging}
          onClose={() => setPurgeTarget(null)}
          onConfirm={runPurge}
        />
      )}

      {purgeTarget === "details-content" && (
        <PurgeContentDialog
          isOpen
          purging={purging}
          onClose={() => setPurgeTarget(null)}
          onConfirm={runPurge}
        />
      )}
    </div>
  );
}
