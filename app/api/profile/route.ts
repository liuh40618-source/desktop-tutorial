import { NextResponse } from "next/server";
import {
  listProfiles,
  getUserProfile,
  saveUserProfile,
  deleteUserProfile,
  type ProfileRow,
} from "@/lib/db";

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (id) return NextResponse.json(getUserProfile(id) ?? null);
  return NextResponse.json(listProfiles());
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const row: ProfileRow = {
      id: body.id || "local",
      name: body.name ?? "",
      step: body.step ?? 0,
      started: !!body.started,
      profile: body.profile ?? {},
      selectedJobId: body.selectedJobId ?? "",
      doneSkills: body.doneSkills ?? [],
      updatedAt: "",
    };
    saveUserProfile(row);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "invalid body" }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (id) deleteUserProfile(id);
  return NextResponse.json({ ok: true });
}
