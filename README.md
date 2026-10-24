# 职途 · career-navigator

从做过的事，到值得试的路。

> 面向教育领域的大学生职业探索项目，帮助学生把经历转化为可尝试的职业方向与具体行动。
> 当前版本、产品边界与本地演示步骤见 [`docs/LOCAL_DEMO.md`](docs/LOCAL_DEMO.md)。

## 当前体验：职业试选

学生在这里首先要解决的是方向不清，而不是管理求职指标。可以从经历开始、不填经历先做一项 15 分钟左右的职业试驾任务，也可以从已有岗位或 JD 入手；之后再核对能力、比较方向、补作品证据并决定是否做长期计划。

**入口：`http://localhost:4000`**（根路径 307 跳转到 `/plan`）。主流程实际挂在 `/plan`。

示例体验不会自动覆盖个人草稿，退出示例后恢复个人经历。无账号模式会用 HttpOnly 访客会话隔离不同浏览器的数据；访客记录不会跨设备同步。

## 页面路由

| 路由 | 内容 |
| --- | --- |
| `/` | 307 重定向到 `/plan` |
| `/plan` | 主流程：三章节职业试选（看见经历 / 比较选择 / 动手验证），含无经历门槛的职业试驾任务；内置岗位和确认后的真实 JD 均可生成差距与行动计划 |
| `/market` | 知识库观察：基于本地模板的 5 张图表 |
| `/admin` | 岗位 / 技能数据后台（CRUD，写 SQLite） |
| `/admin/login` | 后台登录页；生产环境需配置 `ADMIN_TOKEN` 才会开放后台 |
| `/api/health` | 服务与 SQLite 就绪探针，不返回用户数据 |

## 界面预览

截图尚未纳入版本库。本地复现方式：

```bash
npm install && npm run dev      # 打开 http://localhost:4000/plan
```

或直接运行自动化验收脚本，它会驱动真实浏览器走完整流程并输出结果：

```bash
node scripts/demo/verify-e2e.mjs           # 端到端：入口 → 开场定位 → 经历 → 岗位库 → 提交页 → 容错
node scripts/demo/verify-resilience.mjs    # 草稿恢复、示例隔离与保存/删除异常
node scripts/demo/verify-job-library.mjs   # 岗位库搜索、筛选、排序与分页
```

验收脚本运行后会在 `demo/` 下输出截图（该目录为脚本产物，不进版本库）。

## 产品定位

> **“从我说我会，到我能展示：把职业目标拆成可解释、可执行、可验收的成长行动。”**

- **围绕证据与行动**：区分自述技能、项目支撑和待补材料，不把关键词出现等同于能力被核验
- **结构与数据由本地知识库保证**——579 岗 × 17 方向 × 134 技能，权重与门槛人工可复核
- **算法全部可解释**——岗位排序使用 O*NET 对齐技能向量的余弦相似度，并输出基于模板标签的信号检测指标；每项都有 `reasons` 字符串
- **当前没有大模型调用**：匹配与识别基于本地规则；主流程不依赖外部图片，学习资源链接跳转外部平台
- **不只是"匹配"**——能从一份真实 JD 算差距、能导出可读规划，能用 SQL 管理后台维护数据

不是一个"问 AI 我适合干什么"的聊天框。它内置了一份**可解释的岗位 × 技能知识库**，
用你的技能画像逐条比对，算出覆盖率、缺口、补齐周期和学习顺序。每个数字都能拆开看。

## 核心思路

职业建议需要可追溯的数据与明确边界。当前版本以**本地岗位模板、公开计算公式和用户确认**构成规则基线；模板与权重仍需通过真实 JD 和用户测试持续校准。

真实 JD 经过本地文本清洗和规则技能识别，返回命中别名证据并由用户确认后保存。ASCII 技能别名按词边界匹配，避免 Java 命中 JavaScript、SQL 命中 NoSQL；否定、学习中和经验有限等邻近表述会提示人工核对。该提示基于规则启发式，不能替代上下文判断。当前不调用模型；未来若接入语义识别，需独立评测并提供关闭、降级与数据发送提示。

> 数据规模：579 岗 / 17 方向 / 134 技能（`_meta.version` 3.7）。
> 扩编流程：编辑 `data/*.json` → 跑 `node scripts/data/validate-data.mjs` 回归 → 版本号升档，
> 详见 `data/*.json` 的 `_meta.note`。

## 三个章节

