"use client";

import { useState, type ReactNode } from "react";
import { Button } from "./Button";
import { Dialog } from "./Dialog";

interface ConfirmDialogProps {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  isDangerous?: boolean;
  /** The user must type this exact text before the action is enabled (for the most destructive actions). */
  requiredText?: string;
  isConfirmDisabled?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  children?: ReactNode;
}

/** Confirmation required before any destructive action. */
export function ConfirmDialog({ title, description, confirmLabel, isDangerous = false, requiredText, isConfirmDisabled = false, onConfirm, onCancel, children }: ConfirmDialogProps) {
  const [typedText, setTypedText] = useState("");
  const [isPending, setIsPending] = useState(false);
  const canConfirm = !isPending && !isConfirmDisabled && (requiredText === undefined || typedText === requiredText);

  async function confirm() {
    setIsPending(true);
    try {
      await onConfirm();
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Dialog title={title} description={description} onClose={onCancel}>
      {children}
      {requiredText !== undefined && (
        <label className="field">
          <span>
            Type <code>{requiredText}</code> to confirm
          </span>
          <input value={typedText} onChange={(event) => setTypedText(event.target.value)} autoComplete="off" spellCheck={false} />
        </label>
      )}
      <div className="dialog-actions">
        <Button variant="ghost" onClick={onCancel} disabled={isPending}>
          Cancel
        </Button>
        <Button variant={isDangerous ? "danger" : "primary"} onClick={confirm} disabled={!canConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
