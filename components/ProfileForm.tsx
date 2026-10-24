"use client";

/**
 * Step 0 · 我的情况
 * 收集基本资料、简历导入、技能勾选/添加、方向与每周时间
 */
import { useMemo, useState } from "react";
import {
  allSkills,
  allTracks,
  detectSkills,
  profileText,
  SKILL_MAP,
} from "@/lib/matcher";
import { ResumeImport } from "@/components/ResumeImport";
import type { Profile } from "@/lib/types";

const HOUR_PRESETS = [4, 6, 10, 12, 15, 20, 30];

export function ProfileForm({
  profile,
  setProfile,
  setError: reportError,
  onNotice,
  onNext,
  nextLabel = "查看方向结果",
}: {
  profile: Profile;
  setProfile: (p: Profile) => void;
  setError: (msg: string | null) => void;
  onNotice: (msg: string, kind: "error" | "info") => void;
  onNext: () => void;
  nextLabel?: string;
}) {
  const skills = allSkills();
  const tracks = allTracks();
  const groups = useMemo(() => {
    const m = new Map<string, typeof skills>();
    for (const s of skills) {
      if (!m.has(s.category)) m.set(s.category, []);
      m.get(s.category)!.push(s);
    }
    return Array.from(m.entries());
  }, [skills]);

  const set = <K extends keyof Profile>(key: K, value: Profile[K]) =>
    setProfile({ ...profile, [key]: value });

  function toggleSkill(id: string) {
    const has = profile.knownSkillIds.includes(id);
    if (has) {
      setProfile({
        ...profile,
        knownSkillIds: profile.knownSkillIds.filter((x) => x !== id),
        tempSkillIds: (profile.tempSkillIds || []).filter((x) => x !== id),
      });
    } else {
      setProfile({ ...profile, knownSkillIds: [...profile.knownSkillIds, id] });
    }
  }

  function toggleTrack(id: string) {
    const has = profile.targetTracks.includes(id);
    set(
      "targetTracks",
      has ? profile.targetTracks.filter((x) => x !== id) : [...profile.targetTracks, id]
    );
  }

  const [customInput, setCustomInput] = useState("");
  // 未命中库内词条时的映射待选：输入「仅记录」前先让用户决定要不要按某个相近技能计入本次评分
  const [suggestFor, setSuggestFor] = useState<string | null>(null);

  /** 未命中词条 → 找最多 6 个名称/别名沾边的库内技能，供用户「临时按它计分」 */
  function suggestCandidates(raw: string) {
    const low = raw.toLowerCase();
    if (low.length < 2) return [];
    const sc = skills.filter((s) => {
      const names = [s.name.toLowerCase(), ...s.aliases.map((a) => a.toLowerCase())];
      return names.some((n) => n.includes(low) || low.includes(n));
    });
    return sc.sort((a, b) => a.name.length - b.name.length).slice(0, 6);
  }

  // 学习小时数：本地字符串态，允许清空/自由输入，失焦或回车时才落库，
  // 避免「删不掉、强制回 1」的输入 bug；合法范围 1–80，非法/空回默认 10
  const [hoursRaw, setHoursRaw] = useState(String(profile.hoursPerWeek));

  function commitHours() {
    const t = hoursRaw.trim();
    const v = t === "" ? NaN : Number(t);
    const next = Number.isFinite(v) && v >= 1 && v <= 80 ? v : 10;
    setHoursRaw(String(next));
    if (next !== profile.hoursPerWeek) set("hoursPerWeek", next);
  }

  /** 自动识别：优先用已填资料；命中即预勾选并提示「仅供参考，请核对」 */
  function autoDetect() {
    const text = profileText(profile);
    if (!text.trim()) {
      reportError("先在专业 / 作品 / 介绍里写点内容，或上传一份简历，我再帮你识别");
      return;
    }
    const detected = detectSkills(text);
    if (!detected.length) {
      reportError("未识别到知识库内的技能关键词，可在上方输入框手动添加");
      return;
    }
    const fresh = detected.filter((id) => !profile.knownSkillIds.includes(id));
    if (!fresh.length) {
      onNotice("你填的内容里能识别的技能都已经勾上了", "info");
      return;
    }
    set("knownSkillIds", [...profile.knownSkillIds, ...fresh]);
    onNotice(
      `从填的内容里识别到 ${fresh.length} 项，已预勾选——自动识别仅供参考，可能有偏差，请逐条核对`,
      "info"
    );
  }

  /**
   * 自由添加：优先对齐知识库词条（名称/别名精确或包含命中 → 计入评分）；
   * 完全对不上 → 存为自定义技能，仅记录不参与匹配分，避免"库里没有就加不了"。
   */
  function addCustom() {
    const raw = customInput.trim();
    if (!raw) return;
    const low = raw.toLowerCase();
    const exact = skills.find(
      (s) =>
        s.name.toLowerCase() === low ||
        s.aliases.some((a) => a.toLowerCase() === low)
    );
    let matched = exact;
    if (!matched) {
      const sub = skills.filter(
        (s) =>
          low.includes(s.name.toLowerCase()) ||
          s.name.toLowerCase().includes(low)
      );
      matched = sub.sort((a, b) => a.name.length - b.name.length)[0];
    }
    if (matched) {
      if (!profile.knownSkillIds.includes(matched.id)) {
        set("knownSkillIds", [...profile.knownSkillIds, matched.id]);
        onNotice(`「${matched.name}」在技能库里，已帮你勾上`, "info");
      } else {
        onNotice(`「${matched.name}」已经在列表里了`, "info");
      }
    } else {
      const cands = suggestCandidates(raw);
      if (cands.length) {
        setSuggestFor(raw);
        return;
      }
      if (!profile.customSkills.includes(raw)) {
        set("customSkills", [...profile.customSkills, raw]);
        onNotice(
          `已添加「${raw}」；知识库里找不到接近的词条，它不参与匹配分，只作记录`,
          "info"
        );
      } else {
        onNotice(`「${raw}」已经在列表里了`, "info");
      }
    }
    setCustomInput("");
  }

  /** 把用户自定义说法按库内技能一次性计入（保存本次规划后自动移除；不写全局知识库） */
  function addAsMapped(raw: string, skillId: string) {
    const s = SKILL_MAP[skillId];
    if (!s) return;
    if (!profile.knownSkillIds.includes(skillId)) {
      setProfile({
        ...profile,
        knownSkillIds: [...profile.knownSkillIds, skillId],
        tempSkillIds: [...(profile.tempSkillIds || []), skillId],
      });
      onNotice(
        `已把「${raw}」按「${s.name}」临时计入（同权重参与本次计算，保存这份规划后会自动移除）`,
        "info"
      );
    } else {
      onNotice(`「${s.name}」已经在列表里了`, "info");
    }
    setSuggestFor(null);
    setCustomInput("");
  }

  function removeCustom(name: string) {
    set("customSkills", profile.customSkills.filter((x) => x !== name));
  }

  const totalKnown = profile.knownSkillIds.length + profile.customSkills.length;

  return (
    <section>
      <h2 className="text-xl font-semibold tracking-tight text-foreground">我的情况</h2>
      <p className="mt-1 text-sm text-muted">
        请补充以下三项信息，以生成岗位匹配结果。信息越准确，匹配依据和能力差距越清晰。
      </p>

      <div className="card mt-5 p-5">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="lbl">专业</span>
            <input
              className="input"
              placeholder="数据科学与大数据技术"
              value={profile.major}
              onChange={(e) => set("major", e.target.value)}
            />
          </label>
          <label className="block">
            <span className="lbl">年级</span>
            <input
              className="input"
              placeholder="大三"
              value={profile.grade}
              onChange={(e) => set("grade", e.target.value)}
            />
          </label>
        </div>

        <label className="mt-3 block">
          <span className="lbl">作品 / 项目</span>
          <textarea
            className="input min-h-[76px] resize-y"
            placeholder="做过什么、用了什么技术、结果如何（识别技能的关键来源）"
            value={profile.works}
            onChange={(e) => set("works", e.target.value)}
          />
        </label>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="lbl">证书</span>
            <input
              className="input"
              placeholder="计算机二级、英语四级…"
              value={profile.certificates}
              onChange={(e) => set("certificates", e.target.value)}
            />
          </label>
          <label className="block">
            <span className="lbl">兴趣方向</span>
            <input
              className="input"
              placeholder="AI 产品、数据分析…"
              value={profile.interests}
              onChange={(e) => set("interests", e.target.value)}
            />
          </label>
        </div>

        <label className="mt-3 block">
          <span className="lbl">自我介绍</span>
          <textarea
            className="input min-h-[76px] resize-y"
            placeholder="自我描述，会从里面识别技能关键词"
            value={profile.selfDescription}
            onChange={(e) => set("selfDescription", e.target.value)}
          />
        </label>
      </div>

      <div className="card mt-4 p-5">
        <h3 className="text-base font-medium text-foreground">简历导入（推荐）</h3>
        <p className="mt-0.5 text-xs text-muted">
          上传 PDF / DOCX / TXT（≤5MB），由当前应用服务端提取文字并返回浏览器识别，再预勾选技能。
          <span className="ml-1 rounded bg-accent-soft px-1.5 text-[0.7rem] text-accent-strong">
            应用代码不持久化简历文件或正文、不调用第三方模型
          </span>
          <span className="ml-1">远程部署时，文件会发送到部署服务器。</span>
        </p>
        <div className="mt-3">
          <ResumeImport
            onNotice={onNotice}
            onSanitizedText={(text) => setProfile({
              ...profile,
              experiences: text,
              experienceMasking: {
                version: "regex-v1",
                manualTerms: profile.experienceMasking?.manualTerms ?? [],
                autoMaskedCount: 0,
                cleanedText: text,
                cleanedAt: Date.now(),
              },
            })}
            onDetected={(ids) =>
              set("knownSkillIds", Array.from(new Set([...profile.knownSkillIds, ...ids])))
            }
          />
        </div>
      </div>

      <div className="card mt-4 p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-medium text-foreground">
              你会什么
              <span className="ml-2 text-xs font-normal text-muted">
                已确认 {totalKnown} 项 · 标「临时」仅本次有效
              </span>
            </h3>
            <p className="mt-0.5 text-xs text-muted">
              权重 3=硬门槛 2=重要 1=补充；用于要求向量和缺口排序
            </p>
          </div>
          <button onClick={autoDetect} className="btn btn-ghost shrink-0 whitespace-nowrap px-3 py-1.5 text-xs">
            从填的内容识别
          </button>
        </div>

        {profile.knownSkillIds.length > 0 && (
          <div className="mt-4">
            <div className="flex flex-wrap gap-2">
              {profile.knownSkillIds.map((id) => {
                const s = SKILL_MAP[id];
                if (!s) return null;
                const isTemp = (profile.tempSkillIds || []).includes(id);
                return (
                  <button
                    key={id}
                    onClick={() => toggleSkill(id)}
                    className="chip-btn on"
                    title={
                      isTemp
                        ? `${s.name} · 临时技能（本次规划用，保存后自动移除；点一下取消）`
                        : `${s.name} · 已勾选（点一下取消）`
                    }
                  >
                    {s.name}
                    {isTemp && <span className="ml-1 text-[0.7rem] font-normal opacity-70">临时</span>}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-muted">
              自动识别仅供参考——可点掉也可手动加；「临时」标的是映射来的技能，保存本规划后自动移除
            </p>
          </div>
        )}

        {profile.knownSkillIds.length === 0 && profile.customSkills.length === 0 && (
          <p className="mt-4 text-xs text-muted">
            尚未添加技能：可填写资料后自动识别、上传简历识别，或在下方输入框中手动添加。
          </p>
        )}

        <div className="mt-4 flex gap-2">
          <input
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCustom();
              }
            }}
            placeholder="输入技能名称（如 Vue、接口测试），回车或点添加"
            className="input"
            style={{ flex: 1 }}
          />
          <button onClick={addCustom} className="btn btn-ghost shrink-0 px-3 py-1.5 text-xs">
            添加
          </button>
        </div>

        {suggestFor && (
          <div className="mt-3 rounded-xl bg-[var(--surface-2)] p-3">
            <div className="text-xs text-foreground">
              「{suggestFor}」不在知识库里。下面这些比较接近——选一个会<strong>按它临时计分</strong>（仅当前档案，随时可取消）：
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {suggestCandidates(suggestFor).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => addAsMapped(suggestFor, s.id)}
                  className="chip-btn px-2.5 py-1 text-xs"
                  title={`按「${s.name}」计入评分（预估掌握需 ${s.estHours} 小时）`}
                >
                  {s.name}
                </button>
              ))}
            </div>
            <div className="mt-2.5 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  if (!profile.customSkills.includes(suggestFor)) {
                    set("customSkills", [...profile.customSkills, suggestFor]);
                    onNotice(
                      `已把「${suggestFor}」存为自定义记录，不参与评分（库内没有可信的相近词条）`,
                      "info"
                    );
                  }
                  setSuggestFor(null);
                  setCustomInput("");
                }}
                className="btn btn-ghost px-2.5 py-1 text-xs"
              >
                都不太对 → 仅记录
              </button>
              <button
                type="button"
                onClick={() => {
                  setSuggestFor(null);
                  setCustomInput("");
                }}
                className="px-2.5 text-xs text-muted hover:text-foreground"
              >
                算了
              </button>
            </div>
          </div>
        )}

        {profile.customSkills.length > 0 && (
          <div className="mt-3">
            <div className="mb-1.5 text-xs font-medium text-muted">自定义添加（仅记录，不影响匹配分）</div>
            <div className="flex flex-wrap gap-2">
              {profile.customSkills.map((c) => (
                <button
                  key={c}
                  onClick={() => removeCustom(c)}
                  className="chip-btn on"
                  title={`${c} · 自定义技能（点一下移除）`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        )}

        <details className="mt-4 group">
          <summary className="cursor-pointer select-none text-xs text-muted transition-colors hover:text-foreground">
            手动从技能库挑（共 {skills.length} 项，按分类）——一般用不到，供精确补充
          </summary>
          <div className="mt-3 space-y-3">
            {groups.map(([cat, list]) => (
              <div key={cat}>
                <div className="mb-2 text-xs font-medium text-muted">{cat}</div>
                <div className="flex flex-wrap gap-2">
                  {list.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => toggleSkill(s.id)}
                      className={`chip-btn ${profile.knownSkillIds.includes(s.id) ? "on" : ""}`}
                      title={`预估掌握需 ${s.estHours} 小时`}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </details>
      </div>

      <div className="card mt-4 p-5">
        <h3 className="text-base font-medium text-foreground">想去的领域</h3>
        <p className="mt-0.5 text-xs text-muted">
          可多选；未选时各方向权重相同
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {tracks.map((t) => (
            <button
              key={t.id}
              onClick={() => toggleTrack(t.id)}
              className={`chip-btn ${profile.targetTracks.includes(t.id) ? "on" : ""}`}
            >
              {t.name}
            </button>
          ))}
        </div>

        <label className="mt-5 block">
          <span className="lbl">每周能投入的学习时间</span>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={80}
              step={1}
              value={hoursRaw}
              onChange={(e) => setHoursRaw(e.target.value)}
              onBlur={commitHours}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitHours();
                  (e.target as HTMLInputElement).blur();
                }
              }}
              className="input no-spinner w-24 text-base font-semibold tracking-tight tabular-nums"
              aria-label="每周学习小时数"
              placeholder="10"
            />
            <span className="text-sm text-muted">小时 / 周</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {HOUR_PRESETS.map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => {
                  setHoursRaw(String(h));
                  set("hoursPerWeek", h);
                }}
                className={`chip-btn px-3 py-1 text-xs num ${
                  profile.hoursPerWeek === h ? "on" : ""
                }`}
                title={`设为每周 ${h} 小时`}
              >
                {h} 小时
              </button>
            ))}
            {profile.hoursPerWeek > 0 && !HOUR_PRESETS.includes(profile.hoursPerWeek) && (
              <span className="chip-btn on px-3 py-1 text-xs num" title="你输入的自定义值，已生效">
                {profile.hoursPerWeek} 小时 · 自定义 ✓
              </span>
            )}
          </div>
          <span className="hint">
            默认 10 小时/周，调整后补齐周期估算随之更新
          </span>
        </label>

        <label className="mt-3 block">
          <span className="lbl">目标（选填）</span>
          <input
            className="input"
            placeholder="例：三个月内拿到 AI 产品实习"
            value={profile.goal}
            onChange={(e) => set("goal", e.target.value)}
          />
        </label>
      </div>

      <button onClick={onNext} className="btn btn-primary mt-5 w-full">
        {nextLabel}
      </button>
    </section>
  );
}
