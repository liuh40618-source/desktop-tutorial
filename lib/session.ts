import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getOrCreateSessionSecret } from "@/lib/db";

export const SESSION_COOKIE = "career_guest";
const SESSION_MAX_AGE = 60 * 60 * 24 * 365;

function signature(message: string): string {
  return createHmac("sha256", getOrCreateSessionSecret()).update(message).digest("base64url");
}

export function createGuestSession(): { ownerId: string; token: string } {
  const ownerId = randomBytes(32).toString("base64url");
  return { ownerId, token: signGuestOwner(ownerId) };
}

/** Extend an already authenticated guest session without changing its data owner. */
export function renewGuestSession(ownerId: string): string {
  return signGuestOwner(ownerId);
}

function signGuestOwner(ownerId: string): string {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
  const signedPayload = `${ownerId}.${expiresAt}`;
  return `${signedPayload}.${signature(signedPayload)}`;
}

/** Stable, non-authenticating namespace for this guest's browser fallback data. */
export function guestCacheScope(ownerId: string): string {
  return createHash("sha256").update(`career-cache:${ownerId}`).digest("base64url").slice(0, 24);
}

export function readGuestOwner(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const item = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  if (!item) return null;

  let token = "";
  try {
    token = decodeURIComponent(item.slice(SESSION_COOKIE.length + 1));
  } catch {
    return null;
  }
  const signatureSeparator = token.lastIndexOf(".");
  const expirySeparator = token.indexOf(".");
  if (expirySeparator < 1 || signatureSeparator <= expirySeparator) return null;
  const ownerId = token.slice(0, expirySeparator);
  const expiresAt = Number(token.slice(expirySeparator + 1, signatureSeparator));
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return null;
  const signedPayload = token.slice(0, signatureSeparator);
  const supplied = Buffer.from(token.slice(signatureSeparator + 1), "base64url");
  const expected = Buffer.from(signature(signedPayload), "base64url");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  return ownerId;
}

export function guestCookie(token: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}${secure}`;
}
