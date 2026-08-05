import { NextRequest, NextResponse } from "next/server";
import { getRoleAssignments } from "@/lib/db";
import { complete } from "@/lib/llm";
import { EXTRACT_SYSTEM, EXTRACT_TECHNICAL_SYSTEM } from "@/lib/prompts";
import { saveAnalysis } from "@/lib/db";

export const runtime = "nodejs";

const KINDS = ["fundamental", "technical"] as const;
type Kind = (typeof KINDS)[number];

export async function POST(req: NextRequest, ctx: { params: Promise<{ kind: string }> }) {
  const { kind: rawKind } = await ctx.params;
  const kind = rawKind as Kind;
  if (!KINDS.includes(kind)) {
    return NextResponse.json({ error: "unknown kind" }, { status: 400 });
  }

  const roles = getRoleAssignments();
  const endpointId = roles[kind];
  if (!endpointId) {
    return NextResponse.json({ error: `No endpoint assigned to the ${kind} role — configure in Settings` }, { status: 400 });
  }

  const body = await req.json();
  const text = String(body.text ?? "").trim();
  if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });

  const system = kind === "fundamental" ? EXTRACT_SYSTEM : EXTRACT_TECHNICAL_SYSTEM;
  let raw: string;
  try {
    raw = await complete({ system, user: text, endpointId });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }

  // Best-effort: strip code fences if the model wrapped the JSON.
  const json = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(json);
  } catch {
    parsed = null; // leave it as raw text; UI shows it and lets the user re-run
  }

  if (parsed && typeof parsed === "object") {
    const rec = parsed as Record<string, unknown>;
    const ticker = typeof rec.ticker === "string" ? rec.ticker : undefined;
    saveAnalysis({
      id: crypto.randomUUID(),
      ticker,
      kind: "notes",
      body: JSON.stringify(rec),
      createdAt: Date.now(),
    });
  }

  return NextResponse.json({ raw, parsed });
}
