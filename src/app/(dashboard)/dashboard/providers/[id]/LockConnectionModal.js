"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import Modal from "@/shared/components/Modal";
import Input from "@/shared/components/Input";
import Select from "@/shared/components/Select";
import Button from "@/shared/components/Button";

const UNIT_OPTIONS = [
  { value: "minutes", label: "Minutes" },
  { value: "hours", label: "Hours" },
  { value: "days", label: "Days" },
];

const UNIT_MS = { minutes: 60 * 1000, hours: 60 * 60 * 1000, days: 24 * 60 * 60 * 1000 };
const MIN_MS = 60 * 1000;
const MAX_MS = 30 * 24 * 60 * 60 * 1000;

function computeDurationMs(value, unit) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = Math.floor(n) * (UNIT_MS[unit] || UNIT_MS.hours);
  if (ms < MIN_MS || ms > MAX_MS) return null;
  return ms;
}

export default function LockConnectionModal({ isOpen, connection, onConfirm, onClose }) {
  const [value, setValue] = useState("1");
  const [unit, setUnit] = useState("hours");
  const [saving, setSaving] = useState(false);

  // Reset the form each time the modal opens (render-time reset keyed on
  // isOpen, matching the repo's other keyed-modal pattern).
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setValue("1");
      setUnit("hours");
      setSaving(false);
    }
  }

  const durationMs = computeDurationMs(value, unit);
  const displayName = connection?.name?.trim()
    || connection?.email?.trim()
    || connection?.displayName?.trim()
    || "this connection";

  const handleConfirm = async () => {
    if (durationMs === null) return;
    setSaving(true);
    try {
      await onConfirm(durationMs);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Lock Connection"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="danger" onClick={handleConfirm} loading={saving} disabled={durationMs === null}>
            Lock
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text-muted">
          Locking <span className="font-medium text-text-main">{displayName}</span> blocks every model on this
          connection until the timer expires. Its accounts stay usable by other connections.
        </p>
        <div className="flex items-end gap-3">
          <Input
            label="Duration"
            type="number"
            min={1}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="flex-1"
          />
          <Select
            label="Unit"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            options={UNIT_OPTIONS}
            className="flex-1"
          />
        </div>
        {durationMs === null && (
          <p className="text-xs text-red-500">Enter a duration between 1 minute and 30 days.</p>
        )}
      </div>
    </Modal>
  );
}

LockConnectionModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  connection: PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
    email: PropTypes.string,
    displayName: PropTypes.string,
  }),
  onConfirm: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};