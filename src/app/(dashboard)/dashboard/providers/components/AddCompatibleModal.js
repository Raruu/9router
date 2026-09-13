"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { Badge, Button, Input, Modal, Select } from "@/shared/components";
import { COMPATIBLE_NODE_TYPES } from "@/shared/constants/providers";
import ProviderIconUpload from "@/shared/components/ProviderIconUpload";

const VARIANT_CONFIG = {
  openai: {
    type: "openai-compatible",
    defaultBaseUrl: "https://api.openai.com/v1",
    namePlaceholder: "OpenAI Compatible (Prod)",
    prefixPlaceholder: "oc-prod",
    baseUrlHint: "Use the base URL (ending in /v1) for your OpenAI-compatible API.",
    modelIdPlaceholder: "e.g. gpt-4, claude-3-opus",
    errorLabel: "OpenAI Compatible",
    hasApiType: true,
  },
  anthropic: {
    type: "anthropic-compatible",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    namePlaceholder: "Anthropic Compatible (Prod)",
    prefixPlaceholder: "ac-prod",
    baseUrlHint: "Use the base URL (ending in /v1) for your Anthropic-compatible API. The system will append /messages.",
    modelIdPlaceholder: "e.g. claude-3-opus",
    errorLabel: "Anthropic Compatible",
    hasApiType: false,
  },
};

const API_TYPE_OPTIONS = [
  { value: "chat", label: "Chat Completions" },
  { value: "responses", label: "Responses API" },
];

