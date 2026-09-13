"use client";

import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import Image from "next/image";

const ACCEPTED_TYPES = "image/png,image/jpeg,image/webp,image/svg+xml";

export default function ProviderIconUpload({ file, iconVersion, providerId, onChange, onRemove }) {
  const [filePreview, setFilePreview] = useState(null);
  const previewRef = useRef(null);
  const savedIconSrc = iconVersion && providerId
    ? `/api/provider-nodes/${encodeURIComponent(providerId)}/icon?v=${encodeURIComponent(iconVersion)}`
    : null;
  const iconSrc = file ? filePreview : savedIconSrc;

  useEffect(() => () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
  }, []);

  const handleFileChange = (event) => {
    const nextFile = event.target.files?.[0] || null;
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = nextFile ? URL.createObjectURL(nextFile) : null;
    setFilePreview(previewRef.current);
    onChange(nextFile);
  };

  const handleRemove = () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = null;
    setFilePreview(null);
    onRemove();
  };

  return (
    <div className="rounded-lg border border-border-subtle p-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-primary/10">
          {iconSrc ? (
            <Image unoptimized src={iconSrc} alt={file ? "Selected provider icon" : "Current provider icon"} width={40} height={40} className="size-10 object-contain" />
          ) : (
            <span className="material-symbols-outlined text-[22px] leading-none text-primary">image</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <label className="block text-sm font-medium text-text-main" htmlFor="provider-icon-upload">Custom icon</label>
          <p className="text-xs text-text-muted">PNG, JPEG, WebP, or SVG. Converted to WebP, max 3 MB.</p>
        </div>
        {iconVersion && (
          <button type="button" onClick={handleRemove} className="text-xs text-red-500 hover:underline">Remove</button>
        )}
      </div>
      <input
        id="provider-icon-upload"
        type="file"
        accept={ACCEPTED_TYPES}
        className="mt-3 block w-full text-xs text-text-muted file:mr-3 file:rounded-md file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-primary hover:file:bg-primary/20"
        onChange={handleFileChange}
      />
      {file && <p className="mt-2 truncate text-xs text-text-muted">Ready to upload: {file.name}</p>}
    </div>
  );
}

ProviderIconUpload.propTypes = {
  file: PropTypes.any,
  iconVersion: PropTypes.number,
  providerId: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
};
