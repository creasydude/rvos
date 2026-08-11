// One-off backfill: re-extract raw_text from PDFs on disk using the fixed RTL
// reconstruction extractor (rebuildText), overwriting the scrambled prose that
// the old ascending-x join stored in statement_docs and codal_reports.
//
// Run:  npx tsx scripts/backfill-raw-text.ts   (from project root)

import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { extractPdfText } from "@/lib/market/parse";

const FILINGS_DIR = path.join(process.cwd(), "data", "filings");

function grow(text: string | null): string | null {
  return text && text.length ? text : null;
}

/** Resolve the PDF for a stored row: honor pdf_path, else <tracing_no>.pdf. */
function resolvePdf(pdfPath: string | null, tracingNo: number): string | null {
  const cands: string[] = [];
  if (pdfPath) cands.push(path.isAbsolute(pdfPath) ? pdfPath : path.join(process.cwd(), pdfPath));
  cands.push(path.join(FILINGS_DIR, `${tracingNo}.pdf`));
  for (const c of cands) if (fs.existsSync(c)) return c;
  return null;
}

async function reextractRow(
  table: "statement_docs" | "codal_reports",
  tracingNo: number,
  pdfPath: string | null,
  old: string | null,
): Promise<"updated" | "no-file" | "no-change"> {
  const file = resolvePdf(pdfPath, tracingNo);
  if (!file) return "no-file";
  const buf = fs.readFileSync(file);
  const text = grow(await extractPdfText(buf));
  // Keep whatever we had if extraction produced nothing (don't drop good text).
  const effective = text ?? old;
  const before = grow(old);
  if (before === effective) return "no-change";
  db.prepare(`UPDATE ${table} SET raw_text = ? WHERE tracing_no = ?`).run(effective, tracingNo);
  return "updated";
}

async function main() {
  const updated: number[] = [];
  let noFile = 0;
  let noChange = 0;

  for (const table of ["statement_docs", "codal_reports"] as const) {
    const rows = db
      .prepare(`SELECT tracing_no AS t, pdf_path AS p, raw_text AS r FROM ${table} ORDER BY t`)
      .all() as { t: number; p: string | null; r: string | null }[];
    let tableUpdated = 0;
    for (const row of rows) {
      const res = await reextractRow(table, row.t, row.p, row.r);
      if (res === "updated") {
        tableUpdated++;
        updated.push(row.t);
      } else if (res === "no-file") {
        noFile++;
      } else {
        noChange++;
      }
    }
    console.log(`${table}: ${rows.length} rows, ${tableUpdated} updated`);
  }

  console.log(`\nupdated ${updated.length} rows (tracing_no: ${updated.join(", ") || "none"})`);
  console.log(`no-file: ${noFile}, unchanged: ${noChange}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});