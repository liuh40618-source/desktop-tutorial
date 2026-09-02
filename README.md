# 职途 · career-navigator

把你的技能，和岗位要求对齐。

不是一个"问 AI 我适合干什么"的聊天框。它内置了一份**可解释的岗位 × 技能知识库**，
用你的技能画像逐条比对，算出覆盖率、缺口、补齐周期和学习顺序。每个数字都能拆开看。

## 核心思路

LLM 擅长生成，但生成职业规划时会编造 JD、编造薪资、编造课程链接，而且过程是黑盒。
这个项目反着来：**结构与数据由本地知识库保证，算法全部可解释，不依赖任何大模型**。

当前 TypeScript 版本**全程零 LLM、零外部 API**——`lib/db.ts` 里没有一个网络请求，
`app/` 与 `lib/` 下也不存在任何调模型的代码。所有数字都由可复核的公式算出。

> 岗位与技能条目**持续扩充**中，以 `data/*.json` 与 `/api/knowledge` 实时返回为准；
> 数量不在文档里写死。当前数据已是手工维护模式（133 岗 / 13 方向 / 109 技能，`_meta.version` 3.0），
> 扩编流程：编辑 `data/*.json` → 跑 `node scripts/validate-data.mjs` 回归 → 版本号升档，
> 详见 `data/*.json` 的 `_meta.note`。

## 五步流程

| 步骤 | 做什么 |
| --- | --- |
| 01 我的画像 | 填背景 + 勾选技能（可**上传简历** PDF/DOCX/TXT/MD 自动识别，或从文字自动预识别——两者都**只预勾选、不静默判定**，用户可逐条改）+ 选方向 + 设每周投入时长 |
| 02 方向定位 | 按各方向聚合平均覆盖率，看自己离哪个领域最近 |
| 03 岗位匹配 | 候选岗位按匹配分排序，附覆盖率、缺口时长、补齐周期、薪资参考，以及**逐条计算依据** |
| 04 技能差距 | 目标岗位的必备技能清单 + 相近岗位横向对比矩阵 |
| 05 学习路径 | 按「权重 ÷ 耗时」排序，配平台搜索链接，可打卡；打卡后缺口与覆盖率实时重算 |

## 算法（公开，可复核）

```
覆盖率   = Σ(已掌握技能的权重) / Σ(岗位必备技能权重)
匹配分   = 覆盖率 × 75% + 加分项覆盖率 × 15% + 方向契合 × 10%
方向契合 = 未勾选方向 → 1.0；勾选且命中 → 1.0；勾选但不命中 → 0.5
补齐周期 = Σ(缺失技能预估时长) / 每周投入时长（默认 10 小时/周）
学习顺序 = 按 权重 ÷ 预估耗时 降序（先补性价比高的）
```

技能权重：3 = 硬门槛（缺了基本过不了初筛）、2 = 重要、1 = 加分。

每个岗位的结果都带一组 `reasons` 字符串，直接说明这个分是怎么来的——
覆盖了几项、命中哪些硬门槛、缺哪几个关键项、加分项有没有、是不是因为方向没勾选被打了折。

预估时长为零基础到能独立完成基本工作的经验估算，**不是精确值**，仅用于排序与节奏参考。

## 简历导入（本地解析，零模型）

第 01 步支持上传 PDF / DOCX / TXT / MD（≤5MB）。服务端 `app/api/parse-resume/` 只做
「提取纯文本」这一件事（unpdf / mammoth，内存中完成、不落盘、不调用任何外部接口），
前端再用 `data/skills.json` 里的别名做关键词识别并**预勾选**，用户逐条确认。

简历文本本身不参与打分、不进数据库——它只是帮你更快勾出技能，避免手动翻简历。

## 数据来源与边界

- 岗位技能要求、门槛、薪资区间：整理自公开招聘平台的常见描述，城市量级参考新一线。
  不同城市/公司/学历差异很大，**请以目标岗位的实际 JD 为准**。数据版本写在 `data/*.json` 的 `_meta.version`。
- 学习资源：只写资源名与平台，链接由 `lib/links.ts` 按「平台 + 关键词」拼成平台搜索链接。
  不写死具体 URL——课程会下架、文档会改版，写死的链接必然腐烂。
