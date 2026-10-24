import { NextResponse } from "next/server";
import { checkDatabaseHealth } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    checkDatabaseHealth();
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(
      { ok: false },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