function AddCompatibleModal({ isOpen, onClose, onCreated }) {
  const [nodeType, setNodeType] = useState("openai-compatible");
  const variantKey = nodeType === "anthropic-compatible" ? "anthropic" : "openai";
  const config = VARIANT_CONFIG[variantKey];
  const selectedIsAnthropic = variantKey === "anthropic";
  const initialFormData = () => ({
    name: "",
    prefix: "",
    ...(config.hasApiType ? { apiType: "chat" } : {}),
    baseUrl: config.defaultBaseUrl,
  });

  const [formData, setFormData] = useState(initialFormData);
  const [submitting, setSubmitting] = useState(false);
  const [checkKey, setCheckKey] = useState("");
  const [checkModelId, setCheckModelId] = useState("");
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);
  const [iconFile, setIconFile] = useState(null);
  const [iconError, setIconError] = useState("");

  // Reset everything when opened; baseUrl resets are handled in the
  // type/apiType change handlers below (no render-chasing effects).
  useEffect(() => {
    if (!isOpen) return;
    setNodeType("openai-compatible");
    setFormData({ name: "", prefix: "", apiType: "chat", baseUrl: VARIANT_CONFIG.openai.defaultBaseUrl });
    setValidationResult(null);
    setCheckKey("");
    setCheckModelId("");
    setIconFile(null);
    setIconError("");
  }, [isOpen]);

  const handleTypeChange = (e) => {
    const next = e.target.value;
    const nextConfig = VARIANT_CONFIG[next === "anthropic-compatible" ? "anthropic" : "openai"];
    setNodeType(next);
    setFormData((prev) => ({
      name: prev.name,
      prefix: prev.prefix,
      ...(nextConfig.hasApiType ? { apiType: "chat" } : {}),
      baseUrl: nextConfig.defaultBaseUrl,
    }));
    setValidationResult(null);
  };

  const clearValidation = () => setValidationResult(null);

  const handleSubmit = async () => {
    if (!formData.name.trim() || !formData.prefix.trim() || !formData.baseUrl.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/provider-nodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          prefix: formData.prefix,
          ...(config.hasApiType ? { apiType: formData.apiType } : {}),
          baseUrl: formData.baseUrl,
          type: config.type,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        let node = data.node;
        if (iconFile) {
          const iconForm = new FormData();
          iconForm.set("icon", iconFile);
          const iconRes = await fetch(`/api/provider-nodes/${node.id}/icon`, { method: "PUT", body: iconForm });
          const icon = await iconRes.json();
          if (iconRes.ok) node = { ...node, iconVersion: icon.iconVersion };
          else setIconError(`Provider was created, but its icon was not uploaded: ${icon.error || "Unknown error"}`);
        }
        await onCreated(node, {
          apiKey: checkKey.trim() ? checkKey : "",
          validated: validationResult?.valid === true,
        });
        setFormData(initialFormData());
        setCheckKey("");
        setValidationResult(null);
        setIconFile(null);
      }
    } catch (error) {
      console.log(`Error creating ${config.errorLabel} node:`, error);
    } finally {
      setSubmitting(false);
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
          type: config.type,
          modelId: checkModelId.trim() || undefined,
        }),
      });
      const data = await res.json();
      setValidationResult(data);
    } catch {
      setValidationResult({ valid: false, error: "Network error" });
    } finally {
      setValidating(false);
    }
  };

  const renderValidationResult = () => {
    if (!validationResult) return null;
    const { valid, error, method } = validationResult;
    if (valid) {
      return (
        <>
          <Badge variant="success">Valid</Badge>
          {method === "chat" && (
            <span className="text-sm text-text-muted">(via inference test)</span>
          )}
        </>
      );
    }
    return (
      <div className="flex flex-col gap-1">
        <Badge variant="error">Invalid</Badge>
        {error && <span className="text-sm text-red-500">{error}</span>}
      </div>
    );
  };

  return (
    <Modal
      isOpen={isOpen}
      title={`Add ${selectedIsAnthropic ? "Anthropic" : "OpenAI"} Compatible`}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button onClick={onClose} variant="ghost">
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              !formData.name.trim() ||
              !formData.prefix.trim() ||
              !formData.baseUrl.trim() ||
              submitting
            }
          >
            {submitting ? "Creating..." : "Create"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <ProviderIconUpload file={iconFile} onChange={(file) => { setIconFile(file); setIconError(""); }} onRemove={() => setIconFile(null)} />
        {iconError && <p className="text-xs text-red-500">{iconError}</p>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder={config.namePlaceholder}
            hint="Required. A friendly label for this node."
          />
          <Input
            label="Prefix"
            value={formData.prefix}
            onChange={(e) => setFormData({ ...formData, prefix: e.target.value })}
            placeholder={config.prefixPlaceholder}
            hint="Required. Used as the provider prefix for model IDs."
          />
        </div>
        <div className={`grid grid-cols-1 gap-4 ${selectedIsAnthropic ? "" : "sm:grid-cols-2"}`}>
          <Select
            label="Provider Type"
            options={COMPATIBLE_NODE_TYPES}
            value={nodeType}
            onChange={handleTypeChange}
          />
          {config.hasApiType && (
            <Select
              label="API Type"
              options={API_TYPE_OPTIONS}
              value={formData.apiType}
              onChange={(e) => { setFormData({ ...formData, apiType: e.target.value, baseUrl: VARIANT_CONFIG.openai.defaultBaseUrl }); clearValidation(); }}
            />
          )}
        </div>
        <Input
          label="Base URL"
          value={formData.baseUrl}
          onChange={(e) => { setFormData({ ...formData, baseUrl: e.target.value }); clearValidation(); }}
          placeholder={config.defaultBaseUrl}
          hint={config.baseUrlHint}
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
                onChange={(e) => { setCheckKey(e.target.value); clearValidation(); }}
                className="flex-1"
              />
              <div className="pt-6">
                <Button
                  onClick={handleValidate}
                  disabled={!checkKey || validating || !formData.baseUrl.trim()}
                  variant="secondary"
                >
                  {validating ? "Checking..." : "Check"}
                </Button>
              </div>
            </div>
            <Input
              label="Model ID (optional)"
              value={checkModelId}
              onChange={(e) => { setCheckModelId(e.target.value); clearValidation(); }}
              placeholder={config.modelIdPlaceholder}
              hint="If provider lacks /models endpoint, enter a model ID to validate via chat/completions instead."
            />
            {renderValidationResult()}
          </div>
        </details>
      </div>
    </Modal>
  );
}

AddCompatibleModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onCreated: PropTypes.func.isRequired,
};

export default AddCompatibleModal;
