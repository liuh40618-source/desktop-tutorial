# R1-1 时效体系「真实抽样」核对记录

> 采集人：engineer（Kou） · 采集日：2026-09-26 · 数据版本：3.3 → 3.4
> 原始观察：`scripts/data/jd-observations.json`（写入 `raw_jd_observations` 表，`source='manual'`）
> 复现命令：`node --experimental-sqlite --experimental-strip-types scripts/data/record-jd-observations.mjs`

本记录回答一个问题：**`sample_size` / `confidence` 这些数字到底是不是「数出来的」。**
方法：对 3 个热门岗位，用公开渠道检索真实 JD（每岗 ≥5 份，来源可追溯），逐条比对模板的 `core`/`plus`，按**真实抽样份数**回填 `sample_size`，`verified_at` 记采集日，`confidence` 由 `lib/confidence.mjs` 机械推导（≥15 high / 5–14 medium / <5 low）。

---

## 一、抽样结论总览

| 岗位 | job_id | 抽样份数 | confidence | 模板改动 |
| --- | --- | --- | --- | --- |
| 数据分析师（业务方向） | `data-analyst` | 6 | medium | `python`：加分项 → **core(重要, w=2)** |
| 前端开发工程师（Web） | `fe-web` | 6 | medium | `api-design`：**补入 plus（加分项）** |
| 产品经理（B 端 / SaaS） | `pm-b` | 6 | medium | `structured-expression`：加分项 → **core(重要, w=2)**；`api-design` 移出加分项 |

> **没有 `high`**：单岗最高 6 份 < 15 份，按写死的定义就是 `medium`。没有为凑 `high` 多算样本数。

---

## 二、逐岗位依据

### 2.1 数据分析师（`data-analyst`）· 抽样 6 份

来源（`jd-observations.json` 逐条可查）：

1. 河南农村商业银行·数据分析师（原始 JD 页）
2. 海尔消费金融·数据分析师（27 届春招实习）XB（原始 JD 页）
3. 海尔消费金融·数据分析师（27 届春招实习）FS（原始 JD 页）
4. 青岛银行·数据分析师（原始 JD 页）
5. 中国移动·2026 校招数据分析师（公开分析文章引用，原文未直接抓取）
6. 字节跳动·2026 届抖音数据分析师（公开分析文章引用，原文未直接抓取）

出现频次（6 份中）：`sql` 6、`python` 5、`data-viz` 5、`bi-tools` 5、`structured-expression` 5、`excel` 3、`stats` 3、`metric-system` 3、`data-clean` 3、`business-sense` 3、`ab-test` 1、`pandas` 1。

**改动：`python` 加分项 → core(w=2)**
- 依据：6 份 JD 中 5 份把 Python（或 R）写在**任职要求**里，而非加分栏——河南农商行「精通 SQL/Python」、青岛银行「精通 SQL/Python/R」、中国移动「能运用 Python 进行数据清洗和分析」、字节抖音「熟练使用 R 或 Python」、海尔 XB「熟悉 Python 或 Matlab 中的至少一种」。
- 反方证据（已权衡）：公开「业务向」备考分析称 Python 属加分项；但那是二手建议，本次以**一手 JD 文本**为准，故升为 core。
- **未改动**（说明）：`bi-tools`（5/6）与已入 core 的 `data-viz`(w=3) 高度重叠（工具层 vs 概念层），为避免「可视化」重复计分，保留在加分项；`ab-test` 在 6 份一手 JD 中仅字节 1 份出现（其余为分析文章称「面试必问」），证据不足以升 core，保留加分项；`business-sense`（软技能）保留加分项。

### 2.2 前端开发工程师（`fe-web`）· 抽样 6 份

来源：京东·Web 前端（原始 JD 页）、天府绛溪实验室·Web 前端(数据平台)（原始 JD 页）、浙江大学 UIUC 联合学院·Web 前端（原始 JD 页）、青岛蓝色地球大数据·Web 前端（原始 JD 页）、中科院信息工程研究所·Web 前端（原始 JD 页）、深圳博互云·前端开发（原始 JD 页）。

