# 职途 · Python 版（career-navigator / python-version）

与 Next.js 版**共用同一份数据与算法**的 Flask 孪生实现。

- 数据：`../data/skills.json` + `../data/jobs.json`（与 Next 版完全相同）
- 算法：`matcher.py` ↔ `lib/matcher.ts`（一一对应，改动时请同步）
- 接口：**只有 `POST /api/plan` 一个**，零 LLM、零外部 API、零密钥
- 前端：单个 `index.html`（原生 JS，零构建）

唯一区别：Next 版在**浏览器本地**计算（可与 Node 服务端配合），Python 版在**服务端**计算。

## 跑起来

```bash
cd python-version
pip install -r requirements.txt   # 只需 flask
python app.py                     # http://localhost:5000
```

不需要任何环境变量、不需要任何 API key。

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

`mode` 字段恒为 `"local"`，明示这是本地计算结果（非大模型生成）。

## 目录

- `app.py` —— Flask 后端：唯一接口 `/api/plan` + 托管首页
- `matcher.py` —— 匹配 / 差距 / 路径算法，读 `../data/*.json`
- `index.html` —— 前端：5 步向导，`fetch` 调 `/api/plan`，`localStorage` 存进度与打卡
- `requirements.txt` —— 依赖（仅 `flask`）
