import { NextResponse } from "next/server";
import { clearGuestData } from "@/lib/db";
import { readGuestOwner } from "@/lib/session";

export const runtime = "nodejs";

export async function DELETE(request: Request) {
  const ownerId = readGuestOwner(request);
  if (!ownerId) {
    return NextResponse.json(
      { ok: false, error: "访客会话已失效，请刷新页面后重试。" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    clearGuestData(ownerId);
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(
      { ok: false, error: "数据未能全部清除，请稍后重试。" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
