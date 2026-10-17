"use client";

/**
 * 我的记录页：规划列表 / 详情 / 重命名 / 导出
 */
import { useState } from "react";
import { PlanMd } from "@/components/PlanMd";
import type { PlanRecord } from "@/lib/types";

function downloadBlob(fileName: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function plansToMarkdown(plans: PlanRecord[]): string {
  return plans
    .map(
      (p, i) =>
        `# ${i + 1}. ${p.major || "未填专业"} · ${p.jobTitle}\n\n` +
        `> 保存于 ${new Date(p.createdAt).toLocaleString("zh-CN")}\n> ${p.summary}\n\n${p.markdown}`
    )
    .join("\n\n---\n\n");
}

function exportAllMd(plans: PlanRecord[]) {
  downloadBlob("职途-全部记录.md", plansToMarkdown(plans), "text/markdown;charset=utf-8");
}

function PlanDetail({ plan, onBack }: { plan: PlanRecord; onBack: () => void }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(plan.markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  function handleDownload() {
    const blob = new Blob([plan.markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `职途规划-${plan.jobTitle}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="min-w-0 truncate text-xl font-semibold tracking-tight text-foreground">
          {plan.name?.trim() || `${plan.major || "未填专业"} · ${plan.jobTitle}`}
        </h2>
        <button onClick={onBack} className="btn btn-ghost whitespace-nowrap px-3 py-1.5 text-xs">
          返回
        </button>
      </div>

      <div className="mb-4 flex gap-2">
        <button onClick={handleCopy} className="btn btn-ghost flex-1">
          {copied ? "已复制" : "复制"}
        </button>
        <button onClick={handleDownload} className="btn btn-ghost flex-1">
          下载 .md
        </button>
      </div>

      <div className="card p-5">
        <PlanMd text={plan.markdown} />
      </div>
    </section>
  );
}

export function Records({
  plans,
  onBack,
  onRename,
  onDelete,
  onClearAll,
}: {
  plans: PlanRecord[];
  onBack: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onClearAll: () => Promise<void>;
}) {
  const [sel, setSel] = useState<PlanRecord | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [nameVal, setNameVal] = useState("");
  const [clearing, setClearing] = useState(false);

  function planTitle(p: PlanRecord): string {
    return p.name?.trim() || `${p.major || "未填专业"} · ${p.jobTitle}`;
  }

  function commitRename() {
    const trimmed = nameVal.trim();
    if (renamingId) {
      const target = plans.find((x) => x.id === renamingId);
      if (trimmed && target && trimmed !== planTitle(target) && trimmed !== target.name) {
        onRename(renamingId, trimmed);
      }
    }
    setRenamingId(null);
  }

  async function clearAll() {
    if (clearing || !window.confirm("清除当前访客的全部画像、试驾答案、规划和 JD？此操作不可撤销。")) return;
    setClearing(true);
    try {
      await onClearAll();
      setSel(null);
    } finally {
      setClearing(false);
    }
  }

  if (sel) return <PlanDetail plan={sel} onBack={() => setSel(null)} />;
  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight text-foreground">我的记录</h2>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            onClick={() => exportAllMd(plans)}
            disabled={!plans.length}
            title={
              plans.length
                ? `把 ${plans.length} 份规划拼成一份 .md 文件下载到本地`
                : "还没有记录"
            }
            className="btn btn-ghost whitespace-nowrap px-3 py-1.5 text-xs disabled:opacity-40"
          >
            下载全部 .md
          </button>
          <button
            onClick={() => void clearAll()}
            disabled={clearing}
            className="btn btn-ghost whitespace-nowrap px-3 py-1.5 text-xs text-red-600 disabled:opacity-50"
          >
            {clearing ? "正在清除…" : "清除全部访客数据"}
          </button>
          <button onClick={onBack} className="btn btn-ghost whitespace-nowrap px-3 py-1.5 text-xs">
            返回
          </button>
        </div>
      </div>

      {plans.length === 0 ? (
        <div className="card p-8 text-center">
          <div className="text-sm text-foreground">还没有保存的规划</div>
          <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-muted">
            走到最后一步后，点「保存这份规划」，就会出现在这里。
            单份规划可在详情页单独复制或下载。
          </p>
          <button onClick={onBack} className="btn btn-ghost mt-4 text-xs">
            先去做一份规划
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {plans.map((p) => {
            const editing = renamingId === p.id;
            return (
              <div key={p.id} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  {editing ? (
                    <input
                      autoFocus
                      value={nameVal}
                      onChange={(e) => setNameVal(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitRename();
                        }
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      placeholder={planTitle(p)}
                      className="input min-w-0 flex-1 py-1.5 text-sm"
                    />
                  ) : (
                    <button onClick={() => setSel(p)} className="min-w-0 flex-1 text-left">
                      <div className="truncate text-sm font-medium text-foreground">
                        {planTitle(p)}
                      </div>
                      <div className="mt-1 text-xs text-muted">{p.summary}</div>
                      <div className="mt-1 text-xs text-muted">
                        {new Date(p.createdAt).toLocaleString("zh-CN")}
                      </div>
                    </button>
                  )}
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => {
                        setRenamingId(p.id);
                        setNameVal(p.name ?? planTitle(p));
                      }}
                      title="改个名，方便以后分辨"
                      className="rounded-lg px-2 py-1 text-xs text-muted transition-colors hover:text-accent"
                    >
                      改名
                    </button>
                    <button
                      onClick={() => {
                        const title = p.jobTitle || "这份规划";
                        if (confirm(`删除「${title}」？此操作不可撤销。`)) onDelete(p.id);
                      }}
                      className="rounded-lg px-2 py-1 text-xs text-muted transition-colors hover:text-red-500"
                    >
                      删除
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