| 章节 | 做什么 |
| --- | --- |
| 01 看见经历 | 直接写一段做过的事，核对关键词与候选能力，自评证据等级；详细资料内可导入简历、补技能、选意向与每周时间 |
| 02 比较选择 | 从有技能交集的模板中选不同方向：沿用已有能力、回应其他意向（若存在）、换个方向看看；解释理由与缺口，再检查目标岗位证据 |
| 03 动手验证 | 先呈现一项含交付物与验收标准的行动；完成后记录作品位置、个人贡献与体验反馈，再决定继续或比较其他方向；复盘可保存、回看与导出 Markdown |

方向候选至多三项，不为凑数重复方向。候选仍来自现有规则排序，不代表兴趣测评；当前行动仍为技能练习，不是经行业验证的职业模拟。全部岗位、真实 JD 对照与方向聚合在「岗位库」。

职业试驾是并列的轻入口：当前提供数据分析、前端交互和产品分析 3 个样例任务。交付参考与自我感受只用于复盘，不构成能力测评；任务需经目标学生试做和相关从业者审阅后再扩大范围。

## 知识库观察

路由 `/market` 展示本地模板分布，不代表实时招聘市场，
把知识库沉淀的 579 岗 × 134 技能转成 5 张可追溯图表：

| 板块 | 展示 | 数据来源 |
| --- | --- | --- |
| ① 岗位方向分布 | 17 个方向各收录多少岗位（水平条形图） | `jobs.track` |
| ② 模板低频技能 | 按核心或加分项引用该技能的岗位占比展示低频技能，不推断市场稀缺性 | `jobs.core + plus` |
| ③ 模板薪资分布 | 模板月薪区间中点的档位分布，不是实时薪酬统计 | `jobs.salary` |
| ④ 核心技能引用 | 被更多模板列为核心要求的技能，字号仅代表库内引用数 | `jobs.core` |
| ⑤ 方向 × 关键技能 | 各方向最看重的 Top 技能（按岗位权重求和） | `jobs.track + core` |

> 全部**纯前端本地理算**（`components/MarketBoard.tsx`），复用同一 `/api/knowledge` 数据源，
> 零 LLM、零外部图表库，SVG/CSS 实现——延续"可解释、零依赖"的产品理念。

## 算法（公开，可复核）

```
技能覆盖 = Σ(用户确认技能的权重) / Σ(岗位必备技能权重)
证据覆盖 = Σ(用户确认且自评证据等级 >= 3 的技能权重) / Σ(岗位必备技能权重)
岗位排序 = cosine(profile_vector, job_vector)
信号检测 = d′（命中率与误报率的 Z 分数差）+ c（判定准则）；模板标签不等于录用结果
行动周期 = Σ(补技能与补作品行动估算时长) / 每周投入时长（默认 10 小时/周）
行动顺序 = 核心权重降序，再按 权重 ÷ 估算耗时 降序
```

技能权重：3 = 模板核心要求、2 = 重要、1 = 一般。模板权重不等同于某家企业的实际初筛规则。证据覆盖仅依据用户自评，不代表材料已被核验。

每个岗位的结果都带一组 `reasons` 字符串，直接说明这个分是怎么来的——
覆盖了几项、命中哪些核心要求、缺哪些关键项、加分项有没有、所选方向是否一致。未勾选方向不会扣方向分。

预估时长为零基础到能独立完成基本工作的经验估算，**不是精确值**，仅用于排序与节奏参考。

## 简历导入（应用服务端解析，零模型）

「核对能力」的详细资料内支持上传 PDF / DOCX / TXT / MD（≤5MB）。文件会发送到当前应用服务端，
由 `app/api/parse-resume/` 使用 unpdf / mammoth 提取纯文本；应用代码不写入数据库或持久文件，也不调用第三方模型。
本机部署时文件留在本机进程处理；远程部署时文件会到达部署服务器。前端再用 `data/skills.json` 里的别名做关键词识别并**预勾选**，用户逐条确认；否定、学习中和经验有限等邻近表达不会自动预勾选，并会在经历核对时提示人工判断。

简历文本本身不参与打分、不进数据库——它只是帮你更快勾出技能，避免手动翻简历。

## 首轮隐私与 GitHub 作品审计

经历和简历提取文字返回浏览器后，会先经过本地正则脱敏；页面提供可编辑的清洗结果和手动隐藏词条。后续技能识别、匹配和保存只使用清洗文本，自动规则覆盖手机号、邮箱、证件号和卡号等常见格式。该规则不等于完整匿名化，提交前仍需检查清洗看板。

