"""
职途 · Python 后端（Flask）
职责：读取 .env 里的密钥 -> 按阶段拼提示词 -> 调 OpenAI 兼容大模型 -> 返回 JSON。
前端 index.html 通过 /api/career 调它，得到结构化结果后自己渲染界面。
"""
import os
import re
import json
import requests
from flask import Flask, request, jsonify, send_from_directory
from dotenv import load_dotenv

import local_engine
import matcher

load_dotenv()  # 自动读取同目录下的 .env 文件

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
app = Flask(__name__, static_folder=None)


# ============================================================
# 1) 调大模型
# ============================================================
def parse_json(content: str):
    """LLM 有时会在 JSON 外面包一层 ```json 代码块，这里兜底抠出 {...}。"""
    try:
        return json.loads(content)
    except Exception:
        m = re.search(r"\{[\s\S]*\}", content)
        if m:
            return json.loads(m.group(0))
        raise ValueError("INVALID_JSON_FROM_LLM")


def call_llm(system: str, user: str, temperature: float = 0.4) -> dict:
    api_key = os.getenv("LLM_API_KEY")
    if not api_key:
        raise ValueError("MISSING_API_KEY")

    base = (os.getenv("LLM_BASE_URL") or "https://api.openai.com/v1").rstrip("/")
    model = os.getenv("LLM_MODEL") or "gpt-4o-mini"

    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]

    def do(use_json_format: bool) -> requests.Response:
        body = {"model": model, "temperature": temperature, "messages": messages}
        # 部分兼容服务不支持 response_format，遇到 400 就降级重试
        if use_json_format:
            body["response_format"] = {"type": "json_object"}
        return requests.post(
            f"{base}/chat/completions",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            json=body,
            timeout=60,
        )

    resp = do(True)
    if resp.status_code == 400:
        resp = do(False)
    if not resp.ok:
        raise ValueError(f"LLM_HTTP_{resp.status_code}: {resp.text[:300]}")

    data = resp.json()
    content = data.get("choices", [{}])[0].get("message", {}).get("content", "{}")
    return parse_json(content)


# ============================================================
# 2) 可选的联网搜索（Tavily）。没配置密钥就安静返回空字符串。
# ============================================================
def web_search(query: str) -> str:
    key = os.getenv("TAVILY_API_KEY")
    if not key:
        return ""
    try:
        resp = requests.post(
            "https://api.tavily.com/search",
            headers={"Content-Type": "application/json"},
            json={
                "api_key": key,
                "query": query,
                "max_results": 5,
                "search_depth": "basic",
            },
            timeout=30,
        )
        if not resp.ok:
            return ""
        results = resp.json().get("results", [])
        return "\n".join(f"- {r.get('title')}: {r.get('content')}" for r in results)[:2000]
    except Exception:
        return ""


