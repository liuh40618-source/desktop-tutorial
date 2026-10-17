# 职途 · 参赛说明

> 把你的技能，和岗位要求对齐。**每个数字都能拆开看。**

> 赛事口径依据选手收到的参赛通知：第二届“新致杯”人工智能创新大赛。预选赛作品提交截止为 10 月 23 日 24:00。
> 通知未提供的赛道与评分细则不作推断。参赛说明页见 [`/competition`](../app/competition/page.tsx)。

---

## 一句话开场

> **“把经历变成能力线索，再用一项可验收的实践开始验证职业方向。”**

职途是面向大学生 / 应届生的**可解释职业技能匹配工具**。
不是"问 AI 我适合干什么"的聊天框——它内置了一份**可解释的岗位 × 技能知识库**，
用你的技能画像逐条比对，算出覆盖率、缺口、补齐周期和学习顺序。

**核心定位：** 面向教育场景中的大学生职业探索，以规则匹配和用户确认帮助整理能力线索、查看缺口并开始实践。当前模板的代表性与实际使用效果尚未验证。

## 60 秒走完三个章节

| 01 看见经历 | 02 比较选择 | 03 动手验证 |
| --- | --- | --- |
| 写一段做过的课程 / 社团 / 项目 / 实习 | 从有技能交集的模板里给出至多 3 个不同方向 | 先做一件有交付物与验收标准的事 |
| 核对原话关键词与候选能力，逐条确认并自评证据 | 看已有起点与缺口，选定一个目标岗位 | 完成后记录作品位置、个人贡献与体验反馈，再决定继续或换方向；可保存、回看、导出 Markdown |

岗位库（含真实 JD 收藏与识别）与我的记录是辅助入口，不再是主流程的一部分。

> 界面截图尚未纳入版本库，本地运行 `npm run dev` 后可自行截取。
> 复现命令：`npm install && npm run dev` → 打开 **`http://localhost:4000`**（根路径跳转到 `/plan`）→ 点「试一段示例」。

## 架构亮点

| 特性 | 说明 |
|---|---|
| 确定性规则 | 产品主流程不调用 LLM；经历与 JD 按本地规则识别，用户确认后再使用 |
| 可解释算法 | 匹配分 = 覆盖率×75% + 加分项×15% + 方向契合×10%，公式公开 |
| 简历处理 | PDF/DOCX/TXT/MD 在应用服务端内存提取文本，不落盘、不调用模型；运行在远程服务器时文件会发送到该服务器 |
| 数据可控 | 访客资料按签名会话隔离并可在「我的记录」清除；模板数据带结构校验，但校验不等于市场代表性验证 |
| 评审友好 | 每个岗位卡可点开"依据"看到 4 项分项构成 + `reasons` 字符串数组 |

## 数据规模

| 指标 | 数值 | 数据来源 |
| --- | --- | --- |
| 岗位 | 579 | 本地参考模板；逐条招聘来源尚未完整记录 |
| 方向 | 17 | AI / 数据 / 算法 / 前端 / 后端 / 测试 / 产品 / 运营 / 设计 / 安全 / 游戏 / 移动端 / 基础架构 / 市场与销售 / 人力行政客服 / 财务法务合规 / 供应链采购物流 |
| 技能 | 134 | 内容分类扩展至 基础 / 编程 / 前端 / 后端 / 数据 / AI / 设计 / 软技能 / 市场 / 人力 / 财务 / 供应链 / 安全 / 游戏 |
| 数据版本 | `_meta.version` 3.7 | 改 `data/*.json` 后跑 `scripts/data/validate-data.mjs` 升档 |

## 运行说明

```bash
# 环境要求：Node.js ≥ 22.5（需要 node:sqlite 内置模块）
npm install
npm run dev          # → 打开 http://localhost:4000/plan
```

首次启动自动从 `data/*.json` 初始化数据库 `career.db`，之后所有读取走 SQLite。
当前版本依赖 Node 运行时（不能纯静态部署），详见 `docs/LOCAL_DEMO.md` / `README.md`。

主入口是 `/plan`（根路径 `/` 307 跳转过来）。其他路由：`/market` 知识库观察、`/admin` 数据后台。

## 技术栈

- Next.js 16 (App Router) + React 19 + TypeScript 5
- Tailwind CSS v4
- SQLite (Node.js 内置 `node:sqlite`，零数据库依赖)
- unpdf / mammoth（简历解析，本地进程内完成）
- AI Coding 工具：TRAE / WorkBuddy / Codex（OpenAI）。具体用途和人工把关见 [`/competition`](../app/competition/page.tsx)。

## 项目结构

