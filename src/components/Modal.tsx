import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

type ModalProps = {
  title: string;
  className?: string;
  children: ReactNode;
  /** Focused when the modal opens; otherwise the first focusable element is. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** While true, Escape and backdrop clicks are ignored. */
  locked?: boolean;
  onClose: () => void;
};

export function Modal({
  title,
  className,
  children,
  initialFocus,
  locked = false,
  onClose,
}: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    initialFocus?.current?.focus();
    return () => dialog.close();
  }, [initialFocus]);

  return createPortal(
    <dialog
      ref={dialogRef}
      className={className ? `modal ${className}` : "modal"}
      aria-labelledby="modal-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!locked) onClose();
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !locked) onClose();
      }}
    >
      <h2 id="modal-title">{title}</h2>
      {children}
    </dialog>,
    document.body,
  );
}
