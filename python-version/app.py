"""
职途 · Python 后端（Flask 孪生实现）

与 Next.js 版共用 ../data/*.json 与同一套算法（matcher.py ↔ lib/matcher.ts）。
零 LLM、零外部 API、零密钥：只暴露 /api/plan 与首页。
"""
import os
from urllib.parse import quote
from flask import Flask, request, jsonify, send_from_directory

import matcher

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
app = Flask(__name__, static_folder=None)


# ============================================================
# 学习资源链接拼接：把「平台 + 关键词」变成真实可点的搜索链接，
# 避免硬编码具体 URL 导致课程下架/改版后变成 404。
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
    q = quote((query or "").strip())
    tpl = PLATFORM_TEMPLATES.get(platform)
    if tpl:
        return tpl(q)
    return f"https://www.google.com/search?q={quote((platform or '') + ' ' + (query or ''))}"


# ============================================================
# 唯一接口：前端五步流程全走这里。
# 阶段：knowledge / detect / analyze / gap / path。
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
            # 拼成真实可点的搜索链接
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
# 托管前端首页
# ============================================================
@app.route("/")
def index():
    return send_from_directory(BASE_DIR, "index.html")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