行动计划支持公开 GitHub 仓库的轻量审计。服务端只接受严格的 `https://github.com/用户名/仓库名` URL，通过 GitHub 公开 API 读取 commits 和 languages，不 clone 仓库、不读取源码。当前规则为至少 3 个公开 commit 且存在语言统计时，自动写入 `actionEvaluations` 并把对应技能证据等级提到 3；结果标记为自动审计，不能在前端手动覆盖，也不代表人工确认原创度。

## 设计取舍与依据

| 常见问题 | 本项目应对 |
| --- | --- |
| 数字怎么来的？ | 岗位卡可展开余弦相似度、核心命中/漏报、非核心误报与 d′；这些指标不是录用概率 |
| 数据可靠吗？ | 579 岗 / 17 方向 / 134 技能是静态模板；结构校验不代表市场代表性，逐条来源与外部验证仍待补齐 |
| 怎么验证？ | `npm run check`、生产构建、17 个测试文件，以及 `scripts/demo/verify-resilience.mjs` / `verify-job-library.mjs` 覆盖移动端与保存恢复 |
| 模型在哪？ | 没有模型。`lib/db.ts` 与 `lib/matcher.ts` 不发起任何网络请求，UI 与算法全部基于本地知识库 |
| 怎么扩展？ | 后台 CRUD（`app/admin/`）+ `data/*.json` JSON 数据；改完跑 `node scripts/data/validate-data.mjs` 回归 |

## 数据来源与边界

- 岗位技能要求、门槛、薪资区间：本地参考模板，目前没有完整逐条可追溯的采样记录，不能当作真实市场统计。
  不同城市/公司/学历差异很大，**请以目标岗位的实际 JD 为准**。数据版本写在 `data/*.json` 的 `_meta.version`。
- 学习资源：只写资源名与平台，链接由 `lib/links.ts` 按「平台 + 关键词」拼成平台搜索链接。
  不写死具体 URL——课程会下架、文档会改版，写死的链接必然腐烂。
- 草稿同时写入浏览器 localStorage 与服务端 SQLite（默认 `career.db`）；恢复时以服务端副本为准，服务暂时不可用时才回退到当前访客的浏览器缓存。已有有效会话的浏览器可一次性迁移旧缓存；新访客不会自动导入无分区的旧缓存。个人草稿、规划与 JD 按签名访客会话隔离；换浏览器或设备不会自动同步。
- 在「我的记录」可清除当前访客的画像、职业试驾答案、规划、JD 与对应浏览器缓存；清除服务端数据需能连接当前应用服务。

## 运行

当前阶段以本机可复现 Demo 为主。完整验收步骤见 [`docs/LOCAL_DEMO.md`](docs/LOCAL_DEMO.md)，快速上手指南见 [`docs/QUICKSTART.md`](docs/QUICKSTART.md)。

```bash
npm install
npm run dev          # 打开 http://localhost:4000/plan
```

**环境要求**：Node 22.5 以上（项目用 Node 内置的 `node:sqlite`，启动脚本带 `--experimental-sqlite`）。

首次启动会读 `data/*.json` 种子化 `career.db`，之后所有读取走数据库。

**环境变量**：`ADMIN_TOKEN`（后台口令）；Docker Compose 可用 `APP_PORT` 修改主机本地端口。`CAREER_DB_PATH` 可将 SQLite 文件放到持久磁盘，默认位于项目目录。见 `.env.example`。本地开发可留空，此时后台不加锁；公网运行必须设置长随机口令。

**路由**：主流程 `/plan`，知识库观察 `/market`，数据后台 `/admin`。

因为用了 `node:sqlite` 和服务端 API Route（`/api/knowledge`、`/api/session`、`/api/profile`、`/api/data`、`/api/plans`、`/api/jds`、
`/api/jds/parse`、`/api/parse-resume`、`/api/admin/...`），**当前版本不能纯静态部署**，需要一个 Node 运行时。

`deploy/` 下保留了 PM2（`ecosystem.config.cjs`）与 Nginx（`nginx-career.conf`）配置片段，
但尚未公开部署。仓库提供 Docker 单实例自托管配置；SQLite 数据库和备份分别放在独立持久卷，容器重建时不会随镜像一起删除。该配置适合小规模试运行，不能横向扩成多个应用副本。正式开放前仍需设置 `ADMIN_TOKEN`、配置 HTTPS、把备份复制到另一台主机或云盘、演练恢复，并做真实用户验收。Nginx 模板为 JD 与简历解析接口配置了请求频率和请求体限制；只有流量确实经过该 Nginx 时这些限制才生效。

