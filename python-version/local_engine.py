"""
职途 · 本地规则引擎（无大模型兜底）

设计原则：
1. 只做关键词匹配与模板拼装，不编造用户没有的经历。
2. 每条结论都能追溯到用户输入的原文片段（命中词）。
3. 匹配分是规则计算值，上限 88，不伪装成语义匹配的高精度结果。

⚠️ 与 ../lib/local-engine.ts 是同一份规则库的两个实现，改动时请同步。
"""

import re

RULE_MODE = "rule"

# 岗位方向库：name / keywords / mustHave / niceToHave / tools
DOMAINS = [
    {
        "name": "AI 产品经理（应用方向）",
        "keywords": ["ai", "人工智能", "大模型", "llm", "prompt", "提示词", "agent", "智能体", "aigc", "gpt", "机器学习"],
        "mustHave": [
            "大模型能力与边界认知（知道什么能做、什么做不了）",
            "Prompt 设计与调优",
            "需求拆解与 PRD 撰写",
            "效果评估与数据分析",
        ],
        "niceToHave": ["API 调用与基础工程能力", "用户访谈与需求调研", "A/B 实验设计"],
        "tools": ["ChatGPT / 通义千问", "飞书多维表格", "Figma", "SQL"],
    },
    {
        "name": "数据分析师",
        "keywords": ["数据分析", "数据", "统计", "sql", "excel", "tableau", "power bi", "报表", "指标", "可视化"],
        "mustHave": ["SQL 取数与数据清洗", "Excel / BI 可视化", "业务指标拆解", "统计基础（假设检验、回归）"],
        "niceToHave": ["Python（pandas）", "A/B 实验", "行业业务理解"],
        "tools": ["SQL", "Excel", "Tableau / Power BI", "Python"],
    },
    {
        "name": "数据开发工程师",
        "keywords": ["数据开发", "etl", "数仓", "数据仓库", "hadoop", "spark", "hive", "flink"],
        "mustHave": ["SQL 与数据建模", "ETL 流程设计", "Hadoop / Spark 生态", "Python 或 Scala 编程"],
        "niceToHave": ["实时计算（Flink）", "调度系统（Airflow）", "性能调优"],
        "tools": ["Hive", "Spark", "Flink", "Airflow"],
    },
    {
        "name": "算法工程师",
        "keywords": ["算法", "深度学习", "nlp", "pytorch", "模型", "推荐系统", "神经网络", "计算机视觉"],
        "mustHave": ["机器学习理论与调参", "Python 工程能力", "深度学习框架（PyTorch）", "数学基础（线代、概率）"],
        "niceToHave": ["论文复现能力", "分布式训练", "特征工程"],
        "tools": ["PyTorch", "scikit-learn", "CUDA", "Git"],
    },
    {
        "name": "前端开发工程师",
        "keywords": ["前端", "react", "vue", "typescript", "javascript", "网页", "css", "小程序", "h5"],
        "mustHave": ["HTML / CSS / JS 基础", "React 或 Vue 框架", "TypeScript", "工程化与构建工具"],
        "niceToHave": ["性能优化", "动画与交互细节", "Node.js 服务端基础"],
        "tools": ["VS Code", "React / Vue", "Vite", "Figma"],
    },
    {
        "name": "后端开发工程师",
        "keywords": ["后端", "java", "golang", "服务端", "接口", "spring", "数据库", "微服务", "api"],
        "mustHave": ["一门服务端语言（Java / Go / Python）", "数据库与 SQL", "接口设计与 RESTful", "Linux 与 Git"],
        "niceToHave": ["微服务架构", "缓存与消息队列", "Docker / K8s"],
        "tools": ["Java / Go", "MySQL", "Redis", "Docker"],
    },
    {
        "name": "产品运营 / 内容运营",
        "keywords": ["运营", "内容", "新媒体", "小红书", "抖音", "社群", "增长", "用户运营", "策划"],
        "mustHave": ["内容策划与选题", "数据分析（转化、留存）", "平台规则理解", "用户沟通与反馈处理"],
        "niceToHave": ["短视频剪辑", "活动策划", "投放与 SEO"],
        "tools": ["小红书 / 抖音后台", "飞书", "剪映", "Excel"],
    },
    {
        "name": "产品经理",
        "keywords": ["产品", "需求", "原型", "prd", "用户研究", "b端", "saas", "项目管理"],
        "mustHave": ["需求调研与用户访谈", "PRD 与原型输出", "项目推进与跨部门协作", "数据驱动迭代"],
        "niceToHave": ["行业认知", "商业分析", "基础技术理解"],
        "tools": ["Figma / Axure", "飞书文档", "SQL", "Excel"],
    },
]

PLATFORM_POOL = ["B站", "掘金", "慕课网", "Coursera", "freeCodeCamp", "YouTube", "官方文档"]


def _text_of(bg: dict) -> str:
    parts = [
        bg.get("major", ""),
        bg.get("grade", ""),
        bg.get("works", ""),
        bg.get("certificates", ""),
        bg.get("selfDescription", ""),
        bg.get("interests", ""),
    ]
    return " ".join(p for p in parts if p).lower()


def _clip(s: str, n: int = 40) -> str:
    t = " ".join((s or "").split())
    return t[:n] + "…" if len(t) > n else t


def _score_domains(text: str):
    scored = []
    for d in DOMAINS:
        hits = [k for k in d["keywords"] if k.lower() in text]
        # 基础分 50 + 每个命中词 6 分，上限 88：规则匹配不伪装成高精度语义匹配
        scored.append({"domain": d, "hits": hits, "score": min(88, 50 + len(hits) * 6)})
    scored.sort(key=lambda x: (-x["score"], -len(x["hits"])))
    return scored


