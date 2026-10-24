"use client";

import { useMemo, useState } from "react";
import { ChevronDown, EyeOff, Plus, ShieldCheck } from "lucide-react";
import { maskLabel, maskText, strictCleanText } from "@/lib/privacy-mask";

export function PrivacyMaskBoard({
  value,
  onChange,
  initialManualTerms = [],
  initialCleaned,
  label = "隐私脱敏看板",
  help = "先在浏览器本地遮盖常见联系方式，再由你编辑清洗结果。后续匹配只使用清洗后的文字。",
}: {
  value: string;
  onChange: (cleaned: string, manualTerms: string[]) => void;
  initialManualTerms?: string[];
  initialCleaned?: string;
  label?: string;
  help?: string;
}) {
  const [manualInput, setManualInput] = useState("");
  const [manualTerms, setManualTerms] = useState<string[]>(initialManualTerms);
  const [expanded, setExpanded] = useState(false);
  const masked = useMemo(() => maskText(value, manualTerms), [value, manualTerms]);
  const defaultCleaned = strictCleanText(masked.text);
  const [edited, setEdited] = useState<{ source: string; value: string } | null>(() => initialCleaned ? { source: value, value: strictCleanText(initialCleaned) } : null);
  const cleaned = edited?.source === value ? edited.value : defaultCleaned;
  const hits = masked.hits;

  const autoCount = useMemo(() => hits.filter((hit) => hit.type !== "manual").length, [hits]);

  function addManualTerm() {
    const term = manualInput.replace(/[\u0000-\u001F\u007F]/g, "").trim();
    if (!term || term.length > 80 || manualTerms.includes(term)) return;
    const nextTerms = [...manualTerms, term];
    setEdited(null);
    setManualTerms(nextTerms);
    setManualInput("");
    const next = maskText(value, nextTerms);
    const nextClean = strictCleanText(next.text);
    onChange(nextClean, nextTerms);
  }

  function removeManualTerm(term: string) {
    const nextTerms = manualTerms.filter((item) => item !== term);
    setEdited(null);
    setManualTerms(nextTerms);
    const next = maskText(value, nextTerms);
    const nextClean = strictCleanText(next.text);
    onChange(nextClean, nextTerms);
  }

  function editCleaned(next: string) {
    // 即使用户在右侧粘回联系方式，提交前也再跑一遍规则，避免编辑看板成为绕过点。
    const safe = strictCleanText(maskText(next, manualTerms).text);
    setEdited({ source: value, value: safe });
    onChange(safe, manualTerms);
  }

  return (
    <section className="privacy-mask-board" aria-label={label}>
      <button type="button" className="privacy-mask-heading" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
        <div>
          <div className="privacy-mask-title"><ShieldCheck size={15} />{label}</div>
          <p>{expanded ? help : "发现敏感信息后，再打开这里检查和编辑。"}</p>
        </div>
        <span className="privacy-mask-heading-end"><span className="privacy-mask-badge"><EyeOff size={13} />本地规则</span><ChevronDown size={16} className={expanded ? "privacy-mask-chevron is-open" : "privacy-mask-chevron"} /></span>
      </button>
      {!expanded ? <div className="privacy-mask-collapsed"><span>自动隐藏 {autoCount} 处</span><span>{manualTerms.length ? `已添加 ${manualTerms.length} 条手动隐藏` : "还可以手动涂黑姓名、学校或公司"}</span><span className="privacy-mask-open-link">查看 / 编辑清洗结果</span></div> : <>
      <div className="privacy-mask-grid">
        <label>
          <span>原始输入（仅当前页面）</span>
          <textarea value={value} readOnly rows={5} aria-label="原始输入，仅当前页面" />
        </label>
        <label>
          <span>清洗结果（可直接编辑）</span>
          <textarea value={cleaned} onChange={(event) => editCleaned(event.target.value)} rows={5} aria-label="清洗结果，可直接编辑" />
        </label>
      </div>
      <div className="privacy-mask-toolbar">
        <span>自动隐藏 {autoCount} 处</span>
        <label className="privacy-manual-input">
          <span className="sr-only">手动隐藏词</span>
          <input value={manualInput} onChange={(event) => setManualInput(event.target.value)} placeholder="输入要涂黑的姓名、学校或公司" maxLength={80} />
          <button type="button" onClick={addManualTerm} disabled={!manualInput.trim()}><Plus size={13} />加入隐藏</button>
        </label>
      </div>
      {(manualTerms.length > 0 || hits.length > 0) && (
        <div className="privacy-mask-chips">
          {manualTerms.map((term) => <button type="button" key={term} onClick={() => removeManualTerm(term)} title="移除这条手动隐藏规则">手动：{term} ×</button>)}
          {hits.filter((hit) => hit.type !== "manual").slice(0, 8).map((hit, index) => <span key={`${hit.type}-${index}`}>{maskLabel(hit.type)}已隐藏</span>)}
        </div>
      )}
      <p className="privacy-mask-note">匹配器与后续审计只接收右侧清洗结果；保存前请检查是否还有需要手动涂黑的内容。</p>
      </>}
    </section>
  );
}
