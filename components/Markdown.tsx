"use client";

import { Box } from "@chakra-ui/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Renders the synthesis LLM's markdown (headings, bold, tables, lists, code)
// as styled HTML in the dark theme. GFM (remark-gfm) adds table, strikethrough,
// task-list support. Chakra v3 uses `css`, not `sx`, for nested element styles.
export default function Markdown({ children }: { children: string }) {
  return (
    <Box
      css={{
        "h1, h2, h3, h4": { fontWeight: "semibold", color: "ink", mt: 4, mb: 1 },
        h1: { fontSize: "xl" },
        h2: { fontSize: "lg" },
        h3: { fontSize: "md" },
        h4: { fontSize: "sm" },
        p: { mt: 2, mb: 2 },
        "ul, ol": { pl: 5, my: 2 },
        li: { my: 0.5 },
        a: { color: "accent.400", textDecoration: "underline" },
        blockquote: { borderLeft: "3px solid", borderColor: "borderC", pl: 3, my: 2, color: "muted" },
        pre: { bg: "raised", p: 3, rounded: "md", overflowX: "auto", fontSize: "xs", mt: 2, mb: 2 },
        "pre code": { bg: "transparent", p: 0 },
        code: { bg: "raised", px: 1, rounded: "sm", fontSize: "xs" },
        table: { my: 3, w: "full", borderCollapse: "collapse", display: "block", overflowX: "auto", whiteSpace: "nowrap" },
        "th, td": { border: "1px solid", borderColor: "borderC", px: 2, py: 1, fontSize: "xs" },
        th: { bg: "raised", fontWeight: "semibold" },
        hr: { my: 3, borderColor: "borderC" },
      }}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </Box>
  );
}