### Docker 单实例部署

需要一台支持 Docker Compose 的 Linux 主机。容器只绑定到主机回环地址，公网流量应经过 Nginx 和 HTTPS；SQLite 使用名为 `career_data` 的持久卷。

```bash
cp .env.example .env
# 编辑 .env，填写长随机 ADMIN_TOKEN
docker compose up --build -d
docker compose ps
```

应用健康检查地址为 `http://127.0.0.1:3000/api/health`。配置 `deploy/nginx-career.conf` 前，需替换域名和证书路径。数据库位置可通过 `CAREER_DB_PATH` 指定；Compose 已将数据库和备份分别放进持久卷。执行下面的命令会在运行中的应用旁生成一致性备份，并做完整性检查：

```bash
docker compose exec -T app node --experimental-sqlite scripts/backup-db.mjs
mkdir -p ./backups
docker compose cp app:/backups/. ./backups/
```

Compose 会在应用健康后立即备份一次，此后每 24 小时生成一份，并在备份卷中保留最近 30 份。手动备份命令也可用于即时快照。备份卷与数据库卷分开，但仍位于同一台主机；需把 `./backups/` 定期复制到另一台主机或云盘。**不要运行 `docker compose down -v`，它会删除访客数据和容器内备份所在的数据卷。** 数据库仍是单实例 SQLite，不支持多容器共享写入。

恢复前先把要恢复的文件放入 Compose 的备份卷，然后停止应用。恢复工具会先检查备份、把当前数据库副本保存在备份卷中，再替换数据库并清理旧 WAL 文件：

```bash
docker compose cp ./backups/career-YYYY-MM-DDTHH-MM-SS.sssZ.db app:/backups/restore.db
docker compose stop app backup
docker compose run --rm --no-deps app node --experimental-sqlite scripts/restore-db.mjs /backups/restore.db
docker compose up -d --wait
```

## 目录

