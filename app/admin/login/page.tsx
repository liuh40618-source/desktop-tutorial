"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function AdminLogin() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/admin";
  const [token, setToken] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!token.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim() }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setErr(d?.error || "登录失败");
        setBusy(false);
        return;
      }
      router.replace(next);
    } catch {
      setErr("请求失败，请重试");
      setBusy(false);
    }
  }

  return (
    <main className="app-shell grid min-h-screen place-items-center px-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="w-full max-w-sm"
      >
        <div className="text-center">
          <div className="text-lg font-semibold tracking-tight text-foreground">职途 · 数据后台</div>
          <p className="mt-1 text-xs text-muted">输入 ADMIN_TOKEN 环境变量对应的口令</p>
        </div>
        <input
          autoFocus
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="管理口令"
          className="input mt-4"
        />
        {err && (
          <div role="alert" className="toast-info mt-3 rounded-xl px-4 py-2.5 text-xs">
            {err}
          </div>
        )}
        <button type="submit" disabled={!token.trim() || busy} className="btn btn-primary mt-3 w-full">
          {busy ? "验证中…" : "进入后台"}
        </button>
      </form>
    </main>
  );
}
