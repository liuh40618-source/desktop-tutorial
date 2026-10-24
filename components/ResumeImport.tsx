"use client";

/**
 * 简历导入（第 0 步 · 我的画像）
 *
 * 上传简历 → /api/parse-resume 在应用服务端提取纯文本（不写入应用数据库或持久文件）
 * → detectSkills 用知识库别名做技能识别 → 只做「预勾选合并」，可逐条取消或一键撤销。
 * 解析进度、命中反馈、文本统计都在组件内完成，父级只需继续用 onDetected 接收并集即可。
 */
import { useRef, useState } from "react";
import { detectSkills, SKILL_MAP } from "@/lib/matcher";
import { maskText, strictCleanText } from "@/lib/privacy-mask";
import { PrivacyMaskBoard } from "@/components/PrivacyMaskBoard";

const ACCEPT = [".pdf", ".docx", ".txt", ".md", ".markdown"];

export interface ResumeImportProps {
  /** 识别命中后把技能 ids 并入父级「已掌握」列表 */
  onDetected: (ids: string[]) => void;
  /** 一键撤销「上次并入的 ids」（可选；父级未接入时不展示撤销入口，避免点了没效果） */
  onUndoDetected?: (ids: string[]) => void;
  /** 全局动态提示（可选）：错误 kind="error" 红 Toast，成功/撤销反馈 kind="info" 蓝 Toast */
  onNotice?: (msg: string, kind: "error" | "info") => void;
  /** 将浏览器侧清洗后的简历文字交给画像；原文不写入父级状态。 */
  onSanitizedText?: (text: string) => void;
}

/** 把服务端 / 网络错误翻译成人话 */
function humanizeErr(status: number, serverMsg: string | undefined): string {
  if (serverMsg && serverMsg.trim()) return serverMsg;
  return status >= 500
    ? "解析服务暂时没响应，稍后重试一下。"
    : "这份文件没能解析成功，换一份试试。";
}

