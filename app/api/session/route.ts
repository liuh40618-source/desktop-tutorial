import { NextResponse } from "next/server";
import { claimLegacyData } from "@/lib/db";
import { createGuestSession, guestCacheScope, guestCookie, readGuestOwner, renewGuestSession } from "@/lib/session";

export const runtime = "nodejs";

/** Accountless guest identity; the HttpOnly cookie never exposes its signing secret. */
export async function POST(request: Request) {
  const existingOwner = readGuestOwner(request);
  let ownerId: string;
  let token: string;
  if (existingOwner) {
    ownerId = existingOwner;
    token = renewGuestSession(ownerId);
  } else {
    const session = createGuestSession();
    ownerId = session.ownerId;
    token = session.token;
  }

  claimLegacyData(ownerId);
  const response = NextResponse.json(
    {
      ok: true,
      cacheScope: guestCacheScope(ownerId),
      migrateLegacyCache: Boolean(existingOwner),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
  response.headers.append("Set-Cookie", guestCookie(token));
  return response;
}
