"use client";

import { useState, useEffect, useRef } from "react";
import { Card, Button, SegmentedControl } from "@/shared/components";
import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config";
import { CONSOLE_LOG_LIMITS, normalizeConsoleLogMaxLines } from "@/shared/utils/consoleLogLimits";
import { useNotificationStore } from "@/store/notificationStore";
import { isPinnedToBottom } from "@/shared/utils/scrollFollow";
import { LOG_CATEGORIES, buildConsoleLogFilename, buildConsoleLogText } from "./logCategories";

const LOG_LEVEL_COLORS = {
  LOG: "text-green-400",
  INFO: "text-blue-400",
  WARN: "text-yellow-400",
  ERROR: "text-red-400",
  DEBUG: "text-purple-400",
};

function colorLine(line) {
  const match = line.match(/\[(\w+)\]/g);
  const levelTag = match ? match[1]?.replace(/\[|\]/g, "") : null;
  const color = LOG_LEVEL_COLORS[levelTag] || "text-green-400";
  return <span className={color}>{line}</span>;
}

export default function ConsoleLogClient() {
  const notify = useNotificationStore();
  const [logs, setLogs] = useState([]);
  const [activeTab, setActiveTab] = useState("all");
  const [connected, setConnected] = useState(false);
  const [maxLinesInput, setMaxLinesInput] = useState(String(CONSOLE_LOG_CONFIG.maxLines));
  const [savingMaxLines, setSavingMaxLines] = useState(false);
  const logRef = useRef(null);

  // Live limit for the SSE callbacks: they are registered once on mount, so a
  // state read inside them would be stale after the user changes the value.
  const maxLinesRef = useRef(CONSOLE_LOG_CONFIG.maxLines);

  const applyMaxLines = (next) => {
    maxLinesRef.current = next;
    setMaxLinesInput(String(next));
    setLogs((prev) => (prev.length > next ? prev.slice(-next) : prev));
  };

  // Persisted value wins over the constant; the server trims its buffer to the
  // same limit, so an empty SSE init just means nothing is buffered yet.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const normalized = normalizeConsoleLogMaxLines(data.consoleLogMaxLines);
        if (normalized !== null) applyMaxLines(normalized);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const handleClear = async () => {
    try {
      await fetch("/api/translator/console-logs", { method: "DELETE" });
      // UI cleared via SSE "clear" event
    } catch (err) {
      console.error("Failed to clear console logs:", err);
    }
  };

  const saveMaxLines = async () => {
    const raw = maxLinesInput.trim();
    const numeric = Number(raw);
    const normalized = normalizeConsoleLogMaxLines(raw);
    if (normalized === null) {
      notify.error("Max lines must be a whole number");
      setMaxLinesInput(String(maxLinesRef.current));
      return;
    }
    // Tell the user when their input was clamped into the allowed range.
    if (numeric !== normalized) {
      notify.info(`Max lines limited to ${normalized} (allowed ${CONSOLE_LOG_LIMITS.min}–${CONSOLE_LOG_LIMITS.max})`);
    }
    const changed = normalized !== maxLinesRef.current;
    const previous = maxLinesRef.current;
    applyMaxLines(normalized);
    if (!changed) return;

    setSavingMaxLines(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consoleLogMaxLines: normalized }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        notify.error(err.error || "Failed to save max lines");
        // Server kept the old value — mirror that locally (trimmed lines stay
        // trimmed; a reload restores them from the server buffer).
        setMaxLinesInput(String(previous));
        maxLinesRef.current = previous;
        return;
      }
      notify.success(`Console log limit set to ${normalized} lines`);
    } catch {
      notify.error("Failed to save max lines");
      setMaxLinesInput(String(previous));
      maxLinesRef.current = previous;
    } finally {
      setSavingMaxLines(false);
    }
  };

  useEffect(() => {
    const es = new EventSource("/api/translator/console-logs/stream");

    es.onopen = () => setConnected(true);

    es.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "init") {
        // The server buffer is already trimmed to the persisted limit, so trust
        // its payload: trimming to the client default here would drop lines the
        // user configured to keep when this lands before the settings fetch.
        setLogs(msg.logs);
      } else if (msg.type === "line") {
        setLogs((prev) => {
          const next = [...prev, msg.line];
          return next.length > maxLinesRef.current ? next.slice(-maxLinesRef.current) : next;
        });
      } else if (msg.type === "lines") {
        setLogs((prev) => {
          const next = [...prev, ...msg.lines];
          return next.length > maxLinesRef.current ? next.slice(-maxLinesRef.current) : next;
        });
      } else if (msg.type === "clear") {
        setLogs([]);
      }
    };

    es.onerror = () => setConnected(false);

    return () => es.close();
  }, []);

  // Follow the tail only while the reader is already at it. Recorded on
  // scroll rather than read inside the effect: by the time the effect runs the
  // new lines are already laid out, so the element no longer reports where the
  // reader was before they arrived.
  const followTailRef = useRef(true);

  const handleLogScroll = () => {
    followTailRef.current = isPinnedToBottom(logRef.current);
  };

  // A tab switch replaces the visible list, so the reader's old position is
  // meaningless — re-pin to the newest line of the tab they just opened.
  useEffect(() => {
    followTailRef.current = true;
  }, [activeTab]);

  // Auto-scroll to bottom on new logs (only while already at the bottom)
  useEffect(() => {
    if (!logRef.current || !followTailRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs, activeTab]);

  const activeCategory = LOG_CATEGORIES.find((category) => category.id === activeTab) || LOG_CATEGORIES[0];
  const counts = Object.fromEntries(
    LOG_CATEGORIES.map((category) => [category.id, category.id === "all" ? logs.length : logs.filter(category.match).length]),
  );
  const visibleLogs = activeTab === "all" ? logs : logs.filter(activeCategory.match);

  const handleDownload = () => {
    const text = buildConsoleLogText(visibleLogs);
    if (!text) return;
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = buildConsoleLogFilename(activeTab);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="">
      <Card>
        <div className="flex flex-wrap items-center gap-2 px-4 pt-3 pb-2">
          <SegmentedControl
            options={LOG_CATEGORIES.map((category) => ({
              value: category.id,
              label: `${category.label} (${counts[category.id]})`,
            }))}
            value={activeTab}
            onChange={setActiveTab}
            size="sm"
          />
          <div className="ml-auto flex items-center gap-3">
            <label className="flex items-center gap-1.5" title={`Keeps the newest ${CONSOLE_LOG_LIMITS.min}–${CONSOLE_LOG_LIMITS.max} lines (server buffer and this view)`}>
              <span className="text-xs text-text-muted whitespace-nowrap">Max lines</span>
              <input
                type="number"
                min={CONSOLE_LOG_LIMITS.min}
                max={CONSOLE_LOG_LIMITS.max}
                step={1}
                value={maxLinesInput}
                disabled={savingMaxLines}
                onChange={(e) => setMaxLinesInput(e.target.value)}
                onBlur={saveMaxLines}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                className="w-20 rounded-md border border-border bg-background px-2 py-1 text-xs focus:border-primary focus:outline-none disabled:opacity-50"
              />
            </label>
            <span className={`text-xs ${connected ? "text-green-500" : "text-text-muted"}`}>
              {connected ? "Connected" : "Disconnected"}
            </span>
            <Button size="sm" variant="outline" icon="download" onClick={handleDownload} disabled={visibleLogs.length === 0}>
              Download
            </Button>
            <Button size="sm" variant="outline" icon="delete" onClick={handleClear}>
              Clear
            </Button>
          </div>
        </div>
        <div
          ref={logRef}
          onScroll={handleLogScroll}
          className="bg-black rounded-b-lg p-4 text-xs font-mono h-[calc(100vh-220px)] overflow-y-auto"
        >
          {visibleLogs.length === 0 ? (
            <span className="text-text-muted">
              {logs.length === 0 ? "No console logs yet." : `No ${activeCategory.label.toLowerCase()} logs yet.`}
            </span>
          ) : (
            <div className="space-y-0.5">
              {visibleLogs.map((line, i) => (
                <div key={i}>{colorLine(line)}</div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