def _core(skill: str) -> str:
    """去掉括号补充说明，只留技能主干"""
    return re.sub(r"[（(].*?[)）]", "", skill).strip()


def _mentioned(skill: str, text: str) -> bool:
    """2-gram 交集：宁可漏判（不夸大短板），也不把用户可能具备的能力硬算成缺口"""
    s = _core(skill)
    return any(s[i : i + 2] in text for i in range(max(0, len(s) - 1)))


def _build_strengths(bg: dict, top: dict):
    out = []
    if (bg.get("works") or "").strip():
        out.append(f"有可展示的实践产出：{_clip(bg['works'], 60)}")
    if (bg.get("certificates") or "").strip():
        out.append(f"已取得证书：{_clip(bg['certificates'], 40)}")
    if top["hits"]:
        out.append(f"背景中命中「{top['domain']['name']}」方向关键词：{'、'.join(top['hits'][:4])}")
    if (bg.get("selfDescription") or "").strip():
        out.append(f"自述：{_clip(bg['selfDescription'], 60)}")
    if not out:
        out.append("暂未提取到明确证据，建议补充作品、证书或具体经历后再评估")
    return out[:4]


def _build_gaps(bg: dict, top: dict):
    text = _text_of(bg)
    gaps = []
    for skill in top["domain"]["mustHave"]:
        if not _mentioned(skill, text):
            gaps.append(skill)
    if not gaps:
        return ["当前信息下未发现明显缺口，建议用真实岗位 JD 逐条复核"]
    return gaps[:4]


def locate(bg: dict) -> dict:
    ranked = _score_domains(_text_of(bg))
    top = ranked[0]
    directions = [r["domain"]["name"] for r in ranked[:5]]
    grade = bg.get("grade", "")
    head = f"{bg.get('major') or '未填写专业'}背景（{grade}）" if grade else f"{bg.get('major') or '未填写专业'}背景"
    summary = (
        head
        + f"，规则引擎判断优先方向为「{directions[0]}」，备选「{directions[1]}」。该结论基于关键词匹配，非语义理解。"
    )

    return {
        "strengths": _build_strengths(bg, top),
        "gaps": _build_gaps(bg, top),
        "directions": directions,
        "summary": summary,
    }


def recommend(bg: dict, positioning: dict = None) -> dict:
    positioning = positioning or {}
    # 只喂原始背景 + 用户确认过的优势/缺口，不喂上一步生成的 directions，
    # 否则每个方向都会"自我命中"，排序失去意义。
    confirmed = " ".join(list(positioning.get("strengths") or []) + list(positioning.get("gaps") or []))
    text = (_text_of(bg) + " " + confirmed).lower()
    ranked = _score_domains(text)

    jobs = []
    for r in ranked[:5]:
        evidence = (
            f"命中关键词 {'、'.join(r['hits'][:3])}" if r["hits"] else "无直接关键词命中，按通用背景给出"
        )
        jobs.append(
            {
                "title": r["domain"]["name"],
                "matchReason": f"规则模式：{evidence}；核心要求为{r['domain']['mustHave'][0]}。",
                "matchScore": r["score"],
            }
        )
    return {"jobs": jobs}


def _find_domain(job_title: str):
    t = (job_title or "").lower()
    for d in DOMAINS:
        if t in d["name"].lower() or d["name"].lower() in t:
            return d
    return _score_domains(t)[0]["domain"]


def skills(job_title: str, bg: dict) -> dict:
    domain = _find_domain(job_title)
    text = _text_of(bg)
    tools = []
    for t in domain["tools"]:
        tools.append(f"{t}（你的背景中已提及）" if _mentioned(t, text) else t)
    return {"mustHave": domain["mustHave"], "niceToHave": domain["niceToHave"], "tools": tools}


def resources(job_title: str, goal: str, skills_data: dict) -> dict:
    domain = _find_domain(job_title)
    goal_text = (goal or "").strip()

    pool = []
    if isinstance(skills_data, dict):
        pool += list(skills_data.get("mustHave") or []) or domain["mustHave"]
        pool += list(skills_data.get("tools") or [])
    else:
        pool += domain["mustHave"]

    picked = []
    for s in pool:
        s = _core(str(s)).replace("（你的背景中已提及）", "")
        if s not in picked:
            picked.append(s)
    picked = picked[:5]

    out = []
    for i, skill in enumerate(picked):
        # 搜索词只取技能主干第一段并截断到 10 字：整句塞进 query 会显著降低搜索命中率
        short = re.split(r"[、/｜|]", skill)[0].strip()[:14]
        out.append(
            {
                "title": f"{short} 入门与实战",
                "platform": PLATFORM_POOL[i % len(PLATFORM_POOL)],
                "query": f"{short} 教程",
                "note": (
                    f"对应目标「{_clip(goal_text, 30)}」，补齐「{short}」这一项必备能力。"
                    if goal_text
                    else f"补齐「{short}」，这是「{job_title}」岗位的核心要求之一。"
                ),
                "url": "",
            }
        )
    return {"resources": out}


def run(stage: str, payload: dict) -> dict:
    if stage == "locate":
        return locate(payload or {})
    if stage == "refine_recommend":
        return recommend((payload or {}).get("background") or {}, (payload or {}).get("positioning"))
    if stage == "skills":
        return skills((payload or {}).get("jobTitle", ""), (payload or {}).get("background") or {})
    if stage == "resources":
        return resources(
            (payload or {}).get("jobTitle", ""), (payload or {}).get("goal", ""), (payload or {}).get("skills")
        )
    raise ValueError("UNKNOWN_STAGE")