```
data/
  skills.json     技能库：分类、别名（用于文本识别）、预估时长、学习资源（134 项）
  jobs.json       岗位库 / 方向库：必备技能及权重、加分项、门槛、薪资区间、发展路径（579 岗 / 17 方向）
lib/
  db.ts           SQLite 数据层：建表、迁移、种子化、知识库读取、画像与规划持久化
  matcher.ts      匹配 / 差距 / 路径算法 + 方向候选选择（纯函数，前端拿到知识库后本地计算）
  jd.ts           真实 JD 文本清洗与规则技能识别（别名边界匹配，零模型）
  compilePlan.ts  规划记录 → Markdown 导出
  links.ts        平台搜索链接拼接（避免写死 URL 腐烂）
  session.ts      HttpOnly 签名访客会话
  trial-tasks.ts  不依赖经历或模型的入门工作样本
  types.ts        前后端共享类型 + 示例画像 DEMO_PROFILE
components/                 15 个当前使用的组件文件
  OpeningGate.tsx      开场定位：经历类型选择与入口分流
  ExperienceInput.tsx  01 看见经历 · 经历输入与原话线索
  SkillTranslation.tsx 02 核对能力与自评证据（内嵌 ProfileForm：背景 / 技能 / 方向 / 每周时间）
  CareerChoices.tsx    03 比较选择 · 不同方向候选、选择依据与技能组成
  Orientation.tsx      方向契合度分档展示（与开场定位共用同一套阈值）
  DomainBrief.tsx      方向说明书：一句话定位、子方向与入门周期
  GapView.tsx          04 查差距 · 证据缺口 + 相近岗位横向对比
  PathView.tsx         05 动手验证 · 当前交付物、验收标准、行动清单
  JobList.tsx          岗位库视图 · 匹配排序 + 真实 JD 修订、保存与目标计划（30KB）
  MarketBoard.tsx      知识库观察 · 5 张图表（纯 SVG/CSS，零图表库）
  Records.tsx          我的记录 · 列表 / 详情 / 重命名 / 导出
  TrialLab.tsx         职业试驾 · 独立短任务、提交复盘、参考思路与档案导出
  PlanMd.tsx           轻量 markdown 渲染（仅覆盖导出所用语法，被 Records 引用）
  ProfileForm.tsx      背景与技能表单（被 SkillTranslation 引用，内嵌 ResumeImport）
  ResumeImport.tsx     简历上传 → 解析 → 技能预勾选
app/
  page.tsx        根路径：307 重定向到 /plan
  plan/page.tsx   主组件（约 809 行）：三章节状态管理 + 持久化 + 视图切换
  market/page.tsx 知识库观察页
  admin/          岗位 / 技能数据后台（CRUD）与登录页
  layout.tsx      根布局
  globals.css     全局样式
  trial.css       试选界面样式
  api/knowledge/  返回整库知识库，纯数据、零外部调用
  api/health/     服务与 SQLite 就绪探针
  api/session/    初始化无账号访客会话
  api/profile/    当前访客画像读写（SQLite，localStorage 兜底）
  api/data/       当前访客全部数据清除（画像、规划和 JD）
  api/plans/      当前访客已保存规划的增删改查
  api/jds/        当前访客真实 JD 的读写（我的 JD）
  api/jds/parse/  粘贴 JD → 清洗 + 规则技能识别，返回命中别名证据
  api/parse-resume/ 简历文本提取（unpdf / mammoth，进程内完成，零模型）
  api/admin/      岗位 / 技能数据后台 CRUD（含引用保护与 estHours 校验）
proxy.ts          后台鉴权；生产环境未设置 ADMIN_TOKEN 时关闭管理入口并返回 503
deploy/
  ecosystem.config.cjs  PM2 配置片段（单实例）
  nginx-career.conf     Nginx 反向代理片段
tests/                    16 个测试文件（纯函数 / 契约 / API 冒烟 / QA 回归）
  matcher.test.mjs        匹配 / 路径 / 方向候选纯函数测试
  jd.test.mjs             JD 清洗与识别测试
  jd-contract.test.mjs    JD 结果契约测试
  api-smoke.test.mjs      API 冒烟测试（需先启动 dev server）
  qa-*.test.mjs           QA 回归与对抗性用例
scripts/
  data/validate-data.mjs  只读一致性校验器：id/track/引用/权重/薪资/estHours/平台白名单/meta 版本，
                          改动 data 后必跑，零错误才算过
  backup-db.mjs           在线 SQLite 一致性备份与完整性检查
  restore-db.mjs          停服后校验并恢复备份，保留恢复前副本
  demo/verify-e2e.mjs          端到端验收（入口 → 开场定位 → 经历 → 岗位库 → 容错）
  demo/verify-resilience.mjs   草稿恢复、示例隔离与保存/删除异常验收
  demo/verify-job-library.mjs  岗位库搜索、筛选、排序与分页验收（岗位总数从 data/jobs.json 读取，不硬编码）
.env.example      环境变量样例（ADMIN_TOKEN）
Dockerfile        Node 22 单实例生产容器
docker-compose.yml SQLite 持久卷、仅本机端口绑定与健康检查
.dockerignore     排除依赖、本地数据库、密钥与临时文件
docs/
  QUICKSTART.md    快速上手（安装 / 启动 / 三章节操作 / 路由）
  LOCAL_DEMO.md    本地 Demo 与验收说明
```

> 说明：界面截图尚未纳入版本库，因此上文不引用图片路径。`demo/` 为验收脚本的运行产物目录，不进版本库。
> 需要截图时先运行 `npm run dev` 自行截取，或运行 `scripts/demo/verify-resilience.mjs` /
> `scripts/demo/verify-job-library.mjs` 获取流程验收结果与截图。

## 运行时 AI

当前版本不调用大模型；岗位匹配、技能识别和规划计算均基于本地规则与知识库。

## 已知边界（坦诚写）

- **数据规模有限**：579 岗 / 17 方向 / 134 技能为人工整理，会随行业演化而局部过时。
  扩编 = 改 `data/*.json` + `node scripts/data/validate-data.mjs` 回归 + 版本升档。
- **不核验项目质量**：技能覆盖看用户确认的技能；证据覆盖看自评等级，目前不检查作品附件或第三方证明。
  简历导入只是辅助识别；勾选行动完成不自动提升技能或证据等级。
- **无账号访客模式**：按浏览器会话隔离个人记录，不支持跨设备同步；数据库仍是单实例 SQLite。正式部署时需配置 `ADMIN_TOKEN` 并评估服务容量与滥用防护。
- **方向偏好不改技能相似度**：只用于筛选与探索推荐，避免把主观意向混进技能向量。
- **没有 LLM、所以也不会有「AI 给出惊喜建议」**：你勾了什么就是什么；遇到库里没的技能，
  会被存为"自定义记录"且不参与评分，避免假数据。