# ============================================================
# 3) 4 个阶段的提示词（决定 LLM 输出什么结构的数据）
# ============================================================
def build_prompt(stage: str, payload: dict):
    if stage == "locate":
        bg = payload
        system = (
            "你是大学生职业规划助手，语气温和、专业、不说教。根据用户提供的专业、作品、证书与自我介绍，"
            "给出初步职业定位。只输出 JSON，不要任何额外文字。"
            "结构：{strengths: string[], gaps: string[], directions: string[], summary: string}。"
            "strengths 是用户已具备的优势能力（基于作品/证书具体推断）；gaps 是明显短板或待补齐项；"
            "directions 是 3-5 个最贴合的职业方向（用国内常见岗位/方向名）；summary 是一句话定位。全部用中文。"
        )
        user = f"我的背景信息（JSON）：\n{json.dumps(bg, ensure_ascii=False, indent=2)}\n请输出定位 JSON。"
        return system, user

    if stage == "refine_recommend":
        background = payload.get("background", {})
        positioning = payload.get("positioning", {})
        market = payload.get("marketContext", "")
        ctx = f"\n\n当前就业市场参考信息：\n{market}" if market else ""
        system = (
            "你是大学生职业规划助手。结合用户背景与他亲自确认的定位，推荐 4-6 个最匹配的岗位。"
            "只输出 JSON，不要额外文字。"
            "结构：{jobs: [{title: string, matchReason: string, matchScore: number}]}。"
            "title 用国内常见岗位名；matchReason 一句话说明匹配逻辑；"
            "matchScore 为 0-100 的整数，反映与用户背景的契合度。全部用中文。"
        )
        user = (
            f"背景信息：\n{json.dumps(background, ensure_ascii=False, indent=2)}\n\n"
            f"经我确认的定位：\n{json.dumps(positioning, ensure_ascii=False, indent=2)}{ctx}"
            "\n请输出岗位推荐 JSON。"
        )
        return system, user

    if stage == "skills":
        job_title = payload.get("jobTitle", "")
        background = payload.get("background", {})
        system = (
            "你是资深招聘专家，对国内各岗位招聘要求很熟悉。针对给定岗位，解析大学生要胜任它需要掌握的基本技能。"
            "只输出 JSON，不要额外文字。"
            "结构：{mustHave: string[], niceToHave: string[], tools: string[]}。"
            "mustHave 是必备核心技能；niceToHave 是加分项；tools 是常用工具/平台。全部用中文，具体、可操作。"
        )
        user = (
            f"目标岗位：{job_title}\n"
            f"用户背景摘要：{json.dumps(background, ensure_ascii=False)}\n请输出技能解析 JSON。"
        )
        return system, user

    if stage == "resources":
        job_title = payload.get("jobTitle", "")
        goal = payload.get("goal", "")
        skills = payload.get("skills", {})
        system = (
            "你是学习路径规划助手。根据用户的学习目标、目标岗位和需补齐的技能，推荐 4-6 个学习资源。"
            "只输出 JSON，不要额外文字。"
            "结构：{resources: [{title: string, platform: string, query: string, note: string}]}。"
            "platform 只能从以下选择：B站, 慕课网, Coursera, freeCodeCamp, 掘金, YouTube, 官方文档, 其他。"
            "query 是搜索关键词（中文或英文短词）。note 一句话说明为什么适合。全部用中文。"
        )
        user = (
            f"目标岗位：{job_title}\n学习目标：{goal}\n"
            f"需要补齐的技能：{json.dumps(skills, ensure_ascii=False)}\n请输出学习资源 JSON。"
        )
        return system, user

    raise ValueError("UNKNOWN_STAGE")


# ============================================================
# 4) 学习资源链接拼接：把"平台+关键词"变成真实可点的搜索链接，避免 LLM 编出 404
# ============================================================
PLATFORM_TEMPLATES = {
    "B站": lambda q: f"https://search.bilibili.com/all?keyword={q}",
    "慕课网": lambda q: f"https://www.imooc.com/search?words={q}",
    "Coursera": lambda q: f"https://www.coursera.org/search?query={q}",
    "freeCodeCamp": lambda q: f"https://www.freecodecamp.org/news/search/?query={q}",
    "掘金": lambda q: f"https://search.juejin.cn/?query={q}",
    "YouTube": lambda q: f"https://www.youtube.com/results?search_query={q}",
    "官方文档": lambda q: f"https://www.google.com/search?q={q}+官方文档",
}


def resolve_url(platform: str, query: str) -> str:
    q = requests.utils.quote(query.strip())
    tpl = PLATFORM_TEMPLATES.get(platform)
    if tpl:
        return tpl(q)
    return f"https://www.google.com/search?q={requests.utils.quote(platform + ' ' + query)}"


# ============================================================
# 5) 接口：前端唯一调用的后端入口
# ============================================================
def _is_offline() -> bool:
    """CAREER_MODE=offline 强制规则引擎；未配置 LLM_API_KEY 时自动降级"""
    if os.getenv("CAREER_MODE") == "offline":
        return True
    return not os.getenv("LLM_API_KEY")


