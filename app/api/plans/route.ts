import { NextResponse } from "next/server";
import { listPlans, addPlanRec, deletePlanRec, type PlanRow } from "@/lib/db";

export async function GET() {
  return NextResponse.json(listPlans());
}

export async function POST(req: Request) {
  try {
    const rec = (await req.json()) as PlanRow;
    if (!rec || !rec.id) {
      return NextResponse.json({ ok: false, error: "missing id" }, { status: 400 });
    }
    addPlanRec(rec);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "invalid body" }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (id) deletePlanRec(id);
  return NextResponse.json({ ok: true });
}
