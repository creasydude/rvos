import { NextResponse } from "next/server";
import { listAnalyses, getAnalysis, saveAnalysis, deleteAnalysis } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (id) {
    const a = getAnalysis(id);
    return NextResponse.json(a ?? { error: "not found" }, { status: a ? 200 : 404 });
  }
  return NextResponse.json(listAnalyses());
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const kind = body.kind === "analysis" ? "analysis" : "notes";
  const ticker = typeof body.ticker === "string" ? body.ticker : undefined;
  const title = typeof body.title === "string" ? body.title : undefined;
  const text = typeof body.body === "string" ? body.body : "";
  if (!text) return NextResponse.json({ error: "body required" }, { status: 400 });

  const id = crypto.randomUUID();
  saveAnalysis({ id, ticker, title, kind, body: text, createdAt: Date.now() });
  return NextResponse.json({ id });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  deleteAnalysis(id);
  return NextResponse.json({ ok: true });
}
