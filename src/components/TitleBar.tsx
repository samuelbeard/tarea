import type { ReactNode } from "react";

type TitleBarProps = {
  actions?: ReactNode;
};

const macApp =
  typeof navigator !== "undefined" &&
  navigator.userAgent.includes("Macintosh") &&
  "__TAURI_INTERNALS__" in window;

export function TitleBar({ actions }: TitleBarProps) {
  return (
    <header
      className={macApp ? "titlebar has-traffic-lights" : "titlebar"}
      data-tauri-drag-region="deep"
    >
      <p className="titlebar-title">Tarea</p>
      {actions ? <div className="titlebar-actions">{actions}</div> : null}
    </header>
  );
}
