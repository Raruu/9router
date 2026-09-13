"use client";

import { useState, useEffect, useRef } from "react";
import { Card, Button, SegmentedControl } from "@/shared/components";
import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config";
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
  const [logs, setLogs] = useState([]);
  const [activeTab, setActiveTab] = useState("all");
  const [connected, setConnected] = useState(false);
  const logRef = useRef(null);

  const handleClear = async () => {
    try {
      await fetch("/api/translator/console-logs", { method: "DELETE" });
      // UI cleared via SSE "clear" event
    } catch (err) {
      console.error("Failed to clear console logs:", err);
    }
  };

  useEffect(() => {
    const es = new EventSource("/api/translator/console-logs/stream");

    es.onopen = () => setConnected(true);

    es.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "init") {
        setLogs(msg.logs.slice(-CONSOLE_LOG_CONFIG.maxLines));
      } else if (msg.type === "line") {
        setLogs((prev) => {
          const next = [...prev, msg.line];
          return next.length > CONSOLE_LOG_CONFIG.maxLines ? next.slice(-CONSOLE_LOG_CONFIG.maxLines) : next;
        });
      } else if (msg.type === "lines") {
        setLogs((prev) => {
          const next = [...prev, ...msg.lines];
          return next.length > CONSOLE_LOG_CONFIG.maxLines ? next.slice(-CONSOLE_LOG_CONFIG.maxLines) : next;
        });
      } else if (msg.type === "clear") {
        setLogs([]);
      }
    };

    es.onerror = () => setConnected(false);

    return () => es.close();
  }, []);

  // Auto-scroll to bottom on new logs
  useEffect(() => {
    if (!logRef.current) return;
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
