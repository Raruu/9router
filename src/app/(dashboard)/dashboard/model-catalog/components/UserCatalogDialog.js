"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Button, Input, Modal, Select } from "@/shared/components";

const BOOLEAN_FIELDS = [
  ["vision", "Vision"],
  ["pdf", "PDF"],
  ["audioInput", "Audio input"],
  ["videoInput", "Video input"],
  ["imageOutput", "Image output"],
  ["audioOutput", "Audio output"],
  ["tools", "Tools"],
  ["reasoning", "Reasoning"],
];

const PRICE_FIELDS = [
  ["input", "Input"],
  ["output", "Output"],
  ["cached", "Cached input"],
  ["reasoning", "Reasoning"],
  ["cache_creation", "Cache creation"],
];

const TRI_STATE_OPTIONS = [
  { value: "inherit", label: "Inherit" },
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

function emptyForm() {
  return {
    id: null,
    provider: "*",
    pattern: "",
    matchType: "exact",
    name: "",
    capabilities: Object.fromEntries(BOOLEAN_FIELDS.map(([key]) => [key, "inherit"])),
    contextWindow: "",
    maxOutput: "",
    pricing: Object.fromEntries(PRICE_FIELDS.map(([key]) => [key, ""])),
  };
}

function editForm(entry) {
  const form = emptyForm();
  const capabilities = entry.capabilities ?? entry.caps ?? entry.data?.capabilities ?? entry.data?.caps ?? {};
  const pricing = entry.pricing ?? entry.data?.pricing ?? {};
  return {
    ...form,
    id: entry.id ?? null,
    provider: entry.provider ?? "*",
    pattern: entry.pattern ?? entry.model ?? entry.modelId ?? "",
    matchType: entry.matchType ?? (entry.pattern?.includes("*") ? "glob" : "exact"),
    name: entry.name ?? "",
    capabilities: Object.fromEntries(BOOLEAN_FIELDS.map(([key]) => [
      key,
      capabilities[key] === true ? "yes" : capabilities[key] === false ? "no" : "inherit",
    ])),
    contextWindow: entry.contextWindow ?? entry.data?.contextWindow ?? capabilities.contextWindow ?? "",
    maxOutput: entry.maxOutput ?? entry.data?.maxOutput ?? capabilities.maxOutput ?? "",
    pricing: Object.fromEntries(PRICE_FIELDS.map(([key]) => [key, pricing[key] ?? ""])),
  };
}

function toNumber(value) {
  return value === "" ? null : Number(value);
}

export default function UserCatalogDialog({ isOpen, entry, saving, onClose, onSave }) {
  const [form, setForm] = useState(() => entry ? editForm(entry) : emptyForm());
  const [error, setError] = useState("");
  const editing = Boolean(entry);

  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const updateCapability = (field, value) => setForm((current) => ({
    ...current,
    capabilities: { ...current.capabilities, [field]: value },
  }));
  const updatePrice = (field, value) => setForm((current) => ({
    ...current,
    pricing: { ...current.pricing, [field]: value },
  }));

  const submit = async (event) => {
    event.preventDefault();
    const provider = form.provider.trim() || "*";
    const pattern = form.pattern.trim();
    if (!pattern) {
      setError("Model pattern is required.");
      return;
    }
    if (form.matchType === "glob" && !pattern.includes("*")) {
      setError("A glob pattern must contain *.");
      return;
    }
    if (form.matchType === "exact" && pattern.includes("*")) {
      setError("An exact pattern cannot contain *.");
      return;
    }
    setError("");
    await onSave({
      id: form.id,
      provider,
      pattern,
      matchType: form.matchType,
      name: editing ? (form.name.trim() || null) : null,
      capabilities: Object.fromEntries(Object.entries(form.capabilities).map(([key, value]) => [
        key,
        value === "inherit" ? null : value === "yes",
      ])),
      contextWindow: toNumber(form.contextWindow),
      maxOutput: toNumber(form.maxOutput),
      pricing: Object.fromEntries(Object.entries(form.pricing).map(([key, value]) => [key, toNumber(value)])),
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editing ? "Edit user model" : "Add user model"}
      size="full"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" form="user-catalog-form" loading={saving}>{editing ? "Save changes" : "Add model"}</Button>
        </>
      }
    >
      <form id="user-catalog-form" onSubmit={submit} className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Match type" value={form.matchType} onChange={(event) => update("matchType", event.target.value)} options={[{ value: "exact", label: "Exact" }, { value: "glob", label: "Glob" }]} disabled={editing} />
          <Input label="Model pattern" value={form.pattern} onChange={(event) => update("pattern", event.target.value)} placeholder={form.matchType === "glob" ? "*claude*sonnet*" : "claude-sonnet-4-6"} required disabled={editing} hint={editing ? "The pattern cannot be changed after creation." : undefined} />
        </div>

        <fieldset>
          <legend className="mb-3 text-sm font-semibold">Capabilities</legend>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {BOOLEAN_FIELDS.map(([key, label]) => (
              <Select key={key} label={label} value={form.capabilities[key]} onChange={(event) => updateCapability(key, event.target.value)} options={TRI_STATE_OPTIONS} />
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-3 text-sm font-semibold">Token limits</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input type="number" min="1" step="1" label="Context window" value={form.contextWindow} onChange={(event) => update("contextWindow", event.target.value)} placeholder="Inherit" />
            <Input type="number" min="1" step="1" label="Max output" value={form.maxOutput} onChange={(event) => update("maxOutput", event.target.value)} placeholder="Inherit" />
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-1 text-sm font-semibold">Pricing</legend>
          <p className="mb-3 text-xs text-text-muted">USD per million tokens</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {PRICE_FIELDS.map(([key, label]) => (
              <Input key={key} type="number" min="0" step="any" label={label} value={form.pricing[key]} onChange={(event) => updatePrice(key, event.target.value)} placeholder="Inherit" />
            ))}
          </div>
        </fieldset>

        {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</p>}
      </form>
    </Modal>
  );
}

UserCatalogDialog.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  entry: PropTypes.object,
  saving: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSave: PropTypes.func.isRequired,
};
