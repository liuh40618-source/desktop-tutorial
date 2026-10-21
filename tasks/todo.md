# 职途优化任务清单

> 更新于 2026-09-21。Phase 1 已全部完成，勾选状态与仓库代码核对过。

## Phase 1：产品闭环 —— 已完成

- [x] 1. 抽取 JD 清洗与规则技能识别纯函数
  - 验收：规范化空白、截断长度、去噪；返回唯一技能、证据别名和可读提示。
  - 落地：`lib/jd.ts`
- [x] 2. 实现 `POST /api/jds/parse`
  - 验收：有效正文返回标准 JD；空正文/超长正文/非法 JSON 返回明确 4xx；生成稳定格式 ID。
  - 落地：`app/api/jds/parse/route.ts`
- [x] 3. 完善真实 JD 前端流程
  - 验收：提交中禁用按钮；成功展示识别技能；用户确认后保存；失败保留输入并可重试。
  - 落地：`components/JobList.tsx`
- [x] 4. 保护后台技能删除
  - 验收：技能被岗位 core/plus 引用时返回 409、列出引用岗位且不删除；无引用时删除成功。
  - 落地：`app/api/admin/skills/[id]/route.ts`
- [x] 5. 修复 `estHours=0`
  - 验收：空值/0/负数/NaN 在客户端和服务端都拒绝；正数可保存；编辑已有技能不被意外改为 0。
  - 落地：`lib/db.ts` 的 `validateSkillInput`（服务端）+ `app/admin/page.tsx` 表单校验（客户端）
- [x] 6. 统一数据校验和错误提示
  - 验收：网络失败、非 JSON 响应、未知记录、重复 id、非法技能引用均有中文可行动提示。
- [x] 7. 增加自动化测试
  - 验收：纯函数、API 契约、关键浏览器流程有测试；`npm test` 和 `npm run check` 可执行。
  - 落地：`tests/`（单元 + 契约 14 项、API 冒烟 3 项）、`scripts/demo/verify-*.mjs`
- [x] 8. 增加本地 Demo 与运行说明
  - 验收：README/QUICKSTART 给出本地启动、SQLite 备份、ADMIN_TOKEN、单实例限制和 Demo 验收入口。
  - 落地：`README.md`、`docs/QUICKSTART.md`、`docs/LOCAL_DEMO.md`

## Phase 1 验收门槛 —— 已通过

- [x] `node scripts/data/validate-data.mjs` → PASS（133 岗 / 13 方向 / 109 技能 / 1077 处引用）
- [x] `npm run lint` → 可执行（存在既有 `any` / 未使用变量警告，非 error）
- [x] `npm test` → 14/14 通过
- [x] `npm run test:api` → 3/3 通过（需先启动 dev server）
- [x] `npm run build` → 成功（含 TypeScript 检查）
- [x] Playwright 关键链路：经历入口 → 方向选择 → 行动勾选 → 保存 → 记录

> 注意：原计划里的「一键 Demo → JD 粘贴 → 识别 → 保存 → 差距/路径」链路，
> 随界面对应改为「试一段示例 → 拆开这段经历 → 比较方向 → 生成行动」，JD 流程移到「岗位库」视图内。

## 本轮新增遗留项

- [x] P0 修复根路径 `/` 返回 404 —— 已补 `app/page.tsx` 做 307 重定向到 `/plan`，实测 `/` → 307 → `/plan` 200
- [x] P1 清理死组件 `components/Landing.tsx`、`components/Progress.tsx`，并删除依赖旧流程的录屏脚本
- [x] P1 清理旧截图与旧录屏的失效文档引用；当前工作区仅保留当前界面截图
- [ ] P1 收敛 ESLint 既有警告
- [ ] P2 分批提交当前未提交的改动
- [x] P2 在 README 与本地演示说明中标注 `deploy/` 为未验证的 PM2 / Nginx 配置模板

## Phase 2：可解释 AI 技能识别 —— 未启动

前提未定：当前产品采用「零 LLM」基线；是否接入模型需先评估用户数据处理、可解释性和效果验证要求。

- [ ] 9. 设计 `SkillDetectionResult` 和评测数据格式
- [ ] 10. 实现规则基线评测
- [ ] 11. 接入可替换语义相似度 provider
- [ ] 12. 接入离线文本分类 provider
- [ ] 13. 实现规则 + 语义 + 分类融合
- [ ] 14. 增加证据片段、来源、置信度和用户确认
- [ ] 15. 输出准确率/召回率/F1 对比报告

## Phase 3：个性化推荐 —— 未启动

- [ ] 16. 记录用户行为事件
- [ ] 17. 建立可解释用户偏好画像
- [ ] 18. 个性化岗位排序
- [ ] 19. 学习路径调整
- [ ] 20. 方向推荐与置信度
- [ ] 21. 默认排序 vs 个性化排序评测
