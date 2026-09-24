"use client";

import { useState, useMemo } from "react";
import PropTypes from "prop-types";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

const COLORS = ["#6366f1", "#14b8a6", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#10b981", "#f97316"];

const fmtTokens = (n) => {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n || 0);
};

const truncate = (s, max) => (s && s.length > max ? s.slice(0, max) + "…" : s || "");

// Labels sit on the y-axis now (horizontal rows), so the width has to track the
// longest visible name — a fixed 90px cuts off most provider ids.
const labelWidth = (rows) => {
  const longest = rows.reduce((m, r) => Math.max(m, (r.fullName || r.name || "").length), 0);
  return Math.min(160, Math.max(70, longest * 6.5 + 12));
};

export default function ProviderBarChart({ byProvider }) {
  const [viewMode, setViewMode] = useState("tokens");

  const chartData = useMemo(() => {
    if (!byProvider) return [];
    return Object.entries(byProvider)
      .map(([id, data]) => {
        // `label` (server-derived from the node prefix) is display-only; the
        // raw id stays the row identity so two nodes sharing one prefix don't
        // collapse into a single bar.
        const display = data.label || id;
        return {
          fullName: display,
          name: truncate(display, 20),
          tokens: (data.promptTokens || 0) + (data.completionTokens || 0),
          requests: data.requests || 0,
        };
      })
      .filter((d) => d[viewMode] > 0)
      .sort((a, b) => b[viewMode] - a[viewMode]);
  }, [byProvider, viewMode]);

  const fmt = viewMode === "tokens" ? fmtTokens : String;
  const label = viewMode === "tokens" ? "Tokens" : "Requests";
  const height = Math.max(140, chartData.length * 24 + 40);
  const width = labelWidth(chartData);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-text-muted uppercase tracking-wide">By Provider</span>
        <div className="grid grid-cols-2 items-center gap-1 rounded-lg border border-border bg-bg-subtle p-1">
          <button
            onClick={() => setViewMode("tokens")}
            className={`px-2.5 py-0.5 rounded-md text-xs font-medium transition-colors ${viewMode === "tokens" ? "bg-primary text-white shadow-sm" : "text-text-muted hover:text-text hover:bg-bg-hover"}`}
          >
            Tokens
          </button>
          <button
            onClick={() => setViewMode("requests")}
            className={`px-2.5 py-0.5 rounded-md text-xs font-medium transition-colors ${viewMode === "requests" ? "bg-primary text-white shadow-sm" : "text-text-muted hover:text-text hover:bg-bg-hover"}`}
          >
            Requests
          </button>
        </div>
      </div>

      {!chartData.length ? (
        <div className="h-44 flex items-center justify-center text-text-muted text-sm">No provider usage yet</div>
      ) : (
        <div className="max-h-[420px] overflow-y-auto">
          <ResponsiveContainer width="100%" height={height}>
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ top: 4, right: 16, left: 4, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} horizontal={false} />
              <XAxis
                type="number"
                tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.5 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={fmt}
              />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.7 }}
                tickLine={false}
                axisLine={false}
                width={width}
                interval={0}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--color-bg)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "8px",
                  fontSize: "12px",
                }}
                itemStyle={{ color: "var(--color-text-main)" }}
                labelStyle={{ color: "var(--color-text-muted)" }}
                labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName || ""}
                formatter={(value) => [fmt(value), label]}
              />
              <Bar dataKey={viewMode} radius={[0, 4, 4, 0]}>
                {chartData.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} fillOpacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

ProviderBarChart.propTypes = {
  byProvider: PropTypes.object,
};
