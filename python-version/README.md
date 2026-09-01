# 职途 · Python 版（career-navigator / python-version）

用 Python 实现的「岗位知识库 × 技能差距计算」版本。
后端 = Flask 提供知识库与算法接口；前端 = 单个 HTML 文件（原生 JS，零构建）。

**不需要任何密钥**。全部计算基于 `../data/*.json` 里的技能库与岗位库。

## 跑起来

```bash
# 1. 安装依赖（建议先在项目目录建虚拟环境）
pip install -r requirements.txt

# 2. 启动
python app.py

# 3. 浏览器打开 http://localhost:5000
```

## 与 Next.js 版的关系

两版是同一套产品逻辑的两个实现，**共用同一份数据与算法**：

| Next.js 版 | Python 版 | 说明 |
| --- | --- | --- |
| `data/skills.json` | 同文件 | 55 项技能 |
| `data/jobs.json` | 同文件 | 20 个岗位及技能权重 |
| `lib/matcher.ts` | `matcher.py` | 匹配 / 差距 / 路径算法，一一对应 |
| — | `local_engine.py` | 旧版关键词规则兜底，对应 `lib/local-engine.ts` |

唯一区别：Next 版在**浏览器本地**计算（可静态部署），Python 版在**服务端**计算。

## 接口

`POST /api/plan`，body 形如 `{stage, profile, ...}`：

| stage | 入参 | 返回 |
| --- | --- | --- |
| `knowledge` | — | 全量技能库 + 方向列表 |
| `detect` | `profile` | 从自由文本识别出的技能 id |
| `analyze` | `profile` | Top 8 岗位匹配 + 按方向聚合的覆盖率 |
| `gap` | `profile`, `jobId`, `compare[]` | 目标岗位差距 + 多岗位对比矩阵 |
| `path` | `profile`, `jobId` | 按性价比排序的学习路径（含资源链接） |

`profile` 结构：

```json
{
  "major": "数据科学与大数据技术",
  "grade": "大三",
  "works": "...", "certificates": "...", "selfDescription": "...", "interests": "...",
  "knownSkillIds": ["python", "sql"],
  "targetTracks": ["ai", "data"],
  "hoursPerWeek": 12,
  "goal": "三个月内拿到 AI 产品实习"
}
```

另有旧版 `POST /api/career`（4 阶段大模型流程）保留着，配置 `LLM_API_KEY` 后可用，
不配置则自动降级为 `local_engine` 规则兜底。想强制离线：设 `CAREER_MODE=offline`。

## 目录

- `app.py` —— Flask 后端：`/api/plan` 新接口 + `/api/career` 旧接口 + 托管首页
- `matcher.py` —— 匹配 / 差距 / 路径算法，读 `../data/*.json`
- `local_engine.py` —— 旧版关键词规则兜底
- `index.html` —— 前端：5 步向导，`fetch` 调 `/api/plan`，`localStorage` 存进度与打卡
- `requirements.txt` / `.env.example` —— 依赖与配置模板
