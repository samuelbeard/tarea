import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
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
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = document.activeElement;
    dialog.showModal();
    initialFocus?.current?.focus();
    return () => {
      dialog.close();
      // Put focus back where it was, unless that element has gone.
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [initialFocus]);

  return createPortal(
    <dialog
      ref={dialogRef}
      className={className ? `modal ${className}` : "modal"}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!locked) onClose();
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !locked) onClose();
      }}
    >
      <h2 id={titleId}>{title}</h2>
      {children}
    </dialog>,
    document.body,
  );
}
