import { NextRequest, NextResponse } from "next/server";
import { deleteEndpoint, getEndpoint, listEndpoints, saveEndpoint } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(listEndpoints());
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const id = (body.id as string) || crypto.randomUUID();
  const name = String(body.name ?? "").trim();
  const provider = String(body.provider ?? "").trim();
  const model = String(body.model ?? "").trim();
  if (!name || !provider || !model) {
    return NextResponse.json({ error: "name, provider and model are required" }, { status: 400 });
  }

  // Preserve the stored key unless the client sent a new one (masked field = no change).
  const existing = getEndpoint(id);
  const apiKey = body.apiKey
    ? String(body.apiKey)
    : existing?.apiKey;

  if (!apiKey) {
    return NextResponse.json({ error: "API key required" }, { status: 400 });
  }

  saveEndpoint({
    id,
    name,
    provider,
    baseUrl: body.baseUrl ? String(body.baseUrl) : undefined,
    apiKey,
    model,
  });
  return NextResponse.json({ id });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  deleteEndpoint(id);
  return NextResponse.json({ ok: true });
}
