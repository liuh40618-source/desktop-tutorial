"use client";

/**
 * Step 1 · 看看我具备什么能力
 * 把上一步的自然语言经历「翻译」成候选能力，让用户逐条四态确认。
 *
 * 设计说明 4.4：候选卡必须展示「命中原文 + 匹配理由 + 置信度(含来源)」，
 * 并提供 **确认 / 否认 / 修改 / 暂不确定** 四态；规则只提候选，决定权始终在用户手里。
 *
 * 第二层兜底（lib/skill-fallback.mjs）只在第一层未命中时启用，结果**只作候选，绝不自动勾选**。
 */
import { useMemo, useState } from "react";
import { allSkills, detectSkillsDetailed, SKILL_MAP } from "@/lib/matcher";
import { containsSkillAlias } from "@/lib/skill-matching.mjs";
import { findSkillFallback } from "@/lib/skill-fallback.mjs";
import { filterKnownSkillIds } from "@/lib/orientation";
import { ProfileForm } from "@/components/ProfileForm";
import { EVIDENCE_LEVELS, type Profile } from "@/lib/types";

type FallbackSource = "exact-alias" | "alias-group" | "substring" | "fuzzy";

interface Candidate {
  id: string;
  name: string;
  category: string;
  hitAliases: string[];
  cautionAliases: string[];
  /** 第一层为 undefined（词边界精确命中）；第二层为兜底来源 */
  source?: FallbackSource;
}

const SOURCE_LABEL: Record<FallbackSource, string> = {
  "exact-alias": "精确别名",
  "alias-group": "同义扩展",
  substring: "子串近似",
  fuzzy: "拼写近似",
};