- 用户数据写在服务端 SQLite（`career.db`），**浏览器 localStorage 只作为接口异常时的兜底**。
  当前是单用户本地场景（`user_profile` 固定一行 `key='local'`），没有账号体系、没有多端同步。

## 运行

```bash
npm install
npm run dev          # http://localhost:4000
```

**环境要求**：Node 22.5 以上（项目用 Node 内置的 `node:sqlite`，启动脚本带 `--experimental-sqlite`）。

首次启动会读 `data/*.json` 种子化 `career.db`，之后所有读取走数据库。

因为用了 `node:sqlite` 和服务端 API Route（`/api/knowledge`、`/api/plans`、`/api/profile`、`/api/parse-resume`、`/api/admin/...`），
**当前版本不能纯静态部署**，需要一个 Node 运行时。

## 目录

```
data/
  skills.json     技能库：分类、别名（用于文本识别）、预估时长、学习资源（持续扩充）
  jobs.json       岗位库 / 方向库：必备技能及权重、加分项、门槛、薪资区间、发展路径（持续扩充）
lib/
  db.ts           SQLite 数据层：建表、种子化、知识库读取、用户画像与方案持久化
  matcher.ts      匹配 / 差距 / 路径算法（纯函数，前端拿到知识库后本地计算）
  links.ts        平台搜索链接拼接
components/
  ResumeImport.tsx  简历上传 → 解析 → 技能预勾选（第 01 步内嵌）
app/
  page.tsx        五步主流程
  api/knowledge/  返回整库知识库，纯数据、零外部调用
  api/profile/    用户画像读写（SQLite，localStorage 兜底）
  api/plans/      保存的方案列表增删改查
  api/parse-resume/ 简历文本提取（unpdf / mammoth，本地，零模型）
  api/admin/      岗位 / 技能数据后台（CRUD，写 SQLite）
  admin/          配套管理界面
scripts/
  validate-data.mjs 只读一致性校验器：id/track/引用/权重/薪资/estHours/平台白名单/meta 版本，
                    改动 data 后必跑，零错误才算过
  expand-data.mjs   ⚠️ 历史一次性扩编脚本（20→130+，2026-09 已执行），内含硬编码 v2.0 版本号，
                    不要再运行，防版本回退
python-version/   Python 版孪生实现（见下）
demo/             截图与单文件交互演示（demo/index.html 为旧原型期的模拟数据演示，见下）
```

## Python 版

`python-version/` 是同一套产品逻辑的 Flask 孪生实现，**纯本地、零 LLM、零密钥**。
两版共用 `data/*.json`，算法一一对应（`matcher.py` ↔ `lib/matcher.ts`）。
唯一接口 `POST /api/plan`（`knowledge` / `detect` / `analyze` / `gap` / `path`），
与 Next 版 `/api/knowledge` 返回同一份知识库。区别是它**在服务端**计算（Next 版可在浏览器本地），
并自带一个 `index.html` 前端。

```bash
cd python-version
pip install -r requirements.txt   # 只需 flask
python app.py                     # http://localhost:5000
```

详见 `python-version/README.md`。

## 演示 / 截图

- `demo/index.html` —— **旧 LLM 原型期**留下的单文件交互演示：内置模拟假数据（约 9 个岗位，
  非当前 133 岗知识库），打开即可体验五步交互形态，仅作流程示意，不是当前引擎的实时数据
- `demo/preview-landing-v2.png` —— 产品首页（桌面端）
- `demo/preview-admin-final.png` —— 数据后台（桌面端）
- `demo/m-*.png` —— 五步流程的移动端实机截图

## 已知边界

- 知识库是手工整理的，覆盖面有限，且会随时间过时——以 `data/*.json` 实际内容与
  `/api/knowledge` 实时返回为准；扩编 = 改 `data/*.json` + `node scripts/validate-data.mjs` 回归 + 版本升档。
- 覆盖率只看「你勾选的技能」与「岗位要求」的交集，不评估熟练程度，也不看项目经历
  （简历导入也只是辅助勾选，不代表经历被计入评分）。
- 单用户本地场景，没有账号、权限与多端同步。
- 匹配分里的「方向契合」是粗粒度打折（命中 1.0 / 不命中 0.5），不是精细建模。