@app.route("/api/career", methods=["POST"])
def career():
    try:
        body = request.get_json(force=True, silent=True) or {}
        stage = body.get("stage")
        payload = body.get("payload")
        if not stage or not payload:
            return jsonify({"error": "stage 和 payload 为必填"}), 400

        # 无密钥或显式指定 offline：走本地规则引擎，不调大模型
        if _is_offline():
            result = local_engine.run(stage, payload)
            if stage == "resources" and isinstance(result.get("resources"), list):
                for r in result["resources"]:
                    r["url"] = resolve_url(r.get("platform", ""), r.get("query", ""))
            return jsonify({"result": result, "mode": local_engine.RULE_MODE})

        # 岗位推荐阶段：若配了联网搜索，先拉市场参考信息注入提示词
        if stage == "refine_recommend":
            dirs = "、".join(payload.get("positioning", {}).get("directions", []))
            major = payload.get("background", {}).get("major", "")
            payload["marketContext"] = web_search(
                f"2025 年 {dirs or major} 相关岗位 就业前景 招聘要求"
            )

        system, user = build_prompt(stage, payload)
        result = call_llm(system, user)

        # 学习资源：拼成真实搜索链接
        if stage == "resources" and isinstance(result.get("resources"), list):
            for r in result["resources"]:
                r["url"] = resolve_url(r.get("platform", ""), r.get("query", ""))

        return jsonify({"result": result, "mode": "llm"})

    except ValueError as e:
        msg = str(e)
        if msg == "MISSING_API_KEY":
            return jsonify({
                "error": "NO_API_KEY",
                "message": "未配置 LLM_API_KEY，请在 .env 中配置后重启服务。",
            }), 500
        if msg == "UNKNOWN_STAGE":
            return jsonify({"error": "UNKNOWN_STAGE"}), 400
        return jsonify({"error": "LLM_FAILED", "message": msg}), 500
    except Exception as e:
        return jsonify({"error": "LLM_FAILED", "message": str(e)}), 500


# ============================================================
# 5b) 新版接口：知识库 + 本地算法（零 LLM 依赖，产品的主链路）
#     与 Next.js 版的区别：那一版在浏览器本地算，这一版在服务端算。
#     两版共用 data/*.json 与同一套算法（matcher.py / lib/matcher.ts）。
# ============================================================
@app.route("/api/plan", methods=["POST"])
def plan():
    try:
        body = request.get_json(force=True, silent=True) or {}
        stage = body.get("stage")
        profile = body.get("profile") or {}
        if not stage:
            return jsonify({"error": "stage 为必填"}), 400

        if stage == "knowledge":
            return jsonify({
                "skills": matcher.all_skills(),
                "tracks": matcher.all_tracks(),
                "mode": "local",
            })

        if stage == "detect":
            return jsonify({"skillIds": matcher.detect_skills(matcher.profile_text(profile))})

        if stage == "analyze":
            matches = matcher.rank_jobs(profile, 20)
            # 按方向聚合平均覆盖率
            agg = {}
            for m in matches:
                a = agg.setdefault(m["track"], {"name": m["trackName"], "sum": 0, "n": 0, "best": m})
                a["sum"] += m["coverage"]
                a["n"] += 1
                if m["coverage"] > a["best"]["coverage"]:
                    a["best"] = m
            by_track = sorted(
                [{"track": k, "name": v["name"], "avg": round(v["sum"] / v["n"]), "best": v["best"]}
                 for k, v in agg.items()],
                key=lambda x: -x["avg"],
            )
            return jsonify({"matches": matches[:8], "byTrack": by_track, "mode": "local"})

        if stage == "gap":
            job_id = body.get("jobId")
            compare = body.get("compare") or []
            return jsonify({
                "match": matcher.match_job(profile, job_id),
                "gapMap": matcher.build_gap_map(profile, compare),
                "mode": "local",
            })

        if stage == "path":
            job_id = body.get("jobId")
            path = matcher.build_path(profile, job_id)
            # 拼成真实可点的搜索链接，避免写死 URL 腐烂成 404
            for item in path:
                for r in item.get("resources", []):
                    r["url"] = resolve_url(r.get("platform", ""), r.get("query", ""))
            return jsonify({
                "match": matcher.match_job(profile, job_id),
                "path": path,
                "mode": "local",
            })

        return jsonify({"error": "UNKNOWN_STAGE"}), 400
    except ValueError as e:
        if str(e) == "UNKNOWN_JOB":
            return jsonify({"error": "UNKNOWN_JOB"}), 400
        raise
    except Exception as e:
        return jsonify({"error": "PLAN_FAILED", "message": str(e)}), 500


# ============================================================
# 6) 托管前端首页
# ============================================================
@app.route("/")
def index():
    return send_from_directory(BASE_DIR, "index.html")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
