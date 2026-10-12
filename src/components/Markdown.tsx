import { openUrl } from "@tauri-apps/plugin-opener";
import type { MouseEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Renders notes as markdown. Links open in the browser and don't start editing. */
export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => (
          <a
            href={href}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event: MouseEvent<HTMLAnchorElement>) => {
              event.preventDefault();
              event.stopPropagation();
              if (!href) return;
              void openUrl(href).catch(() => {
                window.open(href, "_blank", "noopener");
              });
            }}
          >
            {children}
          </a>
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
