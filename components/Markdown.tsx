"use client";

import { Box } from "@chakra-ui/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { isRtlText } from "@/lib/rtl";

// Renders the synthesis LLM's markdown (headings, bold, tables, lists, code)
// as styled HTML in the dark theme. GFM (remark-gfm) adds table, strikethrough,
// task-list support. Chakra v3 uses `css`, not `sx`, for nested element styles.
// Tables are rendered via per-element components with explicit borders so grid
// lines always show regardless of css-prop cascading.
export default function Markdown({ children }: { children: string }) {
  const rtl = isRtlText(children);

  return (
    <Box
      dir={rtl ? "rtl" : "ltr"}
      css={{
        "h1, h2, h3, h4": { fontWeight: "semibold", color: "ink", mt: 4, mb: 1 },
        h1: { fontSize: "xl" },
        h2: { fontSize: "lg" },
        h3: { fontSize: "md" },
        h4: { fontSize: "sm" },
        p: { mt: 2, mb: 2 },
        "ul, ol": { paddingInlineStart: 5, my: 2 },
        li: { my: 0.5 },
        a: { color: "accent.400", textDecoration: "underline" },
        blockquote: { borderInlineStart: "3px solid", borderColor: "#4a4a5a", paddingInlineStart: 3, my: 2, color: "muted" },
        pre: { bg: "raised", p: 3, rounded: "md", overflowX: "auto", fontSize: "xs", mt: 2, mb: 2 },
        "pre code": { bg: "transparent", p: 0 },
        code: { bg: "raised", px: 1, rounded: "sm", fontSize: "xs" },
        hr: { my: 3, borderColor: "#4a4a5a" },
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Render each table element as a Chakra Box with an explicit border so
          // rows/columns are visibly lined even on the dark bg.
          table: (props) => <Table>{props.children}</Table>,
          thead: (props) => <thead>{props.children}</thead>,
          tbody: (props) => <tbody>{props.children}</tbody>,
          tr: (props) => <tr>{props.children}</tr>,
          th: (props) => (
            <Box
              as="th"
              bg="#2e2e38"
              fontWeight="semibold"
              textAlign="start"
              px={3}
              py={2}
              border="1px solid"
              borderColor="#5a5a6a"
              fontSize="xs"
            >
              {props.children}
            </Box>
          ),
          td: (props) => (
            <Box
              as="td"
              px={3}
              py={2}
              border="1px solid"
              borderColor="#5a5a6a"
              verticalAlign="top"
              fontSize="xs"
            >
              {props.children}
            </Box>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </Box>
  );
}

// Real <table> inside a horizontal-scroll wrapper, with border-collapse so the
// per-cell borders merge into a clean grid.
function Table({ children }: { children: React.ReactNode }) {
  return (
    <Box my={3} overflowX="auto" maxW="100%">
      <table style={{ borderCollapse: "collapse", borderSpacing: 0, width: "100%" }}>
        {children}
      </table>
    </Box>
  );
}