"use client";

/**
 * 轻量 markdown 渲染（仅覆盖本项目导出所用语法；零依赖）
 * 把保存的规划在「我的记录 → 详情」里渲染成可读、链接可点。
 */
export function shortUrl(u: string): string {
  try {
    const url = new URL(u);
    return `${url.host.replace(/^www\./, "")}${url.pathname.length > 1 ? url.pathname.slice(0, 24) : ""}${url.search ? "…" : ""}`;
  } catch {
    return u;
  }
}

function inlineMd(text: string) {
  const parts = text.split(/(\[[^\]]+\]\([^)\s]+\)|https?:\/\/[^\s)]+)/g);
  return parts.map((p, i) => {
    const link = p.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (link) {
      return (
        <a
          key={i}
          href={link[2]}
          target="_blank"
          rel="noreferrer"
          className="text-accent underline decoration-accent/25 underline-offset-2 transition-colors hover:decoration-accent"
        >
          {link[1]}
        </a>
      );
    }
    if (/^https?:\/\//.test(p)) {
      return (
        <a
          key={i}
          href={p}
          target="_blank"
          rel="noreferrer"
          className="break-all text-accent underline decoration-accent/25 underline-offset-2 transition-colors hover:decoration-accent"
          title={p}
        >
          {shortUrl(p)}
        </a>
      );
    }
    return <span key={i}>{p}</span>;
  });
}

export function PlanMd({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1.5">
      {lines.map((raw, i) => {
        const line = raw.trimEnd();
        const h1 = line.match(/^# (.*)/);
        const h2 = line.match(/^## (.*)/);
        const h3 = line.match(/^### (.*)/);
        if (h1)
          return (
            <div key={i} className="pt-1 text-[1.05rem] font-semibold tracking-tight text-foreground">
              {inlineMd(h1[1])}
            </div>
          );
        if (h2)
          return (
            <div key={i} className="pt-2.5 text-[0.95rem] font-semibold tracking-tight text-foreground">
              {inlineMd(h2[1])}
            </div>
          );
        if (h3)
          return (
            <div key={i} className="pt-2 text-sm font-semibold tracking-tight text-foreground">
              {inlineMd(h3[1])}
            </div>
          );
        if (/^---+$/.test(line))
          return <div key={i} className="my-2 border-t border-border" />;
        if (line.startsWith(">"))
          return (
            <div key={i} className="text-xs leading-relaxed text-muted">
              {inlineMd(line.slice(1).trim())}
            </div>
          );
        const liIndent = line.match(/^(\s*)[-•]\s+(.*)/);
        const liNum = line.match(/^(\s*)(\d+)\.\s+(.*)/);
        if (liIndent || liNum) {
          const indent = (liIndent?.[1] || liNum?.[1] || "").length;
          const marker = liNum ? `${liNum[2]}.` : "•";
          const content = (liIndent?.[2] ?? liNum?.[3] ?? "").trim();
          const isResource = indent >= 2 && line.includes("http");
          if (isResource) {
            const mdLink = content.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
            const bareUrl = mdLink ? null : content.match(/(https?:\/\/[^\s)]+)/);
            const href = mdLink ? mdLink[2] : bareUrl ? bareUrl[1] : null;
            if (href) {
              const display = mdLink
                ? mdLink[1]
                : content.replace(/(https?:\/\/[^\s)]+)/, "").trim() || shortUrl(href);
              return (
                <a
                  key={i}
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-0.5 flex items-center justify-between gap-2 rounded-lg bg-[var(--surface-2)] px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-accent-soft"
                  title={href}
                >
                  <span className="min-w-0 truncate">{display}</span>
                  <span className="shrink-0 text-muted">↗ 打开</span>
                </a>
              );
            }
          }
          return (
            <div key={i} className="flex gap-2 text-sm leading-relaxed" style={{ paddingLeft: Math.min(indent, 4) * 0.6 + "rem" }}>
              <span className="shrink-0 text-muted">{marker}</span>
              <span className="min-w-0">{inlineMd(content)}</span>
            </div>
          );
        }
        if (!line.trim()) return <div key={i} className="h-1" />;
        return (
          <p key={i} className="text-sm leading-relaxed text-foreground">
            {inlineMd(line)}
          </p>
        );
      })}
    </div>
  );
}
