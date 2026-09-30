"use client";

// Per-kind endpoint editor for custom (OpenAI-compatible) provider nodes.
//
// Some providers host media on a different origin than chat — e.g. nararouter:
// chat/embeddings/systemone on router.bynara.id/v1, images/videos on
// api-images.bynara.id/v1. Each kind here optionally overrides the node's main
// base URL; leaving a field empty keeps that kind on the main URL. The
// canonical path (/images/generations, /audio/speech, …) is always appended at
// request time, so these fields take a base URL ending in /v1.
import PropTypes from "prop-types";
import Input from "./Input";

const KIND_FIELDS = [
  { id: "image", label: "Image generation", path: "/images/generations" },
  { id: "video", label: "Video", path: "/videos" },
  { id: "tts", label: "Text to speech", path: "/audio/speech" },
  { id: "stt", label: "Speech to text", path: "/audio/transcriptions" },
  { id: "embedding", label: "Embedding", path: "/embeddings" },
  { id: "systemone", label: "System One", path: "/systemone" },
];

export const KIND_ENDPOINT_FIELDS = KIND_FIELDS;

export default function KindBaseUrlsEditor({ value, onChange, disabled = false }) {
  const set = (kind, next) => onChange({ ...value, [kind]: next });

  const configured = KIND_FIELDS.filter((f) => (value[f.id] || "").trim()).length;

  return (
    <details className="rounded-lg border border-border-subtle px-3 py-2">
      <summary className="cursor-pointer text-sm font-medium text-text-muted hover:text-primary">
        Per-kind endpoints (optional){configured > 0 ? ` — ${configured} set` : ""}
      </summary>
      <div className="flex flex-col gap-3 pt-3">
        <p className="text-xs text-text-muted">
          Use these when a kind lives on a different host than chat (e.g. image and
          video on a media origin). Enter the base URL ending in <code>/v1</code>;
          the endpoint path is appended automatically. Empty fields use the main
          base URL.
        </p>
        <div className="flex flex-col gap-3">
          {KIND_FIELDS.map((field) => (
            <Input
              key={field.id}
              label={field.label}
              value={value[field.id] || ""}
              onChange={(e) => set(field.id, e.target.value)}
              placeholder="https://api-images.example.com/v1"
              hint={field.path}
              disabled={disabled}
            />
          ))}
        </div>
      </div>
    </details>
  );
}

KindBaseUrlsEditor.propTypes = {
  value: PropTypes.object,
  onChange: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
};
