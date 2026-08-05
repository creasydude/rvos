import { NextRequest, NextResponse } from "next/server";
import { getRoleAssignments, setRole } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(getRoleAssignments());
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  for (const role of ["fundamental", "technical", "synthesis"] as const) {
    if (body[role] !== undefined) {
      setRole(role, body[role] === null ? null : String(body[role]));
    }
  }
  return NextResponse.json(getRoleAssignments());
}