```
data/                       知识库（手工维护、版本化 3.7）
  skills.json               134 项技能：分类、别名、估算时长、学习资源
  jobs.json                 579 个岗位 / 17 个方向：必备技能及权重、加分项、门槛、薪资
lib/
  matcher.ts                匹配 / 差距 / 路径算法 + 方向候选选择（纯函数，零 LLM）
  db.ts                     SQLite 数据层（node:sqlite）+ 服务端校验
  jd.ts                     真实 JD 清洗与规则技能识别（别名边界匹配）
  compilePlan.ts            规划 → Markdown 导出
  types.ts                  共享类型 + 示例画像
  links.ts                  平台搜索链接拼接（防 URL 腐烂）
components/                 15 个当前使用的组件文件
  ExperienceInput / SkillTranslation / CareerChoices / GapView / PathView   主流程三章节
  JobList / MarketBoard / Records / PlanMd / ProfileForm / ResumeImport     辅助视图
app/
  plan/page.tsx             主组件：三章节状态管理 + 持久化 + 视图切换（约 809 行）
  market/page.tsx           知识库观察页（5 张图表）
  api/                      REST API（knowledge / session / profile / data / plans / jds / jds/parse / parse-resume / admin）
  admin/                    数据管理后台（CRUD）+ 登录页
proxy.ts                    后台鉴权（生产环境未配置 ADMIN_TOKEN 时，/admin 页面重定向回 /plan，接口返回 503）
scripts/
  data/validate-data.mjs    数据一致性校验器（id/track/引用/权重/薪资/estHours/平台/meta）
  demo/verify-e2e.mjs          端到端验收（入口 → 开场定位 → 经历 → 岗位库 → 提交页 → 容错）
  demo/verify-resilience.mjs   草稿恢复、示例隔离与保存/删除异常验收
  demo/verify-job-library.mjs  岗位库搜索、筛选与排序验收
  submit/build-submission.mjs  参赛提交包构建器（校验字段与材料 → 产出可发送 zip）
tests/                      纯函数 / 契约 / API 冒烟 / QA 回归 / 提交包测试（17 个文件）
submission/                 参赛提交工作区（配置 + materials/ + templates/）
deploy/                     PM2 + Nginx 配置片段（未公开部署）
docs/
  QUICKSTART.md             快速上手（安装 / 启动 / 三章节操作 / 路由）
  LOCAL_DEMO.md             本地 Demo 与验收说明
  SUBMISSION-GUIDE.md       参赛提交指引（入口 / 字段 / 材料 / 约束 / 确认方式）
  COMPETITION-ITERATION.md  本轮迭代说明与下一阶段验收
  NEWTOUCH.md               参赛说明与评审 Q&A（本文件）
  AI_LOG.md                 AI 开发日志
```

## 评审常见追问（已备好答案）

| 追问 | 应对 |
| --- | --- |
| 数字怎么来的？ | 每个岗位卡可点开"依据"，看到 4 项分项构成 + `reasons` 字符串数组 |
| 数据可靠吗？ | 岗位与技能为本地参考模板；结构校验可检查引用和格式，但不证明市场代表性，逐条来源仍待补齐 |
| 怎么验证？ | `npm run dev` + 点「试一段示例」→ 约 60 秒走完三个章节；也可不填经历，直接完成职业试驾样例任务。 |
| 模型在哪？ | 没有模型。`lib/db.ts` 与 `lib/matcher.ts` 不发起任何网络请求 |
| 怎么扩展？ | 后台 CRUD（`app/admin/`）+ 改 `data/*.json`；改完跑 `node scripts/data/validate-data.mjs` 回归 |

## 已知边界（坦诚写）

- **数据规模与来源有限**：579 岗 / 17 方向 / 134 技能为本地参考模板，会随行业演化而过时；逐条来源记录不完整
- **不评估熟练度 / 项目质量**：覆盖率只看"勾选技能"与"岗位要求"的交集
- **无账号访客模式**：个人记录按签名浏览器会话隔离，不支持跨设备同步；可在「我的记录」清除，数据库仍按单实例 SQLite 运行，正式部署需配置后台口令并评估服务防护
- **方向契合是粗粒度打分**：命中 1.0 / 不命中 0.5，不是精细建模
- **没有 LLM、所以也不会有"AI 惊喜建议"**：勾什么就是什么，避免假数据

## AI Coding 开发过程

项目开发使用 TRAE / WorkBuddy / Codex（OpenAI）。工具具体用途与人工把关见参赛说明页和 [`docs/AI_LOG.md`](docs/AI_LOG.md)。正式提交前请依据个人实际记录确认工具及贡献范围。

核心开发阶段：
1. **需求分析**：AI 辅助梳理职业探索问题与产品边界，明确可解释性为设计目标
2. **架构设计**：AI 辅助拆解为"知识库 + 算法层 + API 层 + UI"四层，保证各层可独立验证
3. **代码实现**：核心算法、API 路由、前端组件由 AI 生成后人工校验修正
4. **测试调试**：AI 辅助定位边界问题（简历编码、数据一致性、版本兼容性）
5. **文档编写**：README 与参赛说明由 AI 辅助润色

## 作者

[参赛者姓名与队伍信息请提交前填写] · 参赛队伍及成员以实际报名信息为准

---

*参赛版本说明 · 2026。按参赛通知：第二届“新致杯”人工智能创新大赛。*
