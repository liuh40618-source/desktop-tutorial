import assert from "node:assert/strict";
import test from "node:test";
const baseUrl = process.env.TEST_BASE_URL || "http://localhost:4000";
let guestCookie = "";

async function ensureGuestSession() {
  if (guestCookie) return;
  const response = await fetch(`${baseUrl}/api/session`, { method: "POST" });
  const setCookie = response.headers.get("set-cookie");
  assert.equal(response.status, 200);
  assert.ok(setCookie, "guest session endpoint should set its HttpOnly cookie");
  guestCookie = setCookie.split(";", 1)[0];
}

async function json(path, options = {}) {
  await ensureGuestSession();
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", Cookie: guestCookie, ...(options.headers || {}) },
  });
  const data = await response.json();
  return { response, data };
}

test("POST /api/jds/parse returns explainable skill matches", async () => {
  const { response, data } = await json("/api/jds/parse", {
    method: "POST",
    body: JSON.stringify({ title: "数据分析实习", raw: "使用 Python、SQL 完成数据清洗和可视化。" }),
  });
  assert.equal(response.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.meta.method, "rule");
  assert.ok(data.skills.includes("python"));
  assert.ok(data.skillSources.some((source) => source.id === "sql" && source.matchedAliases.length > 0));
});

test("JD API rejects invalid input with actionable messages", async () => {
  const empty = await json("/api/jds/parse", {
    method: "POST",
    body: JSON.stringify({ title: "", raw: "   " }),
  });
  assert.equal(empty.response.status, 400);
  assert.match(empty.data.error, /JD 正文/);

  const unknown = await json("/api/jds", {
    method: "POST",
    body: JSON.stringify({ id: "api-smoke-unknown", title: "测试", raw: "Python", skills: ["not-a-skill"] }),
  });
  assert.equal(unknown.response.status, 400);
  assert.match(unknown.data.error, /技能不存在/);
});

test("JD save and delete endpoints are idempotence-aware", async () => {
  const id = `api-smoke-${Date.now()}`;
  const saved = await json("/api/jds", {
    method: "POST",
    body: JSON.stringify({ id, title: "API 冒烟测试", raw: "熟悉 Python", skills: ["python"] }),
  });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.data.jd.id, id);

  const deleted = await json(`/api/jds?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  assert.equal(deleted.response.status, 200);

  const deletedAgain = await json(`/api/jds?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  assert.equal(deletedAgain.response.status, 404);
});
