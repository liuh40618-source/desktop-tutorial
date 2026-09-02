"use client";

/**
 * 简历导入（第 0 步 · 我的画像）
 *
 * 上传简历 → /api/parse-resume 提取纯文本（服务端本地解析，零 LLM、不落盘）
 * → detectSkills 用知识库别名做技能识别 → 只做「预勾选合并」，用户可逐条取消。
 */
import { useRef, useState } from "react";
import { detectSkills } from "@/lib/matcher";

const ACCEPT = [".pdf", ".docx", ".txt", ".md", ".markdown"];

export function ResumeImport({ onDetected }: { onDetected: (ids: string[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<"idle" | "parsing" | "ok" | "err">("idle");
  const [msg, setMsg] = useState("");
  const [fileName, setFileName] = useState("");
  const [hit, setHit] = useState(0);

  async function handleFile(f: File | undefined) {
    if (!f) return;
    setPhase("parsing");
    setMsg("");
    setFileName(f.name);
    const fd = new FormData();
    fd.append("file", f);
    try {
      const res = await fetch("/api/parse-resume", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setPhase("err");
        setMsg(data?.message || "解析失败");
        return;
      }
      const ids: string[] = detectSkills(String(data.text || ""));
      setHit(ids.length);
      if (!ids.length) {
        setPhase("err");
        setMsg("没在简历里识别到技能关键词，请手动勾选下方技能");
        return;
      }
      onDetected(ids);
      setPhase("ok");
      setMsg(`识别到 ${ids.length} 项技能，已并入下方「已掌握的技能」，可逐条取消`);
    } catch {
      setPhase("err");
      setMsg("解析请求失败，请重试");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT.join(",")}
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => inputRef.current?.click()}
          disabled={phase === "parsing"}
          className="btn btn-ghost px-3 py-1.5 text-xs"
        >
          {phase === "parsing" ? "解析中…" : fileName ? "换一份简历" : "选择简历文件"}
        </button>
        {fileName && (
          <span className="text-xs text-muted">
            {fileName}
            {phase === "ok" && hit > 0 ? ` · 共 ${hit} 项` : ""}
          </span>
        )}
        <span className="w-full text-xs text-muted sm:w-auto sm:flex-1">
          PDF / DOCX / TXT / MD · 5MB 内 · 仅本地提取文字做技能识别，不保存、不调用模型
        </span>
      </div>
      {msg && (
        <p className={`mt-2 text-xs ${phase === "ok" ? "text-accent" : "text-accent"}`}>{msg}</p>
      )}
    </div>
  );
}