export function SkillTranslation({
  profile,
  setProfile,
  setError,
  onNotice,
  onNext,
}: {
  profile: Profile;
  setProfile: (p: Profile) => void;
  setError: (msg: string | null) => void;
  onNotice: (msg: string, kind: "error" | "info") => void;
  onNext: () => void;
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [customInput, setCustomInput] = useState("");
  const [showProfile, setShowProfile] = useState(false);
  const [editing, setEditing] = useState("");
  const [editTarget, setEditTarget] = useState("");
  const [editCustom, setEditCustom] = useState("");

  const knownSet = useMemo(() => new Set(allSkills().map((s) => s.id)), []);
  const pendingCandidates = profile.pendingCandidates ?? {};

  const { candidates, layerUsed } = useMemo(() => {
    const text = profile.experiences || "";
    if (!text.trim()) return { candidates: [] as Candidate[], layerUsed: "none" as const };
    const layer1 = detectSkillsDetailed(text);
    if (layer1.length) return { candidates: layer1 as Candidate[], layerUsed: "layer1" as const };
    // 第一层未命中 → 第二层规则近似兜底（只提候选，绝不自动勾选）
    const layer2: Candidate[] = findSkillFallback(text, allSkills()).map((hit) => ({
      id: hit.id,
      name: SKILL_MAP[hit.id]?.name ?? hit.id,
      category: SKILL_MAP[hit.id]?.category ?? "",
      hitAliases: [hit.matchedText],
      cautionAliases: [],
      source: hit.source as FallbackSource,
    }));
    return { candidates: layer2, layerUsed: "layer2" as const };
  }, [profile.experiences]);

  const pending = candidates.filter((c) => !profile.knownSkillIds.includes(c.id) && !dismissed.has(c.id));

  /** 从用户原话里取出实际包含命中词的那几行（保留原本大小写与措辞），只展示真正支撑的原句 */
  function matchingLines(terms: string[]): string[] {
    const lines = (profile.experiences || "").split("\n").map((s) => s.trim()).filter(Boolean);
    return [...new Set(lines.filter((line) => terms.some((term) => term && containsSkillAlias(line, term))))];
  }

  /** 只讲证据，不替用户宣称能力；命中原文为空时绝不显示为「已具备」 */
  function readout(quotes: string[], hitAliases: string[]) {
    if (quotes.length === 0) {
      return {
        cls: "tag text-amber-600",
        label: "暂无从佐证",
        hint: `原话里没有直接找到能支撑「${hitAliases.join("、")}」的具体描述。先别急着勾上，回上一步把做过的事写具体，再回来核对。`,
      };
    }
    if (quotes.length >= 2 || hitAliases.length >= 2) {
      return {
        cls: "tag w1",
        label: "较强",
        hint: "原话里有多处具体动作可对应，可整理成一件能展示的作品。写进简历前，请自行确认这确实是你亲自做过的。",
      };
    }
    return {
      cls: "tag",
      label: "中等",
      hint: "原话只提到一处，建议先补清最终结果或产出物，再决定是否作为能力写进简历。",
    };
  }

  /** 白名单过滤：任何路径都不得把库外词条当作 skillId 写入 */
  function whitelist(ids: string[]): string[] {
    return filterKnownSkillIds(ids, knownSet);
  }

  function patch(next: Partial<Profile>) {
    setProfile({ ...profile, ...next });
  }

  function confirm(id: string) {
    const safe = whitelist([id]);
    if (!safe.length) {
      onNotice("这条不在知识库里，只能作为自定义词记录，不参与匹配分", "info");
      return;
    }
    if (!profile.knownSkillIds.includes(id)) {
      // 默认给「自述了解」档，用户可自行上调——不替用户往高了标
      const lv = profile.evidenceLevels[id] ?? 1;
      const nextPending = { ...pendingCandidates };
      delete nextPending[id];
      patch({
        knownSkillIds: [...profile.knownSkillIds, id],
        evidenceLevels: { ...profile.evidenceLevels, [id]: lv },
        pendingCandidates: nextPending,
      });
      onNotice(`已把「${SKILL_MAP[id]?.name}」记为这段经历的能力，默认证据「自述了解」，可在下方调准`, "info");
    }
  }

  function deny(id: string) {
    setDismissed((prev) => new Set(prev).add(id));
    const still = profile.knownSkillIds.filter((x) => x !== id);
    const nextPending = { ...pendingCandidates };
    delete nextPending[id];
    patch({ knownSkillIds: still, pendingCandidates: nextPending });
  }

  /** 暂不确定：既不确认也不否认，候选卡保留可回看 */
  function markUncertain(id: string) {
    patch({ pendingCandidates: { ...pendingCandidates, [id]: "uncertain" } });
    onNotice("已记为「暂不确定」——既不确认也不否认，候选卡会保留，随时可以回来再定", "info");
  }

  /** 修改：改指向另一个 skillId，或降级为自定义词（不参与匹配分） */
  function applyModify(id: string) {
    const nextPending = { ...pendingCandidates, [id]: "modified" as const };
    if (editTarget) {
      const safe = whitelist([editTarget]);
      if (!safe.length) {
        onNotice("目标词条不在知识库里，请改选库内技能或降级为自定义词", "error");
        return;
      }
      const known = new Set(profile.knownSkillIds.filter((x) => x !== id));
      known.add(editTarget);
      const lv = profile.evidenceLevels[editTarget] ?? 1;
      patch({
        knownSkillIds: [...known],
        evidenceLevels: { ...profile.evidenceLevels, [editTarget]: lv },
        pendingCandidates: nextPending,
      });
      onNotice(`已改为「${SKILL_MAP[editTarget]?.name}」（库内词条，参与匹配分）`, "info");
    } else if (editCustom.trim()) {
      const word = editCustom.trim();
      patch({
        knownSkillIds: profile.knownSkillIds.filter((x) => x !== id),
        customSkills: profile.customSkills.includes(word) ? profile.customSkills : [...profile.customSkills, word],
        pendingCandidates: nextPending,
      });
      onNotice(`已降级为自定义词「${word}」——只作记录，不参与匹配分`, "info");
    } else {
      onNotice("请选择一个库内技能，或填写自定义词", "error");
      return;
    }
    setDismissed((prev) => new Set(prev).add(id)); // 修改即已处置，候选卡不再重复出现
    setEditing("");
    setEditTarget("");
    setEditCustom("");
  }

  function setLevel(id: string, level: number) {
    patch({ evidenceLevels: { ...profile.evidenceLevels, [id]: level } });
  }

  function addManual() {
    const raw = customInput.trim();
    if (!raw) return;
    const low = raw.toLowerCase();
    const match =
      SKILL_MAP[low] ||
      Object.values(SKILL_MAP).find(
        (s) => s.name.toLowerCase() === low || s.aliases.some((a) => a.toLowerCase() === low)
      );
    if (match) {
      if (!profile.knownSkillIds.includes(match.id)) {
        patch({ knownSkillIds: [...profile.knownSkillIds, match.id] });
        onNotice(`「${match.name}」在技能库里，已帮你加上`, "info");
      } else {
        onNotice(`「${match.name}」已经在列表里了`, "info");
      }
    } else if (!profile.customSkills.includes(raw)) {
      patch({ customSkills: [...profile.customSkills, raw] });
      onNotice(`已添加「${raw}」；知识库里没有接近的词条，只作记录不参与匹配分`, "info");
    } else {
      onNotice(`「${raw}」已经在列表里了`, "info");
    }
    setCustomInput("");
  }

  return (
    <section className="evidence-workbench">
      <span className="chapter-label">02 / 看见经历 · 核对能力</span>
      <div className="evidence-workbench-heading"><div><h2 className="text-xl font-semibold tracking-tight text-foreground">把刚才的话，整理成几条证据。</h2><p className="mt-1 text-sm text-muted">系统只把原话里的线索递给你。逐条判断：这是我真的做过的吗？</p></div><div className="evidence-workbench-stats"><strong>{profile.knownSkillIds.length}</strong><span>已确认能力</span><strong>{pending.length}</strong><span>待核对线索</span></div></div>
      {profile.experiences && <blockquote className="source-quote evidence-source"><span>你的原话</span>{profile.experiences}</blockquote>}

      {layerUsed === "layer2" && (
        <p className="mt-3 rounded-md bg-[var(--surface-2)] px-3 py-2 text-xs text-muted">
          第一层（精确别名）没有命中，下面是规则近似兜底给出的候选（同义扩展 / 子串 / 拼写近似）。
          它们只是线索，请逐条确认；规则不会替你勾选。
        </p>
      )}

      {pending.length > 0 ? (
        <div className="mt-4 space-y-2.5 evidence-candidate-list">
          {pending.map((c) => {
            const quotes = matchingLines(c.hitAliases);
            const r = readout(quotes, c.hitAliases);
            const state = pendingCandidates[c.id];
            const isEditing = editing === c.id;
            return (
              <div key={c.id} className="card evidence-candidate-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="tag w1">{c.category}</span>
                  <span className="text-sm text-muted">这段经历，岗位通常叫</span>
                  <span className="text-base font-semibold tracking-tight text-foreground">{c.name}</span>
                  {c.source && <span className="tag w2">来源：{SOURCE_LABEL[c.source]}</span>}
                  {state === "uncertain" && <span className="tag text-amber-600">暂不确定</span>}
                </div>
                <div className="mt-1.5 text-xs text-muted">
                  匹配理由：原话里能对上「<span className="text-foreground">{c.hitAliases.join("、")}</span>」，
                  {c.source
                    ? `由第二层「${SOURCE_LABEL[c.source]}」给出，置信度${c.source === "alias-group" ? "高" : c.source === "substring" ? "中" : "低"}。`
                    : "由第一层词边界精确命中。"}
                </div>
                {c.cautionAliases.length > 0 && (
                  <p role="note" className="mt-2 rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-700">
                    「{c.cautionAliases.join("、")}」附近出现了否定、学习中或经验有限等表达。请核对上下文；规则不会把这类命中当作已确认能力。
                  </p>
                )}
                {quotes.length > 0 ? (
                  quotes.map((q) => (
                    <blockquote key={q} className="mt-1.5 border-l-2 border-[var(--border)] pl-2.5 text-xs text-foreground">
                      {q}
                    </blockquote>
                  ))
                ) : (
                  <p className="mt-1.5 text-xs italic text-amber-600">
                    暂无从佐证：没在原话里直接找到这一段的描述。勾选前请先确认你确实做过。
                  </p>
                )}
                <div className="mt-2.5 space-y-1.5 rounded-lg bg-[var(--surface-2)] px-3 py-2.5 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={r.cls}>佐证 {r.label}</span>
                    <span className="text-muted">要写进简历，还差点什么</span>
                  </div>
                  <div className="text-muted">待补：{r.hint}</div>
                </div>

                {isEditing ? (
                  <div className="mt-3 rounded-lg border border-[var(--border)] p-3">
                    <div className="text-xs text-muted">修改为：</div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <select
                        className="input w-auto! py-1! text-xs!"
                        value={editTarget}
                        onChange={(e) => {
                          setEditTarget(e.target.value);
                          setEditCustom("");
                        }}
                      >
                        <option value="">选择库内技能…</option>
                        {allSkills().map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                      <button type="button" className="btn btn-ghost px-3 py-1.5 text-xs" onClick={() => applyModify(c.id)}>
                        改指向
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <input
                        className="input w-auto! flex-1 py-1! text-xs!"
                        value={editCustom}
                        onChange={(e) => {
                          setEditCustom(e.target.value);
                          setEditTarget("");
                        }}
                        placeholder="或降级为自定义词（只记录，不参与匹配分）"
                      />
                      <button type="button" className="btn btn-ghost px-3 py-1.5 text-xs" onClick={() => applyModify(c.id)}>
                        降级为自定义词
                      </button>
                    </div>
                    <button type="button" className="quiet-button mt-2 text-xs" onClick={() => setEditing("")}>
                      取消修改
                    </button>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    <button onClick={() => deny(c.id)} className="btn btn-ghost px-3 py-1.5 text-xs">
                      否认
                    </button>
                    <button onClick={() => markUncertain(c.id)} className="btn btn-ghost px-3 py-1.5 text-xs">
                      暂不确定
                    </button>
                    <button
                      onClick={() => {
                        setEditing(c.id);
                        setEditTarget(c.id);
                        setEditCustom("");
                      }}
                      className="btn btn-ghost px-3 py-1.5 text-xs"
                    >
                      修改
                    </button>
                    <button onClick={() => confirm(c.id)} className="btn btn-primary px-3 py-1.5 text-xs">
                      确认
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-4 rounded-xl bg-[var(--surface-2)] px-3 py-3 text-xs text-muted">
          {candidates.length
            ? "上一步提到的基础能力都已确认或标记过。可回上一步补充经历，或在下方手动加。"
            : "暂无可确认的候选能力，可在下方手动补充，或展开详细资料填写。"}
        </div>
      )}

      {Object.entries(pendingCandidates).filter(([, v]) => v === "uncertain").length > 0 && (
        <p className="mt-3 text-xs text-muted">
          另有 {Object.entries(pendingCandidates).filter(([, v]) => v === "uncertain").length} 项标记为「暂不确定」——
          它们没有被计入能力，也不会被否认，随时可以回来看。
        </p>
      )}

      <div className="card evidence-board mt-4 p-5">
        <h3 className="text-base font-medium text-foreground">
          已确认的能力
          <span className="ml-2 text-xs font-normal text-muted">{profile.knownSkillIds.length} 项</span>
        </h3>
        <p className="mt-1 text-xs text-muted">
          证据等级为自评；只有实际项目及以上（≥3）计入项目证据覆盖。
        </p>
        {profile.knownSkillIds.length > 0 ? (
          <div className="mt-3 space-y-2">
            {profile.knownSkillIds.map((id) => {
              const s = SKILL_MAP[id];
              if (!s) return null;
              const lv = profile.evidenceLevels[id] ?? 1;
              return (
                <div
                  key={id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--surface-2)] px-3 py-2"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm text-foreground">{s.name}</span>
                    {(profile.tempSkillIds || []).includes(id) && (
                      <span className="text-[0.7rem] text-muted">临时</span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <label className="flex items-center gap-1.5">
                      <span className="text-[0.7rem] text-muted">证据</span>
                      <select
                        value={lv}
                        onChange={(e) => setLevel(id, Number(e.target.value))}
                        className="input w-auto! py-1! text-xs!"
                        title={EVIDENCE_LEVELS.find((e) => e.level === lv)?.desc}
                      >
                        {EVIDENCE_LEVELS.map((e) => (
                          <option key={e.level} value={e.level}>
                            {e.level}: {e.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      onClick={() => patch({ knownSkillIds: profile.knownSkillIds.filter((x) => x !== id) })}
                      className="shrink-0 text-xs text-muted transition-colors hover:text-red-500"
                      title="移除这项能力"
                    >
                      移除
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted">还没确认任何能力。</p>
        )}

        <div className="mt-4 flex gap-2">
          <input
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addManual();
              }
            }}
            placeholder="手动补充能力（如 Excel 制表、接口测试），回车或点添加"
            className="input"
            style={{ flex: 1 }}
          />
          <button onClick={addManual} className="btn btn-ghost shrink-0 px-3 py-1.5 text-xs">
            添加
          </button>
        </div>
        <p className="mt-2 text-xs text-muted">
          输入能对上知识库的词条会参与匹配分；对不上的只作记录。
        </p>
      </div>

      <details open={showProfile} onToggle={(e) => setShowProfile(e.currentTarget.open)} className="mt-4 group">
        <summary className="cursor-pointer select-none text-sm text-accent transition-colors hover:underline">
          导入简历 / 补充资料与技能 / 方向与每周时间
        </summary>
        <div className="mt-3">
          <ProfileForm
            profile={profile}
            setProfile={setProfile}
            setError={setError}
            onNotice={onNotice}
            onNext={onNext}
            nextLabel="看看可能的方向"
          />
        </div>
      </details>

      <button onClick={onNext} disabled={!profile.knownSkillIds.length} className="btn btn-primary mt-5 w-full">
        带着这些能力，看看可能的方向 →
      </button>
    </section>
  );
}
