"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { Button, Badge, Input, Modal, Select } from "@/shared/components";
import { COMPATIBLE_NODE_TYPES } from "@/shared/constants/providers";
import ProviderIconUpload from "@/shared/components/ProviderIconUpload";

export default function EditCompatibleNodeModal({ isOpen, node, onSave, onClose }) {
  const [formData, setFormData] = useState({
    name: "",
    prefix: "",
    type: "openai-compatible",
    apiType: "chat",
    baseUrl: "https://api.openai.com/v1",
  });
  const [saving, setSaving] = useState(false);
  const [checkKey, setCheckKey] = useState("");
  const [checkModelId, setCheckModelId] = useState("");
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);
  const [iconFile, setIconFile] = useState(null);
  const [removeIcon, setRemoveIcon] = useState(false);
  const [iconError, setIconError] = useState("");

  useEffect(() => {
    if (node) {
      const nodeType = node.type === "anthropic-compatible" ? "anthropic-compatible" : "openai-compatible";
      setFormData({
        name: node.name || "",
        prefix: node.prefix || "",
        type: nodeType,
        apiType: node.apiType || "chat",
        baseUrl: node.baseUrl || (nodeType === "anthropic-compatible" ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1"),
      });
      setIconFile(null);
      setRemoveIcon(false);
      setIconError("");
    }
  }, [node]);

  const selectedIsAnthropic = formData.type === "anthropic-compatible";
  const typeChanged = Boolean(node) && formData.type !== node.type;

  const apiTypeOptions = [
    { value: "chat", label: "Chat Completions" },
    { value: "responses", label: "Responses API" },
  ];

  const handleSubmit = async () => {
    if (!formData.name.trim() || !formData.prefix.trim() || !formData.baseUrl.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: formData.name,
        prefix: formData.prefix,
        baseUrl: formData.baseUrl,
        type: formData.type,
      };
      if (!selectedIsAnthropic) {
        payload.apiType = formData.apiType;
      }
      const result = await onSave({ ...payload, iconFile, removeIcon });
      if (result?.iconError) setIconError(result.iconError);
    } finally {
      setSaving(false);
    }
  };

  const handleValidate = async () => {
    setValidating(true);
    try {
      const res = await fetch("/api/provider-nodes/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: formData.baseUrl,
          apiKey: checkKey,
          type: selectedIsAnthropic ? "anthropic-compatible" : "openai-compatible",
          modelId: checkModelId.trim() || undefined
        }),
      });
      const data = await res.json();
      setValidationResult(data.valid ? "success" : "failed");
    } catch {
      setValidationResult("failed");
    } finally {
      setValidating(false);
    }
  };

  const canSave = formData.name.trim() && formData.prefix.trim() && formData.baseUrl.trim() && !saving;

  if (!node) return null;

  return (
    <Modal
      isOpen={isOpen}
      title={`Edit ${selectedIsAnthropic ? "Anthropic" : "OpenAI"} Compatible`}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button onClick={onClose} variant="ghost">
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSave}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <ProviderIconUpload
          file={iconFile}
          providerId={node.id}
          iconVersion={removeIcon ? null : node.iconVersion}
          onChange={(file) => { setIconFile(file); setRemoveIcon(false); setIconError(""); }}
          onRemove={() => { setIconFile(null); setRemoveIcon(true); }}
        />
        {iconError && <p className="text-xs text-red-500">{iconError}</p>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder={`${selectedIsAnthropic ? "Anthropic" : "OpenAI"} Compatible (Prod)`}
            hint="Required. A friendly label for this node."
          />
          <Input
            label="Prefix"
            value={formData.prefix}
            onChange={(e) => setFormData({ ...formData, prefix: e.target.value })}
            placeholder={selectedIsAnthropic ? "ac-prod" : "oc-prod"}
            hint="Required. Used as the provider prefix for model IDs."
          />
        </div>
        <div className={`grid grid-cols-1 gap-4 ${selectedIsAnthropic ? "" : "sm:grid-cols-2"}`}>
          <Select
            label="Provider Type"
            options={COMPATIBLE_NODE_TYPES}
            value={formData.type}
            onChange={(e) => setFormData({ ...formData, type: e.target.value })}
            hint="Switching type migrates connections and models to a new provider."
          />
          {!selectedIsAnthropic && (
            <Select
              label="API Type"
              options={apiTypeOptions}
              value={formData.apiType}
              onChange={(e) => setFormData({ ...formData, apiType: e.target.value })}
            />
          )}
        </div>
        {typeChanged && (
          <p className="text-xs text-text-muted">
            Switching to {selectedIsAnthropic ? "Anthropic" : "OpenAI"} Compatible moves this node to a new
            provider id. Connections, models, aliases and settings move with it automatically.
          </p>
        )}
        <Input
          label="Base URL"
          value={formData.baseUrl}
          onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
          placeholder={selectedIsAnthropic ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1"}
          hint={`Use the base URL (ending in /v1) for your ${selectedIsAnthropic ? "Anthropic" : "OpenAI"}-compatible API.`}
        />
        <details className="rounded-lg border border-border-subtle px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium text-text-muted hover:text-primary">
            Test connection (optional)
          </summary>
          <div className="flex flex-col gap-4 pt-3">
            <div className="flex gap-2">
              <Input
                label="API Key (for Check)"
                type="password"
                value={checkKey}
                onChange={(e) => setCheckKey(e.target.value)}
                className="flex-1"
              />
              <div className="pt-6">
                <Button onClick={handleValidate} disabled={!checkKey || validating || !formData.baseUrl.trim()} variant="secondary">
                  {validating ? "Checking..." : "Check"}
                </Button>
              </div>
            </div>
            <Input
              label="Model ID (optional)"
              value={checkModelId}
              onChange={(e) => setCheckModelId(e.target.value)}
              placeholder="e.g. my-model-id"
              hint="If provider lacks /models endpoint, enter a model ID to validate via chat/completions instead."
            />
            {validationResult && (
              <Badge variant={validationResult === "success" ? "success" : "error"}>
                {validationResult === "success" ? "Valid" : "Invalid"}
              </Badge>
            )}
          </div>
        </details>
      </div>
    </Modal>
  );
}

EditCompatibleNodeModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  node: PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
    prefix: PropTypes.string,
    type: PropTypes.string,
    apiType: PropTypes.string,
    baseUrl: PropTypes.string,
    iconVersion: PropTypes.number,
  }),
  onSave: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};
