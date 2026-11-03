import { openUrl } from "@tauri-apps/plugin-opener";
import type { MouseEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Schemes a note's link may open; anything else, such as `file:`, is ignored. */
const OPENABLE = /^(https?|mailto):/i;

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
              if (!href || !OPENABLE.test(href)) return;
              void openUrl(href).catch(() => undefined);
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
