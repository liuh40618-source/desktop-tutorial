"use client";

/**
 * 职业市场洞察 · 独立页面（/market）
 * 复用全局知识库，挂载 MarketBoard 看板，提供返回首页入口。
 */
import Link from "next/link";
import { MarketBoard } from "@/components/MarketBoard";

export default function MarketPage() {
  return (
    <main className="app-shell min-h-screen px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            职途 · 知识库观察
            <span className="ml-2 inline-flex items-center rounded-full bg-accent-soft px-2 py-0.5 align-middle text-xs font-medium text-accent-strong">
              NEW
            </span>
          </h1>
          <p className="mt-1 text-xs text-muted">
            仅描述人工整理的岗位模板，不代表实时招聘需求、薪资或人才稀缺度
          </p>
        </div>
        <Link
          href="/"
          className="btn btn-ghost inline-flex items-center gap-1 text-xs"
        >
          ← 返回职途首页
        </Link>
      </header>

      <MarketBoard />

      <footer className="mt-12 border-t border-border pt-4 text-center text-[0.7rem] text-muted">
        职业市场洞察 · 数据来自职途岗位知识库 · 零 LLM、零外部 API，全部本地理算
      </footer>
    </main>
  );
}
