"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { cn } from "@/lib/utils";

interface MarkdownProps {
  content: string;
  className?: string;
}

/**
 * Renders LLM prose as markdown. Used for source_findings / reasoning where the model emits
 * citation links like `[apnews.com](https://...)`. ReactMarkdown is safe by default — it does not
 * pass through raw HTML — so user-supplied markup can't inject scripts.
 *
 *  - remarkGfm: tables, strikethrough, autolinks, task lists.
 *  - remarkBreaks: a single newline in source becomes <br>, matching the old whitespace-pre-wrap
 *    behavior that authors of these prose blocks rely on.
 */
export function Markdown({ content, className }: MarkdownProps) {
  return (
    <div className={cn("text-sm leading-relaxed text-[var(--text)] [overflow-wrap:anywhere] break-words", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="text-[var(--accent)] hover:underline [overflow-wrap:anywhere]"
            >
              {children}
            </a>
          ),
          ul: ({ children }) => <ul className="list-disc pl-5 mb-2 last:mb-0 space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 last:mb-0 space-y-1">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold text-[var(--text)]">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          code: ({ children }) => (
            <code className="mono text-[12px] px-1 py-0.5 rounded bg-[var(--bg-elev-2)] text-[var(--text)]">{children}</code>
          ),
          pre: ({ children }) => (
            <pre className="mono text-[12px] p-2 rounded bg-[var(--bg-elev-2)] overflow-x-auto mb-2">{children}</pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-[var(--border-strong)] pl-3 italic text-[var(--text-muted)] mb-2">
              {children}
            </blockquote>
          ),
          h1: ({ children }) => <h3 className="text-sm font-semibold mb-1.5">{children}</h3>,
          h2: ({ children }) => <h3 className="text-sm font-semibold mb-1.5">{children}</h3>,
          h3: ({ children }) => <h3 className="text-sm font-semibold mb-1.5">{children}</h3>,
          hr: () => <hr className="my-3 border-[var(--border)]" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
