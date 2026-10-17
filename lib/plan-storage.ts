import type { JdFront, Persisted, PlanRecord, ProfileRowFront } from "./types";

export const STORAGE_KEY = "zhitu_state_v2";
export const PLANS_KEY = "zhitu_plans_v2";
const LEGACY_CACHE_CHECK_KEY = "zhitu_legacy_cache_checked_v1";

export function scopedStorageKey(key: string, cacheScope: string): string {
  return `${key}:${cacheScope}`;
}

export function initializeGuestCache(cacheScope: string, mayMigrateLegacyCache: boolean) {
  try {
    if (localStorage.getItem(LEGACY_CACHE_CHECK_KEY)) return;
    for (const key of [STORAGE_KEY, PLANS_KEY]) {
      const legacy = localStorage.getItem(key);
      if (legacy === null) continue;
      const scopedKey = scopedStorageKey(key, cacheScope);
      if (mayMigrateLegacyCache && localStorage.getItem(scopedKey) === null) {
        localStorage.setItem(scopedKey, legacy);
      }
      if (mayMigrateLegacyCache) localStorage.removeItem(key);
    }
    localStorage.setItem(LEGACY_CACHE_CHECK_KEY, "1");
  } catch {
    // The server copy remains usable when browser storage is unavailable.
  }
}

export async function loadProfileFromServer(cacheScope: string): Promise<Persisted | null> {
  const storageKey = scopedStorageKey(STORAGE_KEY, cacheScope);
  // Only this guest's browser fallback may take precedence over its server copy.
  try {
    const raw = localStorage.getItem(storageKey);
    const cached = raw ? JSON.parse(raw) as Persisted : null;
    if (cached?.profile) return cached;
  } catch { /* The server is still available when browser storage is disabled. */ }
  try {
    const r = await fetch("/api/profile", { signal: AbortSignal.timeout(5000), cache: "no-store" });
    if (!r.ok) throw new Error("bad");
    const row = (await r.json()) as ProfileRowFront;
    if (!row) return null;
    return {
      step: row.step,
      started: row.started,
      profile: row.profile,
      selectedJobId: row.selectedJobId,
      doneSkills: row.doneSkills,
    };
  } catch {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as Persisted) : null;
    } catch {
      return null;
    }
  }
}

export type ProfileSaveResult = "server" | "local" | "failed";

export async function pushProfileToServer(s: Persisted, cacheScope: string): Promise<ProfileSaveResult> {
  const storageKey = scopedStorageKey(STORAGE_KEY, cacheScope);
  let cachedLocally = false;
  try {
    localStorage.setItem(storageKey, JSON.stringify(s));
    cachedLocally = true;
  } catch { /* Try the server next. */ }
  try {
    const response = await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(s),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error("保存失败");
    return "server";
  } catch {
    return cachedLocally ? "local" : "failed";
  }
}

export async function loadPlansFromServer(cacheScope: string): Promise<PlanRecord[]> {
  const local = readLocalPlans(cacheScope);
  try {
    const r = await fetch("/api/plans");
    if (!r.ok) throw new Error("读取规划失败");
    const data = await r.json();
    const merged = new Map<string, PlanRecord>();
    for (const plan of [...(Array.isArray(data) ? data : []), ...local]) merged.set(plan.id, plan);
    return [...merged.values()].sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return local;
  }
}

export function readLocalPlans(cacheScope: string): PlanRecord[] {
  try {
    const data = JSON.parse(localStorage.getItem(scopedStorageKey(PLANS_KEY, cacheScope)) || "[]");
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

export async function pushPlanToServer(rec: PlanRecord, cacheScope: string) {
  try {
    const response = await fetch("/api/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rec),
    });
    if (!response.ok) throw new Error("保存规划失败");
    try {
      localStorage.setItem(
        scopedStorageKey(PLANS_KEY, cacheScope),
        JSON.stringify(readLocalPlans(cacheScope).filter((p) => p.id !== rec.id))
      );
    } catch { /* The server copy has already been saved. */ }
  } catch {
    try {
      const list = readLocalPlans(cacheScope);
      localStorage.setItem(
        scopedStorageKey(PLANS_KEY, cacheScope),
        JSON.stringify([rec, ...list.filter((p) => p.id !== rec.id)])
      );
    } catch {
      throw new Error("未能保存规划，请检查服务连接和浏览器存储空间。");
    }
  }
}

export async function removePlanOnServer(id: string, cacheScope: string) {
  const response = await fetch(`/api/plans?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) throw new Error("删除失败，请恢复服务连接后重试。");
  try {
    localStorage.setItem(
      scopedStorageKey(PLANS_KEY, cacheScope),
      JSON.stringify(readLocalPlans(cacheScope).filter((p) => p.id !== id))
    );
  } catch {
    throw new Error("服务端记录已删除，但浏览器副本未能清理，请检查浏览器存储设置。");
  }
}

export async function loadJdsFromServer(): Promise<JdFront[]> {
  try {
    const r = await fetch("/api/jds");
    const d = await r.json();
    return Array.isArray(d) ? d : [];
  } catch {
    return [];
  }
}

export async function pushJdToServer(jd: JdFront) {
  const response = await fetch("/api/jds", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(jd),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(data.error || "保存 JD 失败");
}

export async function removeJdOnServer(id: string) {
  let response: Response;
  try {
    response = await fetch(`/api/jds?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch {
    throw new Error("删除请求未送达，请检查服务连接后重试。");
  }
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || "删除失败，请重试。");
  }
}

