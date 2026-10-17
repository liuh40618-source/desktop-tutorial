# 本地 Demo 与验收说明

当前阶段先保持本地可复现，不配置在线部署。

## 启动

```bash
npm install
npm run dev
```

浏览器打开 <http://localhost:4000>（根路径 307 跳转到 `/plan`）。

环境要求：Node.js >= 22.5.0。项目使用 Node 内置 `node:sqlite`，启动脚本已经带上 `--experimental-sqlite`。

其他路由：`***REMOVED***` ***REMOVED***、`/market` 知识库观察、`/admin` 数据后台。生产环境未设置 `ADMIN_TOKEN` 时管理入口返回 503；本地开发未设置时不加登录锁。

## 60 秒演示路径

1. 首页点击「试一段示例」，再点击「拆开这段经历」。
2. 查看原话、已确认能力与自评证据等级，点击「带着这些能力，看看可能的方向」。
3. 切换候选方向，看理由、已有起点与缺口，展开「选择依据与边界」。
4. 点击「就从这个方向试起」，检查岗位证据，再点击「生成下一步行动」。
5. 查看当前交付物与验收标准，勾选完成，保存并进入「我的记录」。
6. 点击「返回我的经历」，确认原草稿恢复。

## 无经历职业试驾

1. 在 `/plan` 顶部或经历入口点击「职业试驾」。
2. 任选数据分析、前端开发或产品分析样例，填写任务要求的三个交付项。
3. 选择体验意愿并完成任务，展开参考思路，返回档案查看记录或导出 Markdown。
4. 刷新页面后，确认未完成的任务草稿和已完成试驾仍能从当前浏览器会话恢复。

试驾记录和个人规划按 HttpOnly 访客会话保存在 SQLite，并同步保存到当前浏览器的分区缓存；换浏览器或设备不会自动同步。首次建立的新访客会话会承接旧版本单机数据库中的个人记录。访客可从「我的记录」清除画像、试驾答案、规划、JD 与浏览器缓存。

## 真实 JD 对照

在顶部「岗位库」中的「收藏真实 JD」粘贴以下示例：

```text
岗位职责：
负责业务数据分析与报表建设，使用 Python、SQL、Excel 完成数据清洗和可视化。
任职要求：
熟悉关系型数据库，了解 Pandas，具备良好的沟通能力。
```

1. 点击「识别 JD 技能」，检查技能标签和命中证据。
2. 点击「确认识别结果并保存」，确认 JD 出现在「我的 JD」列表。
3. 检查 JD 覆盖率、缺口技能、估算学习时间。

## 第一阶段验收重点

- `/api/jds/parse`：有效文本返回清洗后的 JD、技能 id、命中别名和 `method=rule`。
- 用户必须经过“识别 → 确认”两步，规则命中不会静默写入画像。
- 空正文、超长文本、非法 JSON、未知技能和保存失败均显示可行动的中文提示。
- 后台技能删除有引用保护：被岗位 `core` 或 `plus` 使用的技能返回 409，不会留下悬空引用。
- 后台 `estHours` 必须是大于 0 的有限数字，空值、0、负数和 NaN 都会被拒绝。

## 质量检查

```bash
npm run lint
npm test
npm run test:api   # 先启动 npm run dev，再执行
node scripts/demo/verify-e2e.mjs
node scripts/demo/verify-resilience.mjs
node scripts/demo/verify-job-library.mjs
node scripts/data/validate-data.mjs
npm run build
```

也可以运行：

```bash
npm run check
```

`lint` 当前可能输出已有的 `any`/未使用变量警告，但不应有 error。`build` 如果遇到 `NODE_OPTIONS=--use-system-ca` 导致 Next worker 被 Node 拒绝，请在当前终端临时清除该变量后再执行：

```bash
NODE_OPTIONS= npm run build
```

Windows PowerShell：

```powershell
$env:NODE_OPTIONS = ""
npm run build
```

## 数据与重置

- SQLite 数据库文件：项目根目录 `career.db`。
- 后台地址：<http://localhost:4000/admin>。
- 本地开发可不设置 `ADMIN_TOKEN`；如果局域网或公网暴露服务，必须设置较长随机口令。
- 正式部署建议使用 `deploy/nginx-career.conf` 中的限流配置；应用请求若绕过该 Nginx，限流与请求体限制不会生效。
- 数据库是单实例本地存储，不要启动多个 Next/PM2 实例同时写入。
- 重置为 `data/*.json` 初始数据前，先停止服务并备份 `career.db`、`career.db-wal`、`career.db-shm`，再删除数据库文件并重启。

## 当前边界

经历与 JD 技能识别是规则基线，不是模型推断。每个命中结果都需要人工确认。没有接入大模型，也没有验证职业试选对真实决策的效果；下一阶段验证目标见 `docs/***REMOVED***`。