出现频次：`html-css` / `js` / `spa-framework` 6、`fe-build` 3、`git` 2、`api-design`(HTTP/RESTful) 2、`mini-program` 2、`ts` 1、`node` 1、`data-viz` 1、`prototype` 1。

**改动：`api-design` 补入 plus**
- 依据：深圳博互云任职要求「熟悉 HTTP 协议」、高校人才网综合前端 JD 任职要求「了解 HTTP 协议及 RESTful API 交互机制」。属中等证据（2/6），故进**加分项**而非 core。
- **未改动**：`ts`(w=2) 仅 1 份显式提及，但现代前端事实标准、且多份 JD 的「ES6+」隐含，保留 core；`fe-build`(w=2)、`git`(w=2) 有 2–3 份支撑，保留 core。

### 2.3 产品经理（`pm-b`）· 抽样 6 份

来源：京东·产品经理(履约数字化)（原始 JD 页）、网易·2027 届校招产品经理（原始 JD 页）、阿里巴巴·2027 届实习生产品经理（原始 JD 页）、MapGIS·产品经理（原始 JD 页）、百度·产品经理(J100820)（原始 JD 页）、北森·2027 届校招软件产品经理（原始 JD 页）。

出现频次：`prd` / `project-mgmt` / `data-driven` / `structured-expression` 6、`user-research` 5、`business-sense` 5、`prototype` 4、`doc-writing` 2、`sql` 1、`api-design` 0。

**改动：**
- `structured-expression` 加分项 → **core(w=2)**：6/6 份 JD 把「沟通表达 / 跨部门协作 / 项目推动」写进任职要求（百度「良好的沟通和协作能力」、北森「良好的沟通能力与协调能力」、阿里「良好的沟通与团队协作能力」、京东「出色的沟通能力和团队协作精神」、网易「沟通表达、跨团队协作及项目推动能力」、MapGIS「良好的沟通协作能力」）。
- `api-design` **移出**加分项：6 份抽样 JD 均未提及接口/API 设计 → 依据「模板有但 JD 普遍不提 → 移出」。
- **未改动**：`sql`（1/6，网易列为加分项）保留；`doc-writing`（2/6，且与已入 core 的 `prd` 重叠）未新增。

---

## 三、抽不到 / 无对应词条的 JD 要求（如实记录，不虚构 id）

以下要求在抽样 JD 中反复出现，但 `skills.json` 无对应 skillId，**本轮不新增技能**（保持 109 技能冻结），留给下一轮评估：

- 数据分析师：**AI 工具辅助数据分析与结果校验**（零点有数、多篇 2026 JD 提及）；**指标体系搭建/口径管理**（已有 `metric-system` 近似）。
- 前端：**性能优化**、**浏览器兼容 / 响应式适配**、**前端安全（XSS/CSRF）**、**jQuery/Bootstrap**（老技术栈，多份 JD 仍要求）。
- 产品经理：**竞品分析**（网易、MapGIS、北森均提及）、**AI 工具/智能体应用**（网易明确写入岗位要求）。

## 四、遗留的语义不一致（本轮未动，建议下一轮处理）

1. **未抽样岗位的 `verified_at` 仍为 `2026-09-20`**：本轮按要求只改 `sample_size`/`confidence`（`verified_at` 仅 3 个抽样岗位改为 2026-09-26）。这 130 个岗位的 `verified_at` 读起来仍像「2026-09-20 复核过」，与「尚未基于真实 JD 抽样」有张力。建议下一轮把未抽样岗位的 `verified_at` 改为模板数据时点（`source_date` = 2026-03）或另设字段。
2. **`skills[].sample_size` 仍是「该技能被列为 core 的岗位数」**：与 `tracks[].sampleSize` 原有问题同源（不是 JD 抽样份数）。本轮 PRD 只点名了 `tracks`，故未动 `skills`（保持 109 技能数据冻结）。如需统一，下一轮按同一口径把未抽样技能的 `sample_size` 归 0 / `low`。
3. **抽样来源的局限**：中国移动、字节跳动两份 JD 因招聘平台反爬未能直接抓取，记录的是公开分析文章中的引用片段（`sourceType='jd-cited'`，`raw_text` 带 `[引用]` 标记）；其余 16 份均为原始 JD 页面。
