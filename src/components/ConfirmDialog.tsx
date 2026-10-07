import { useRef, useState, type ReactNode } from "react";
import { Modal } from "./Modal";

type ConfirmDialogProps = {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<void>;
  onClose: () => void;
};

export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  danger = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } catch {
      // The pane shows the error.
      setBusy(false);
    }
  }

  return (
    // Start on Cancel so a stray Enter never confirms a destructive action.
    <Modal
      title={title}
      initialFocus={cancelRef}
      locked={busy}
      onClose={onClose}
    >
      <div className="modal-body">{children}</div>
      <div className="modal-actions">
        <button
          ref={cancelRef}
          type="button"
          className="secondary"
          disabled={busy}
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          type="button"
          className={danger ? "primary danger" : "primary"}
          disabled={busy}
          onClick={() => void confirm()}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
