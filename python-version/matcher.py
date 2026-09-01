"""
职途 · 匹配与路径算法（产品核心，零 LLM 依赖）

⚠️ 与 ../lib/matcher.ts 是同一套算法的两个实现，改动时请同步。
数据统一读 ../data/*.json，两版共用单一数据源。

设计原则：
1. 所有数字都能追溯到计算过程，UI 必须能解释"这个分是怎么来的"。
2. 覆盖率是主指标，不掺入无法解释的玄学权重。
3. estHours 是经验估算，任何展示都必须标注"估算"。
"""

import json
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "..", "data")

with open(os.path.join(DATA_DIR, "skills.json"), encoding="utf-8") as f:
    SKILLS = json.load(f)["skills"]
with open(os.path.join(DATA_DIR, "jobs.json"), encoding="utf-8") as f:
    _jobs_data = json.load(f)

JOBS = _jobs_data["jobs"]
TRACKS = _jobs_data["tracks"]

SKILL_MAP = {s["id"]: s for s in SKILLS}
TRACK_NAME = {t["id"]: t["name"] for t in TRACKS}


def all_skills():
    return SKILLS


def all_tracks():
    return TRACKS


def job_ids() -> set:
    """岗位 id 全量集合：校验历史 id 是否仍有效，避免旧数据让页面出错"""
    return {j["id"] for j in JOBS}


def _ref(skill_id: str, weight: int) -> dict:
    s = SKILL_MAP[skill_id]
    return {"id": skill_id, "name": s["name"], "weight": weight, "estHours": s["estHours"]}


def detect_skills(text: str, categories: list = None) -> list:
    """从自由文本识别用户可能已掌握的技能（aliases 命中即算），用于预勾选而非静默判定"""
    t = (text or "").lower()
    hit = []
    for s in SKILLS:
        if categories and s["category"] not in categories:
            continue
        if any(a.lower() in t for a in s.get("aliases", [])):
            hit.append(s["id"])
    return hit


def profile_text(p: dict) -> str:
    return " ".join(
        x for x in [p.get("major"), p.get("grade"), p.get("works"),
                    p.get("certificates"), p.get("selfDescription"), p.get("interests")] if x
    ).lower()


def match_job(profile: dict, job_id: str) -> dict:
    job = next((j for j in JOBS if j["id"] == job_id), None)
    if not job:
        raise ValueError("UNKNOWN_JOB")

    known = set(profile.get("knownSkillIds") or [])
    hpw = profile.get("hoursPerWeek") or 0
    hours_per_week = hpw if hpw > 0 else 10
    tracks = set(profile.get("targetTracks") or [])

    covered, missing = [], []
    for c in job["core"]:
        (covered if c["s"] in known else missing).append(_ref(c["s"], c["w"]))

    total_w = sum(c["w"] for c in job["core"])
    covered_w = sum(s["weight"] for s in covered)
    coverage = round(covered_w / total_w * 100) if total_w else 0

    plus_covered = [SKILL_MAP[s]["name"] for s in (job.get("plus") or []) if s in known]
    plus_rate = len(plus_covered) / len(job["plus"]) if job.get("plus") else 0
    track_rate = 1 if (not tracks or job["track"] in tracks) else 0.5

    # 覆盖率 75% + 加分项 15% + 方向契合 10%
    score = round(coverage * 0.75 + plus_rate * 100 * 0.15 + track_rate * 100 * 0.1)

    gap_hours = sum(s["estHours"] for s in missing)
    eta_weeks = round(gap_hours / hours_per_week * 10) / 10

    reasons = [f"必备技能覆盖 {len(covered)}/{len(job['core'])} 项（按权重计 {coverage}%）"]
    hard_covered = [s["name"] for s in covered if s["weight"] == 3]
    if hard_covered:
        reasons.append(f"已具备硬门槛技能：{'、'.join(hard_covered)}")
    if missing:
        hard_missing = [s["name"] for s in missing if s["weight"] == 3]
        reasons.append(
            f"缺失关键门槛：{'、'.join(hard_missing)}" if hard_missing
            else f"待补齐项均为重要但非硬门槛：{'、'.join(s['name'] for s in missing)}"
        )
    else:
        reasons.append("必备技能已全部覆盖，可直接投递试试")
    if plus_covered:
        reasons.append(f"加分项已具备：{'、'.join(plus_covered)}")
    if tracks and job["track"] not in tracks:
        reasons.append("该岗位属于你未勾选的方向，匹配分已打折")

    return {
        "jobId": job["id"],
        "title": job["title"],
        "track": job["track"],
        "trackName": TRACK_NAME.get(job["track"], job["track"]),
        "summary": job["summary"],
        "score": score,
        "coverage": coverage,
        "covered": sorted(covered, key=lambda s: -s["weight"]),
        "missing": sorted(missing, key=lambda s: -s["weight"]),
        "plusCovered": plus_covered,
        "gapHours": gap_hours,
        "etaWeeks": eta_weeks,
        "salary": job["salary"],
        "threshold": job["threshold"],
        "growth": job["growth"],
        "reasons": reasons,
    }


def rank_jobs(profile: dict, limit: int = 8) -> list:
    ranked = [match_job(profile, j["id"]) for j in JOBS]
    ranked.sort(key=lambda m: (-m["score"], -m["coverage"], m["gapHours"]))
    return ranked[:limit]


def build_path(profile: dict, job_id: str) -> list:
    """按性价比排序：权重高、耗时短的先学"""
    m = match_job(profile, job_id)
    hpw = profile.get("hoursPerWeek") or 0
    hours_per_week = hpw if hpw > 0 else 10

    raw = sorted(m["missing"], key=lambda s: -(s["weight"] / s["estHours"]))
    max_value = raw[0]["weight"] / raw[0]["estHours"] if raw else 1

    out, acc = [], 0
    for s in raw:
        acc += s["estHours"]
        out.append({
            "skillId": s["id"],
            "name": s["name"],
            "weight": s["weight"],
            "estHours": s["estHours"],
            "priority": round((s["weight"] / s["estHours"]) / max_value * 100),
            "cumulativeWeeks": round(acc / hours_per_week * 10) / 10,
            "resources": [
                {"title": r["title"], "platform": r["platform"], "query": f"{r['title']} {s['name']}".strip()}
                for r in SKILL_MAP[s["id"]].get("resources", [])
            ],
        })
    return out


def build_gap_map(profile: dict, job_ids: list) -> dict:
    known = set(profile.get("knownSkillIds") or [])
    jobs = [match_job(profile, jid) for jid in job_ids]
    skill_ids, seen = [], set()
    for j in jobs:
        for s in j["covered"] + j["missing"]:
            if s["id"] not in seen:
                seen.add(s["id"])
                skill_ids.append(s["id"])
    return {
        "jobs": [{"jobId": j["jobId"], "title": j["title"], "coverage": j["coverage"], "score": j["score"]} for j in jobs],
        "skills": [{
            "id": sid,
            "name": SKILL_MAP[sid]["name"],
            "known": sid in known,
            "estHours": SKILL_MAP[sid]["estHours"],
            "requiredBy": [j["title"] for j in jobs
                           if any(s["id"] == sid for s in j["covered"] + j["missing"])],
        } for sid in skill_ids],
    }
