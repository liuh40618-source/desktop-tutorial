import { NextResponse } from "next/server";
import { listPlans, addPlanRec, deletePlanRec, type PlanRow } from "@/lib/db";
import { readGuestOwner } from "@/lib/session";

export async function GET(req: Request) {
  const ownerId = readGuestOwner(req);
  if (!ownerId) return NextResponse.json({ ok: false, error: "访客会话已失效，请刷新页面后重试。" }, { status: 401 });
  return NextResponse.json(listPlans(ownerId), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const ownerId = readGuestOwner(req);
  if (!ownerId) return NextResponse.json({ ok: false, error: "访客会话已失效，请刷新页面后重试。" }, { status: 401 });
  try {
    const rec = (await req.json()) as PlanRow;
    if (!rec || !rec.id) {
      return NextResponse.json({ ok: false, error: "missing id" }, { status: 400 });
    }
    if (!addPlanRec(rec, ownerId)) {
      return NextResponse.json({ ok: false, error: "记录 id 冲突，请重新保存。" }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "invalid body" }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const ownerId = readGuestOwner(req);
  if (!ownerId) return NextResponse.json({ ok: false, error: "访客会话已失效，请刷新页面后重试。" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id || !deletePlanRec(id, ownerId)) {
    return NextResponse.json({ ok: false, error: "这条记录不存在或已删除。" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