export function ResumeImport({ onDetected, onUndoDetected, onNotice, onSanitizedText }: ResumeImportProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<"idle" | "parsing" | "ok" | "err">("idle");
  const [fileName, setFileName] = useState("");
  const [lastIds, setLastIds] = useState<string[]>([]); // 最近一次识别并入的 ids，用于撤销
  const [chars, setChars] = useState(0); // 本次解析出的文本长度
  const [dragging, setDragging] = useState(false);
  const [extractedText, setExtractedText] = useState("");
  const [maskedText, setMaskedText] = useState("");
  const [maskTerms, setMaskTerms] = useState<string[]>([]);

  const notice = (msg: string, kind: "error" | "info") => onNotice?.(msg, kind);

  async function handleFile(f: File | undefined) {
    if (!f || phase === "parsing") return;
    setPhase("parsing");
    setFileName(f.name);
    setLastIds([]);
    setChars(0);

    const fd = new FormData();
    fd.append("file", f);
    try {
      const res = await fetch("/api/parse-resume", { method: "POST", body: fd });
      let data: { text?: string; message?: string } = {};
      try {
        data = (await res.json()) as { text?: string; message?: string };
      } catch {
        /* 响应不是 JSON，走下方兜底文案 */
      }

      if (!res.ok) {
        setPhase("err");
        notice(humanizeErr(res.status, data?.message), "error");
        return;
      }

      const text = String(data?.text ?? "").trim();
      setChars(text.length);

      if (!text.length) {
        setPhase("err");
        notice(
          "没能从这份文件里提取到文字——可能是扫描件 / 图片型 PDF，或文件本身是空的。",
          "error"
        );
        return;
      }

      const masked = maskText(text);
      const cleaned = strictCleanText(masked.text);
      setExtractedText(text);
      setMaskedText(cleaned);
      setMaskTerms([]);
      onSanitizedText?.(cleaned);
      const ids = detectSkills(cleaned);
      if (!ids.length) {
        setPhase("err");
        notice(
          "文字解析出来了，但没有命中知识库里的技能关键词。可能这份简历的措辞和库中词条对不上，直接在下方手动勾选就好。",
          "error"
        );
        return;
      }

      setLastIds(ids);
      onDetected(ids);
      setPhase("ok");
      notice(
        `识别到 ${ids.length} 项技能，已加入下方「你会什么」清单并预勾选，可逐条取消${onUndoDetected ? "，或一键撤销本次识别" : ""}。`,
        "info"
      );
    } catch {
      setPhase("err");
      notice("解析请求没送达，可能是网络断了或服务没启动，请重试。", "error");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  /** 撤销单个技能（点命中 chip 上的 ×） */
  function undoOne(id: string) {
    const rest = lastIds.filter((x) => x !== id);
    onUndoDetected?.([id]);
    setLastIds(rest);
    if (!rest.length) {
      setChars(0);
      setPhase("idle");
      notice("已撤销本次识别并入的技能，手动勾选的不受影响。", "info");
    }
  }

  /** 一键撤销本次识别并入的全部技能 */
  function undoAll() {
    if (!lastIds.length) return;
    const n = lastIds.length;
    onUndoDetected?.(lastIds);
    setLastIds([]);
    setChars(0);
    setPhase("idle");
    notice(`已撤销本次识别并入的 ${n} 项技能，手动勾选的不受影响。`, "info");
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (phase !== "parsing") setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        handleFile(e.dataTransfer.files?.[0]);
      }}
      className="rounded-xl transition-shadow"
      style={dragging ? { boxShadow: "inset 0 0 0 2px var(--accent)" } : undefined}
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT.join(",")}
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        <button
          onClick={() => inputRef.current?.click()}
          disabled={phase === "parsing"}
          className="btn btn-ghost px-3 py-1.5 text-xs"
        >
          {phase === "parsing" ? (
            <>
              <i className="spinner" aria-hidden />
              解析中…
            </>
          ) : fileName ? (
            "换一份简历"
          ) : (
            "选择简历文件"
          )}
        </button>

        {fileName && (
          <span className="text-xs text-muted">
            {fileName}
            {phase === "ok" && chars > 0 ? ` · 文本约 ${chars} 字` : ""}
          </span>
        )}

        <span className="w-full text-xs text-muted sm:w-auto sm:flex-1">
          {phase === "parsing" ? "正在发送文件并提取文字…" : "可点按钮或直接把文件拖到这里"} · PDF / DOCX / TXT / MD ·
          5MB 内 · 文件发送到当前应用服务端提取文字并返回浏览器识别；应用代码不持久保存原文件或全文、不调用模型。远程部署时会发送到部署服务器
        </span>
      </div>

      {phase === "ok" && lastIds.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted">命中的技能：</span>
          {lastIds.map((id) => {
            const nm = SKILL_MAP[id]?.name || id;
            return onUndoDetected ? (
              <button
                key={id}
                onClick={() => undoOne(id)}
                title={`点击撤销「${nm}」`}
                className="chip-btn on"
              >
                {nm} ×
              </button>
            ) : (
              <span
                key={id}
                className="chip-btn on"
                title={nm}
                style={{ cursor: "default" }}
              >
                {nm}
              </span>
            );
          })}
          {onUndoDetected && (
            <button onClick={undoAll} className="btn btn-ghost px-2.5 py-1 text-[0.7rem]">
              撤销本次识别
            </button>
          )}
        </div>
      )}
      {extractedText && (
        <div className="mt-3">
          <PrivacyMaskBoard
            value={extractedText}
            initialManualTerms={maskTerms}
            onChange={(cleaned, terms) => {
              setMaskedText(cleaned);
              setMaskTerms(terms);
              onSanitizedText?.(cleaned);
            }}
            label="简历文本脱敏看板"
            help="文件文字返回浏览器后立即按本地规则脱敏；右侧内容可编辑，后续识别只使用清洗结果。"
          />
          <p className="mt-1 text-xs text-muted">当前清洗文本 {maskedText.length} 字；原文件与原文不会写入画像。</p>
        </div>
      )}
    </div>
  );
}
