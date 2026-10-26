import type { ReactNode } from "react";

interface DialogProps {
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}

/** Modal built on the native <dialog> element: focus trapping, Escape to close and backdrop come from the browser. */
export function Dialog({ title, description, onClose, children, wide = false }: DialogProps) {
  return (
    <dialog
      ref={(element) => {
        if (element && !element.open) element.showModal();
      }}
      className={`dialog ${wide ? "dialog-wide" : ""}`}
      aria-labelledby="dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog-body">
        <h2 id="dialog-title" className="dialog-title">
          {title}
        </h2>
        {description && <div className="dialog-description">{description}</div>}
        {children}
      </div>
    </dialog>
  );
}
