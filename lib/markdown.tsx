import React from "react";

/**
 * A small, dependency-free Markdown renderer for the report document.
 * Supports the subset our report generator emits: headings (h1–h3),
 * horizontal rules, paragraphs, unordered/ordered lists, **bold**, *italic*,
 * and [links](url).
 */

const INLINE_RE = /(\*\*[^*]+\*\*|\*[^*\n]+\*|\[[^\]]*\]\([^)]*\))/g;

function renderInline(text: string, keyBase: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const regex = new RegExp(INLINE_RE.source, "g");
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) {
      nodes.push(text.slice(last, match.index));
    }
    const token = match[0];
    if (token.startsWith("**")) {
      nodes.push(
        <strong key={`${keyBase}-b${i}`}>{renderInline(token.slice(2, -2), `${keyBase}-b${i}`)}</strong>
      );
    } else if (token.startsWith("[")) {
      const link = token.match(/^\[([^\]]*)\]\(([^)]*)\)$/);
      if (link) {
        // Only allow safe schemes (no javascript:, data:, etc.).
        const href = /^(https?:\/\/|mailto:)/i.test(link[2]) ? link[2] : "#";
        nodes.push(
          <a key={`${keyBase}-a${i}`} href={href} rel="noopener noreferrer">
            {link[1]}
          </a>
        );
      } else {
        nodes.push(token);
      }
    } else {
      nodes.push(
        <em key={`${keyBase}-e${i}`}>{renderInline(token.slice(1, -1), `${keyBase}-e${i}`)}</em>
      );
    }
    last = match.index + token.length;
    i += 1;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function isOrderedListItem(line: string): boolean {
  return /^\d+\.\s+/.test(line);
}

export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let paragraph: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let listItems: string[] = [];
  let key = 0;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      const joined = paragraph.join(" ");
      const segments = joined.split("\u0000");
      blocks.push(
        <p key={`p${key++}`}>
          {segments.flatMap((seg, idx) => {
            const nodes = renderInline(seg, `p${key}-${idx}`);
            return idx < segments.length - 1
              ? [...nodes, <br key={`br${key}-${idx}`} />]
              : nodes;
          })}
        </p>
      );
      paragraph = [];
    }
  };

  const flushList = () => {
    if (listItems.length > 0) {
      const items = listItems.map((item, idx) => (
        <li key={`li${key}-${idx}`}>{renderInline(item, `li${key}-${idx}`)}</li>
      ));
      if (listType === "ol") {
        blocks.push(<ol key={`l${key++}`}>{items}</ol>);
      } else {
        blocks.push(<ul key={`l${key++}`}>{items}</ul>);
      }
      listItems = [];
      listType = null;
    }
  };

  for (const raw of lines) {
    const hardBreak = / {2,}$/.test(raw);
    const line = raw.trimEnd();
    const trimmed = line.trim();

    if (trimmed === "") {
      flushParagraph();
      flushList();
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      flushParagraph();
      flushList();
      blocks.push(<hr key={`h${key++}`} />);
      continue;
    }

    if (trimmed.startsWith("### ")) {
      flushParagraph();
      flushList();
      blocks.push(<h3 key={`h${key++}`}>{renderInline(trimmed.slice(4), `h${key}`)}</h3>);
      continue;
    }
    if (trimmed.startsWith("## ")) {
      flushParagraph();
      flushList();
      blocks.push(<h2 key={`h${key++}`}>{renderInline(trimmed.slice(3), `h${key}`)}</h2>);
      continue;
    }
    if (trimmed.startsWith("# ")) {
      flushParagraph();
      flushList();
      blocks.push(<h1 key={`h${key++}`}>{renderInline(trimmed.slice(2), `h${key}`)}</h1>);
      continue;
    }

    if (trimmed.startsWith("- ")) {
      flushParagraph();
      if (listType === "ol") flushList();
      listType = "ul";
      listItems.push(trimmed.slice(2));
      continue;
    }
    if (isOrderedListItem(trimmed)) {
      flushParagraph();
      if (listType === "ul") flushList();
      listType = "ol";
      listItems.push(trimmed.replace(/^\d+\.\s+/, ""));
      continue;
    }

    // Plain paragraph line — join with the previous line as one paragraph.
    if (listType) flushList();
    paragraph.push(trimmed + (hardBreak ? "\u0000" : ""));
  }

  flushParagraph();
  flushList();

  return <>{blocks}</>;
}
