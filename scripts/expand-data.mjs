/**
 * 扩充职途岗位/技能知识库（20 → 130+ 岗位）
 *
 * 用法（在 career-navigator 根目录运行）：
 *   node --experimental-sqlite scripts/expand-data.mjs
 *
 * 行为：
 *  1. 读取现有 data/jobs.json + data/skills.json（保留已校验的 20 个岗位与 55 项技能）。
 *  2. 合并本文件里定义的 NEW_TRACKS / NEW_SKILLS / NEW_JOBS。
 *  3. 严格校验：岗位 track 必须存在、core/plus 的技能 id 必须存在、权重 ∈ {1,2,3}、id 不重复。
 *     任何错误都会打印并退出（不写文件、不污染 DB）。
 *  4. 校验通过 → 写回合并后的 JSON（_meta.version 升到 2.0），并清空+重建 SQLite 里的
 *     jobs/skills/tracks 表（不动 user_profile / user_plans）。
 *
 * 设计说明：数据来自公开招聘平台常见报价的整理，薪资仅作量级参考；权重为人工评定，
 * 用于可解释的覆盖率计算，非精确统计。
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const ROOT = process.cwd();
const jobsPath = path.join(ROOT, "data", "jobs.json");
const skillsPath = path.join(ROOT, "data", "skills.json");
const dbPath = path.join(ROOT, "career.db");

const jobsJson = JSON.parse(fs.readFileSync(jobsPath, "utf-8"));
const skillsJson = JSON.parse(fs.readFileSync(skillsPath, "utf-8"));

// ---------------------------------------------------------------------------
// 新增方向（轨道）
// ---------------------------------------------------------------------------
const NEW_TRACKS = [
  { id: "design", name: "设计" },
  { id: "security", name: "安全" },
  { id: "game", name: "游戏" },
  { id: "mobile", name: "移动端" },
  { id: "infra", name: "基础架构" },
];

// ---------------------------------------------------------------------------
// 新增技能（id 必须唯一，且被下面的岗位引用）
// ---------------------------------------------------------------------------
const NEW_SKILLS = [
  // 设计
  { id: "ui-design", name: "UI 设计", category: "设计", aliases: ["ui", "界面设计", "视觉规范", "画页面"], estHours: 50, resources: [{ title: "iOS 人机界面指南", platform: "官方文档" }, { title: "UI 设计基础", platform: "B站" }] },
  { id: "ux-research", name: "用户研究(UX)", category: "设计", aliases: ["ux", "用户体验", "可用性测试", "访谈", "用研"], estHours: 35, resources: [{ title: "用户体验要素", platform: "知乎" }, { title: "用户研究方法", platform: "B站" }] },
  { id: "interaction-design", name: "交互设计", category: "设计", aliases: ["交互", "ixd", "信息架构", "流程"], estHours: 40, resources: [{ title: "简约至上", platform: "知乎" }, { title: "交互设计实践", platform: "B站" }] },
  { id: "visual-design", name: "视觉设计", category: "设计", aliases: ["视觉", "平面", "配色", "排版", "ps"], estHours: 40, resources: [{ title: "写给大家看的设计书", platform: "知乎" }, { title: "视觉设计实战", platform: "B站" }] },
  { id: "motion-design", name: "动效设计", category: "设计", aliases: ["动效", "动画", "ae", "after effects", "微交互"], estHours: 35, resources: [{ title: "After Effects 教程", platform: "官方文档" }, { title: "动效设计实战", platform: "B站" }] },
  { id: "illustration", name: "插画", category: "设计", aliases: ["插画", "原画", "illustrator", "配图", "绘画"], estHours: 45, resources: [{ title: "Procreate 教程", platform: "B站" }, { title: "插画基础", platform: "知乎" }] },
  { id: "design-system", name: "设计系统", category: "设计", aliases: ["design system", "组件库", "规范", "tokens"], estHours: 30, resources: [{ title: "Material Design 指南", platform: "官方文档" }, { title: "设计系统搭建", platform: "掘金" }] },
  { id: "brand-design", name: "品牌设计", category: "设计", aliases: ["品牌", "vi", "logo", "视觉识别"], estHours: 35, resources: [{ title: "品牌设计方法", platform: "知乎" }, { title: "Logo 设计实战", platform: "B站" }] },
  { id: "game-ui", name: "游戏 UI", category: "设计", aliases: ["游戏界面", "ugui", "hud", "游戏美术界面"], estHours: 30, resources: [{ title: "游戏 UI 设计", platform: "B站" }, { title: "UI 设计基础", platform: "官方文档" }] },
  { id: "accessibility-design", name: "无障碍设计", category: "设计", aliases: ["无障碍", "可访问性", "wcag", "a11y"], estHours: 25, resources: [{ title: "WCAG 标准", platform: "官方文档" }, { title: "无障碍设计实践", platform: "掘金" }] },

  // 安全
  { id: "app-sec", name: "应用安全", category: "安全", aliases: ["appsec", "代码审计", "漏洞", "安全开发", "安全左移"], estHours: 50, resources: [{ title: "OWASP Top 10", platform: "官方文档" }, { title: "应用安全实践", platform: "掘金" }] },
  { id: "pentest", name: "渗透测试", category: "安全", aliases: ["渗透", "红队", "攻防", "exploit", "漏扫"], estHours: 60, resources: [{ title: "Web 安全攻防", platform: "B站" }, { title: "渗透测试实战", platform: "知乎" }] },
  { id: "security-ops", name: "安全运营(SOC)", category: "安全", aliases: ["soc", "应急响应", "ids", "ips", "安全监测"], estHours: 40, resources: [{ title: "SOC 运营实践", platform: "知乎" }, { title: "安全事件响应", platform: "掘金" }] },
  { id: "data-security", name: "数据安全", category: "安全", aliases: ["数据防泄漏", "dlp", "隐私合规", "脱敏", "个保法"], estHours: 40, resources: [{ title: "数据安全治理", platform: "知乎" }, { title: "隐私合规实践", platform: "掘金" }] },
  { id: "cloud-sec", name: "云安全", category: "安全", aliases: ["云安全", "容器安全", "cspm", "基线", "云合规"], estHours: 45, resources: [{ title: "云安全基准", platform: "官方文档" }, { title: "云安全实践", platform: "掘金" }] },
  { id: "crypto-basics", name: "密码学基础", category: "安全", aliases: ["加密", "哈希", "证书", "对称", "非对称"], estHours: 40, resources: [{ title: "图解密码学", platform: "知乎" }, { title: "密码学基础", platform: "B站" }] },
  { id: "network-sec", name: "网络攻防基础", category: "安全", aliases: ["网络", "防火墙", "waf", "ids", "抓包"], estHours: 35, resources: [{ title: "网络安全基础", platform: "B站" }, { title: "WAF 原理", platform: "掘金" }] },

  // 游戏
  { id: "unity", name: "Unity 开发", category: "游戏", aliases: ["unity", "csharp", "c#", "ugui", "mono"], estHours: 80, resources: [{ title: "Unity 官方教程", platform: "官方文档" }, { title: "Unity 实战", platform: "B站" }] },
  { id: "unreal", name: "Unreal 开发", category: "游戏", aliases: ["unreal", "ue", "c++", "蓝图", "ue5"], estHours: 90, resources: [{ title: "Unreal 官方文档", platform: "官方文档" }, { title: "UE 实战", platform: "B站" }] },
  { id: "game-design", name: "游戏策划", category: "游戏", aliases: ["策划", "数值", "系统设计", "玩法", "gamdesign"], estHours: 40, resources: [{ title: "游戏设计艺术", platform: "知乎" }, { title: "游戏策划入门", platform: "B站" }] },
  { id: "level-design", name: "关卡设计", category: "游戏", aliases: ["关卡", "地图", "场景", "关卡策划"], estHours: 35, resources: [{ title: "关卡设计方法", platform: "B站" }, { title: "游戏关卡设计", platform: "知乎" }] },
  { id: "shader", name: "着色器开发", category: "游戏", aliases: ["shader", "渲染", "hlsl", "glsl", "材质"], estHours: 70, resources: [{ title: "Shader 入门", platform: "B站" }, { title: "Unity Shader 实战", platform: "知乎" }] },
  { id: "game-network", name: "游戏服务端", category: "游戏", aliases: ["游戏服务器", "帧同步", "状态同步", "逻辑服", "game server"], estHours: 60, resources: [{ title: "游戏网络同步", platform: "知乎" }, { title: "游戏服务端实战", platform: "B站" }] },

  // 移动端
  { id: "swift", name: "Swift/iOS 开发", category: "移动端", aliases: ["ios", "swift", "objective-c", "swiftui", "苹果"], estHours: 80, resources: [{ title: "Swift 官方文档", platform: "官方文档" }, { title: "iOS 开发实战", platform: "B站" }] },
  { id: "kotlin", name: "Kotlin/Android 开发", category: "移动端", aliases: ["android", "kotlin", "安卓", "jetpack"], estHours: 75, resources: [{ title: "Kotlin 官方文档", platform: "官方文档" }, { title: "Android 开发实战", platform: "B站" }] },
  { id: "flutter", name: "Flutter 开发", category: "移动端", aliases: ["flutter", "dart", "跨端", "跨平台"], estHours: 60, resources: [{ title: "Flutter 官方文档", platform: "官方文档" }, { title: "Flutter 实战", platform: "B站" }] },
  { id: "react-native", name: "React Native 开发", category: "移动端", aliases: ["rn", "react native", "跨端", "跨平台"], estHours: 55, resources: [{ title: "React Native 文档", platform: "官方文档" }, { title: "RN 实战", platform: "B站" }] },
  { id: "mini-program", name: "小程序开发", category: "移动端", aliases: ["小程序", "微信小程序", "支付宝小程序", "wx"], estHours: 35, resources: [{ title: "微信小程序文档", platform: "官方文档" }, { title: "小程序开发实战", platform: "B站" }] },
  { id: "mobile-arch", name: "移动端架构", category: "移动端", aliases: ["移动架构", "组件化", "模块化", "性能"], estHours: 45, resources: [{ title: "移动端架构设计", platform: "掘金" }, { title: "组件化实践", platform: "知乎" }] },

  // 基础架构
  { id: "k8s", name: "Kubernetes", category: "基础架构", aliases: ["k8s", "kubernetes", "容器编排", "helm"], estHours: 50, resources: [{ title: "Kubernetes 官方文档", platform: "官方文档" }, { title: "K8s 实战", platform: "B站" }] },
  { id: "cicd", name: "CI/CD", category: "基础架构", aliases: ["cicd", "jenkins", "gitlab-ci", "流水线", "ci"], estHours: 30, resources: [{ title: "CI/CD 实践", platform: "掘金" }, { title: "Jenkins 实战", platform: "B站" }] },
  { id: "terraform", name: "IaC(Terraform)", category: "基础架构", aliases: ["terraform", "基础设施即代码", "云编排", "iac"], estHours: 35, resources: [{ title: "Terraform 文档", platform: "官方文档" }, { title: "IaC 实践", platform: "掘金" }] },
  { id: "cloud-platform", name: "云平台(阿里云/AWS)", category: "基础架构", aliases: ["云", "aws", "阿里云", "腾讯云", "ec2", "云厂商"], estHours: 40, resources: [{ title: "云厂商官方文档", platform: "官方文档" }, { title: "云架构实践", platform: "慕课网" }] },
  { id: "monitoring", name: "监控与可观测", category: "基础架构", aliases: ["监控", "prometheus", "grafana", "日志", "otel", "可观测"], estHours: 35, resources: [{ title: "Prometheus 文档", platform: "官方文档" }, { title: "可观测性实践", platform: "掘金" }] },
  { id: "sre-basics", name: "SRE 基础", category: "基础架构", aliases: ["sre", "稳定性", "可靠性", "oncall", "容灾"], estHours: 30, resources: [{ title: "SRE 圣经", platform: "知乎" }, { title: "SRE 实践", platform: "掘金" }] },
  { id: "network-basics", name: "网络基础", category: "基础架构", aliases: ["网络", "tcpip", "dns", "http", "tcp"], estHours: 30, resources: [{ title: "计算机网络", platform: "B站" }, { title: "TCP/IP 详解", platform: "知乎" }] },
  { id: "system-design", name: "系统设计", category: "基础架构", aliases: ["架构设计", "高并发", "分布式设计", "cap", "设计方案"], estHours: 60, resources: [{ title: "系统设计面试", platform: "B站" }, { title: "高并发系统设计", platform: "掘金" }] },
  { id: "cpp", name: "C++ 编程", category: "基础架构", aliases: ["c++", "cpp", "stl", "底层"], estHours: 90, resources: [{ title: "C++ Primer", platform: "知乎" }, { title: "C++ 实战", platform: "B站" }] },
  { id: "embedded", name: "嵌入式开发", category: "基础架构", aliases: ["嵌入式", "stm32", "rtos", "固件", "单片机"], estHours: 70, resources: [{ title: "STM32 教程", platform: "B站" }, { title: "嵌入式开发实战", platform: "知乎" }] },

  // 通用/数据/AI/算法
  { id: "data-governance", name: "数据治理", category: "数据", aliases: ["治理", "元数据", "数据资产", "血缘", "数据标准"], estHours: 45, resources: [{ title: "数据治理实践", platform: "掘金" }, { title: "DAMA 数据管理", platform: "知乎" }] },
  { id: "data-quality", name: "数据质量", category: "数据", aliases: ["质量", "校验", "稽核", "数据稽核"], estHours: 30, resources: [{ title: "数据质量方法", platform: "掘金" }, { title: "数据校验实践", platform: "知乎" }] },
  { id: "analytics-eng", name: "分析工程(dbt)", category: "数据", aliases: ["dbt", "语义层", "metrics layer", "指标层"], estHours: 40, resources: [{ title: "dbt 文档", platform: "官方文档" }, { title: "分析工程实践", platform: "掘金" }] },
  { id: "mlops", name: "MLOps", category: "AI", aliases: ["mlops", "模型部署", "推理服务", "流水线", "模型工程"], estHours: 50, resources: [{ title: "MLOps 指南", platform: "官方文档" }, { title: "模型部署实战", platform: "掘金" }] },
  { id: "agent-eval", name: "智能体/模型评测", category: "AI", aliases: ["评测", "对齐", "评估集", "benchmark"], estHours: 35, resources: [{ title: "大模型评测方法", platform: "知乎" }, { title: "评测集构建", platform: "掘金" }] },
  { id: "training-data", name: "训练数据/标注", category: "AI", aliases: ["标注", "数据标注", "语料", "指令", "数据集"], estHours: 30, resources: [{ title: "数据标注规范", platform: "知乎" }, { title: "训练数据构建", platform: "掘金" }] },
  { id: "finance-basics", name: "金融基础", category: "基础", aliases: ["金融", "风控", "量化", "衍生品", "证券"], estHours: 50, resources: [{ title: "金融学基础", platform: "B站" }, { title: "量化交易入门", platform: "知乎" }] },
  { id: "cv-basics", name: "计算机视觉基础", category: "AI", aliases: ["cv", "opencv", "检测", "分割", "图像"], estHours: 50, resources: [{ title: "OpenCV 文档", platform: "官方文档" }, { title: "计算机视觉实战", platform: "B站" }] },
  { id: "blockchain-basics", name: "区块链开发基础", category: "后端", aliases: ["区块链", "solidity", "web3", "合约", "eth"], estHours: 60, resources: [{ title: "Solidity 文档", platform: "官方文档" }, { title: "区块链开发实战", platform: "B站" }] },
  { id: "seo-basics", name: "SEO 基础", category: "运营", aliases: ["seo", "搜索优化", "关键词", "收录"], estHours: 25, resources: [{ title: "SEO 入门", platform: "知乎" }, { title: "搜索引擎优化", platform: "B站" }] },
  { id: "grpc", name: "gRPC/Protobuf", category: "后端", aliases: ["grpc", "protobuf", "rpc", "idl"], estHours: 25, resources: [{ title: "gRPC 文档", platform: "官方文档" }, { title: "gRPC 实战", platform: "掘金" }] },
  { id: "graphql", name: "GraphQL", category: "后端", aliases: ["graphql", "接口", "查询"], estHours: 20, resources: [{ title: "GraphQL 文档", platform: "官方文档" }, { title: "GraphQL 实践", platform: "掘金" }] },
  { id: "elasticsearch", name: "搜索(Elasticsearch)", category: "后端", aliases: ["es", "搜索", "倒排", "索引", "elasticsearch"], estHours: 40, resources: [{ title: "Elasticsearch 文档", platform: "官方文档" }, { title: "ES 实战", platform: "掘金" }] },
  { id: "websocket", name: "实时通信(WebSocket)", category: "后端", aliases: ["websocket", "长连接", "推送", "ws"], estHours: 20, resources: [{ title: "WebSocket 文档", platform: "官方文档" }, { title: "实时通信实战", platform: "B站" }] },
  { id: "code-review", name: "代码评审", category: "软技能", aliases: ["cr", "评审", "code review", "复查"], estHours: 15, resources: [{ title: "代码评审实践", platform: "掘金" }, { title: "如何做 CR", platform: "知乎" }] },
];

// ---------------------------------------------------------------------------
// 新增岗位
// 字段：id, title, track, tier(A/B/C 决定薪资量级), summary,
//       core:[[技能id,权重(1/2/3)]], plus:[技能id], th(门槛), certs:[], gr(发展,可选)
// ---------------------------------------------------------------------------
const NEW_JOBS = [
  // ===== AI =====
  { id: "ai-agent-dev", title: "AI Agent 开发工程师", track: "ai", tier: "A", summary: "构建能调用工具、自主规划的多步 Agent 系统，不是训练模型。", core: [["python", 3], ["agent-dev", 3], ["llm-api", 3], ["rag", 2], ["prompt-eng", 2], ["git", 2]], plus: ["mq", "docker", "llm-theory", "system-design"], th: "要求能独立交付一个可演示的多步 Agent，讲清规划与工具调用设计。", certs: ["无硬性要求，开源作品加分"], gr: "Agent 开发 → AI 平台工程 / 智能体架构" },
  { id: "ai-eval", title: "大模型评测/对齐工程师", track: "ai", tier: "A", summary: "设计评测集、对齐标准与自动化打分，衡量模型能力边界。", core: [["llm-theory", 3], ["prompt-eng", 3], ["model-eval", 3], ["python", 2], ["stats", 2]], plus: ["agent-eval", "rag", "tech-english"], th: "需要严谨的实验设计与数据敏感度，能区分模型真实能力与方法作弊。", certs: ["无硬性要求"], gr: "评测工程师 → 对齐负责人 / 研究岗" },
  { id: "mlops-eng", title: "MLOps 工程师", track: "ai", tier: "A", summary: "把模型训练与推理做成稳定可观测的流水线。", core: [["python", 3], ["docker", 3], ["k8s", 2], ["cicd", 2], ["ml-basics", 2], ["linux", 2]], plus: ["terraform", "monitoring", "dl-framework"], th: "工程能力重于算法，要把训练推理做成稳定可观测的流水线。", certs: ["CKA / 云原生认证（加分）"], gr: "MLOps → 机器学习平台 / 基础架构" },
  { id: "ai-search", title: "AI 搜索/RAG 工程师", track: "ai", tier: "A", summary: "做检索增强的生成式搜索与问答系统。", core: [["rag", 3], ["llm-api", 3], ["python", 2], ["elasticsearch", 2], ["prompt-eng", 2]], plus: ["agent-dev", "system-design"], th: "既要懂检索召回，也要懂生成式问答的排序与可信度。", certs: ["无硬性要求"], gr: "AI 搜索 → 搜索架构 / RAG 平台" },
  { id: "ai-solution", title: "AI 解决方案架构师", track: "ai", tier: "A", summary: "面向客户场景设计可落地的 AI 方案并推动交付。", core: [["llm-theory", 3], ["llm-api", 3], ["system-design", 2], ["prompt-eng", 2], ["business-sense", 2]], plus: ["agent-dev", "rag", "project-mgmt"], th: "偏向客户与方案，需要把业务问题翻译成可落地的 AI 架构。", certs: ["云厂商 AI 认证（加分）"], gr: "解决方案架构 → AI 业务负责人" },
  { id: "training-data", title: "训练数据/标注工程师", track: "ai", tier: "B", summary: "构建与清洗训练/微调语料，制定标注规范。", core: [["llm-theory", 2], ["python", 2], ["data-clean", 2], ["doc-writing", 2], ["structured-expression", 1]], plus: ["training-data", "stats", "rag"], th: "细致与规范意识是关键，能制定可复现的标注标准。", certs: ["无硬性要求"], gr: "数据工程师 → 数据负责人 / 转算法" },

  // ===== 数据 =====
  { id: "data-governance", title: "数据治理工程师", track: "data", tier: "B", summary: "建数据标准、血缘与资产目录，保证数据可信。", core: [["warehouse", 2], ["sql", 3], ["data-quality", 3], ["data-governance", 3], ["python", 2]], plus: ["etl", "db-design", "analytics-eng"], th: "需要既懂技术又懂业务规范，能把数据管得可信可用。", certs: ["DAMA CDMP（加分）"], gr: "数据治理 → 数据架构 / 数据负责人" },
  { id: "etl-dev", title: "ETL 开发工程师", track: "data", tier: "B", summary: "写数据抽取转换任务，保障链路稳定。", core: [["sql", 3], ["etl", 3], ["python", 2], ["warehouse", 2], ["spark", 2]], plus: ["java", "flink", "linux"], th: "工程属性强，看重任务规模与调度稳定性经验。", certs: ["软考（加分）"], gr: "ETL 开发 → 数据开发 / 平台" },
  { id: "analytics-eng", title: "分析工程师", track: "data", tier: "B", summary: "用 dbt 等搭建语义层，让指标可复用。", core: [["sql", 3], ["analytics-eng", 3], ["python", 2], ["data-viz", 2], ["warehouse", 2]], plus: ["bi-tools", "metric-system", "pandas"], th: "用 dbt 等把指标做成可复用资产，比写一次性 SQL 更值钱。", certs: ["无硬性要求"], gr: "分析工程 → 数据平台 / 分析负责人" },
  { id: "data-quality", title: "数据质量工程师", track: "data", tier: "B", summary: "做数据校验、监控与异常告警。", core: [["sql", 3], ["data-quality", 3], ["python", 2], ["testing", 2], ["data-clean", 2]], plus: ["etl", "warehouse", "spark"], th: "细心与工程化并重，要做校验、监控与告警闭环。", certs: ["无硬性要求"], gr: "数据质量 → 数据治理 / 平台" },
  { id: "growth-data", title: "增长数据分析师", track: "data", tier: "B", summary: "围绕拉新留存做实验与归因。", core: [["sql", 3], ["ab-test", 3], ["data-driven", 3], ["growth", 2], ["metric-system", 2]], plus: ["python", "pandas", "stats"], th: "实验思维是分水岭，要能设计可信的归因与放量判断。", certs: ["无硬性要求"], gr: "增长分析 → 增长负责人 / 转产品" },
  { id: "user-analytics", title: "用户行为分析师", track: "data", tier: "B", summary: "用行为数据刻画用户旅程与生命周期。", core: [["sql", 3], ["data-viz", 2], ["user-research", 2], ["metric-system", 2], ["stats", 2]], plus: ["python", "ab-test", "ux-research"], th: "能从行为数据里讲出用户旅程与流失原因。", certs: ["无硬性要求"], gr: "用户分析 → 分析负责人 / 用户研究" },
  { id: "data-product", title: "数据产品经理", track: "data", tier: "B", summary: "定义数据产品与指标体系。", core: [["prd", 3], ["sql", 2], ["metric-system", 3], ["data-driven", 2], ["warehouse", 2]], plus: ["bi-tools", "business-sense", "ab-test"], th: "要懂指标口径与数据链路，否则需求容易被开发挑战。", certs: ["无硬性要求"], gr: "数据产品 → 数据负责人 / 业务负责人" },
  { id: "bi-consultant", title: "BI 实施顾问", track: "data", tier: "B", summary: "帮客户落地看板与数据体系。", core: [["bi-tools", 3], ["sql", 2], ["warehouse", 2], ["data-viz", 2], ["project-mgmt", 2]], plus: ["python", "business-sense", "metric-system"], th: "强沟通与落地能力，能帮客户把看板真正用起来。", certs: ["帆软/Tableau 认证（加分）"], gr: "BI 顾问 → 数据咨询 / 实施负责人" },

  // ===== 算法 =====
  { id: "algo-recsys", title: "推荐算法工程师", track: "algorithm", tier: "A", summary: "做召回排序，优化点击与转化。", core: [["python", 3], ["ml-basics", 3], ["feature-eng", 3], ["stats", 2], ["spark", 2], ["sql", 2]], plus: ["dl-framework", "algo-basic", "elasticsearch"], th: "学历与竞赛权重高，双非靠项目或比赛名次补位。", certs: ["无硬性要求"], gr: "推荐算法 → 资深算法 → 算法负责人" },
  { id: "algo-cv", title: "计算机视觉算法工程师", track: "algorithm", tier: "A", summary: "做检测、分割、识别等视觉任务。", core: [["python", 3], ["dl-framework", 3], ["ml-basics", 3], ["cv-basics", 3], ["algo-basic", 2]], plus: ["feature-eng", "shader"], th: "落地场景多但门槛高，需要扎实的深度学习与工程能力。", certs: ["无硬性要求，论文/竞赛加分"], gr: "CV 算法 → 研究员 / 视觉负责人" },
  { id: "algo-nlp", title: "NLP 算法工程师", track: "algorithm", tier: "A", summary: "做文本理解与生成。", core: [["python", 3], ["ml-basics", 3], ["llm-theory", 2], ["dl-framework", 2], ["stats", 2]], plus: ["rag", "algo-basic", "agent-dev"], th: "大模型时代 NLP 与 LLM 高度重合，要懂微调与对齐。", certs: ["无硬性要求"], gr: "NLP 算法 → LLM 算法 / 研究员" },
  { id: "algo-search", title: "搜索算法工程师", track: "algorithm", tier: "A", summary: "做召回排序与相关性。", core: [["python", 3], ["ml-basics", 3], ["elasticsearch", 2], ["stats", 2], ["feature-eng", 2]], plus: ["algo-basic", "dl-framework", "rag"], th: "召回排序与相关性并重，常考检索与机器学习结合。", certs: ["无硬性要求"], gr: "搜索算法 → 搜索架构 / 负责人" },
  { id: "algo-ads", title: "广告算法工程师", track: "algorithm", tier: "A", summary: "做竞价与出价预估。", core: [["python", 3], ["ml-basics", 3], ["stats", 3], ["feature-eng", 3], ["algo-basic", 2]], plus: ["spark", "dl-framework", "data-driven"], th: "直接对接收入，对预估精度与线上效果要求极高。", certs: ["无硬性要求"], gr: "广告算法 → 资深算法 → 算法负责人" },
  { id: "quant-research", title: "量化研究员", track: "algorithm", tier: "A", summary: "用统计与模型做策略研究。", core: [["python", 3], ["stats", 3], ["algo-basic", 3], ["ml-basics", 2], ["finance-basics", 2]], plus: ["dl-framework", "sql", "cv-basics"], th: "数理与编程双重门槛，学历与竞赛权重极高。", certs: ["无硬性要求，竞赛/学历是关键"], gr: "量化研究 → 基金经理 / 投资负责人" },
  { id: "ml-platform", title: "机器学习平台工程师", track: "algorithm", tier: "A", summary: "搭训练推理平台。", core: [["python", 3], ["docker", 3], ["k8s", 2], ["cicd", 2], ["ml-basics", 2], ["linux", 2]], plus: ["terraform", "monitoring", "mlops"], th: "工程重于算法，要能把训练推理做成自助平台。", certs: ["CKA（加分）"], gr: "ML 平台 → 基础架构 / 平台负责人" },
  { id: "research-intern", title: "算法研究实习生", track: "algorithm", tier: "A", summary: "跟导师做前沿算法研究与实验。", core: [["python", 3], ["ml-basics", 3], ["algo-basic", 3], ["stats", 2], ["dl-framework", 2]], plus: ["llm-theory", "model-eval"], th: "看论文复现与实验能力，导师与学校背景权重高。", certs: ["无硬性要求"], gr: "研究实习 → 算法工程师 / 读博" },

  // ===== 前端 =====
  { id: "react-dev", title: "React 开发工程师", track: "frontend", tier: "B", summary: "专做 React 业务与组件。", core: [["html-css", 3], ["js", 3], ["spa-framework", 3], ["ts", 2], ["fe-build", 2], ["git", 2]], plus: ["node", "data-viz"], th: "作品集重于证书，能讲清实现细节的项目最加分。", certs: ["无硬性要求"], gr: "React 开发 → 前端架构 / 全栈" },
  { id: "vue-dev", title: "Vue 开发工程师", track: "frontend", tier: "B", summary: "专做 Vue 业务。", core: [["html-css", 3], ["js", 3], ["spa-framework", 3], ["ts", 2], ["fe-build", 2], ["git", 2]], plus: ["node", "doc-writing"], th: "国内政企项目多，熟练 Vue 生态更容易上手业务。", certs: ["无硬性要求"], gr: "Vue 开发 → 前端架构 / 全栈" },
  { id: "fe-architect", title: "前端架构师", track: "frontend", tier: "B", summary: "定规范、做工程化与性能。", core: [["spa-framework", 3], ["ts", 3], ["system-design", 2], ["fe-build", 3], ["node", 2], ["git", 2]], plus: ["docker", "microservices", "monitoring"], th: "要定规范、做工程化与性能，对底层原理要求深。", certs: ["无硬性要求"], gr: "前端架构 → 技术专家 / CTO 路线" },
  { id: "fe-perf", title: "前端性能/体验工程师", track: "frontend", tier: "B", summary: "做加载与渲染性能优化。", core: [["html-css", 2], ["js", 3], ["ts", 2], ["system-design", 2], ["data-viz", 1]], plus: ["fe-build", "monitoring"], th: "用数据说话，能定位并消除加载与渲染瓶颈。", certs: ["无硬性要求"], gr: "性能工程师 → 前端架构 / 体验负责人" },
  { id: "ui-engineer", title: "UI 开发工程师", track: "frontend", tier: "B", summary: "把高保真设计还原成流畅界面。", core: [["html-css", 3], ["js", 2], ["spa-framework", 2], ["ts", 2], ["visual-design", 2]], plus: ["motion-design", "design-system", "prototype"], th: "还原度与细节把控是关键，能把设计稿做顺畅。", certs: ["无硬性要求"], gr: "UI 开发 → 前端 / 设计工程" },
  { id: "mini-program-fe", title: "小程序前端", track: "frontend", tier: "B", summary: "做微信/支付宝小程序。", core: [["mini-program", 3], ["html-css", 2], ["js", 2], ["spa-framework", 2], ["ts", 1]], plus: ["node", "react-native"], th: "微信生态需求大，熟小程序生命周期与审核规则很重要。", certs: ["无硬性要求"], gr: "小程序开发 → 前端 / 全栈" },
  { id: "desktop-fe", title: "桌面端开发(Electron)", track: "frontend", tier: "B", summary: "用 Electron 做跨平台桌面应用。", core: [["js", 3], ["spa-framework", 2], ["node", 3], ["html-css", 2], ["ts", 2]], plus: ["fe-build", "git"], th: "跨平台桌面场景，要懂主进程与渲染进程通信。", certs: ["无硬性要求"], gr: "桌面开发 → 客户端架构 / 全栈" },
  { id: "webgl-dev", title: "WebGL/可视化开发", track: "frontend", tier: "B", summary: "做 3D/数据可视化与互动效果。", core: [["js", 3], ["html-css", 2], ["data-viz", 3], ["ts", 2], ["visual-design", 1]], plus: ["shader", "motion-design", "unity"], th: "偏图形与数学，能做炫酷且流畅的可视化。", certs: ["无硬性要求"], gr: "可视化开发 → 图形/前端专家" },
  { id: "fe-test", title: "前端测试开发", track: "frontend", tier: "B", summary: "做前端自动化与端到端测试。", core: [["testing", 3], ["js", 3], ["spa-framework", 2], ["ts", 2], ["git", 2]], plus: ["node", "docker", "doc-writing"], th: "能搭端到端自动化，是质量保障的重要一环。", certs: ["无硬性要求"], gr: "前端测试 → 质量架构 / 转开发" },
  { id: "design-system-fe", title: "设计系统工程师", track: "frontend", tier: "B", summary: "维护组件库与设计规范。", core: [["spa-framework", 3], ["ts", 3], ["design-system", 3], ["html-css", 2], ["git", 2]], plus: ["visual-design", "fe-build", "ui-design"], th: "衔接设计与开发，维护组件库与设计规范。", certs: ["无硬性要求"], gr: "设计系统 → 前端架构 / 设计工程" },
  { id: "accessibility-fe", title: "无障碍前端工程师", track: "frontend", tier: "C", summary: "做可访问性与合规。", core: [["html-css", 3], ["js", 2], ["ts", 2], ["spa-framework", 2], ["accessibility-design", 2]], plus: ["doc-writing", "ux-research"], th: "合规与包容性需求上升，懂标准（WCAG）很加分。", certs: ["无硬性要求"], gr: "无障碍开发 → 前端 / 体验" },
  { id: "lowcode-fe", title: "低代码/搭建开发", track: "frontend", tier: "B", summary: "做内部搭建能力与表单引擎。", core: [["spa-framework", 3], ["ts", 2], ["node", 2], ["system-design", 2], ["html-css", 2]], plus: ["fe-build", "design-system"], th: "做内部搭建能力与表单引擎，提升交付效率。", certs: ["无硬性要求"], gr: "低代码开发 → 平台工程 / 架构" },

  // ===== 后端 =====
  { id: "be-node", title: "Node 后端开发工程师", track: "backend", tier: "B", summary: "用 Node 写轻量服务与 BFF。", core: [["node", 3], ["api-design", 3], ["db-design", 2], ["js", 2], ["git", 2], ["linux", 2]], plus: ["redis", "docker", "ts"], th: "轻量服务与 BFF 场景多，异步与事件循环要清楚。", certs: ["无硬性要求"], gr: "Node 后端 → 全栈 / 架构" },
  { id: "be-cpp", title: "C++ 后端开发工程师", track: "backend", tier: "A", summary: "做高性能底层服务。", core: [["cpp", 3], ["linux", 3], ["db-design", 2], ["system-design", 2], ["git", 2], ["algo-basic", 2]], plus: ["redis", "microservices", "network-basics"], th: "高性能底层服务，内存与并发要求高，门槛也高。", certs: ["无硬性要求"], gr: "C++ 后端 → 底层架构 / 基础架构" },
  { id: "be-architect", title: "后端架构师", track: "backend", tier: "A", summary: "设计高并发分布式系统。", core: [["microservices", 3], ["system-design", 3], ["spring", 3], ["db-design", 3], ["redis", 2], ["mq", 2]], plus: ["k8s", "docker", "testing", "linux"], th: "设计高并发分布式系统，做方案权衡与落地。", certs: ["无硬性要求"], gr: "后端架构 → 技术专家 / CTO" },
  { id: "dba", title: "数据库管理员(DBA)", track: "backend", tier: "B", summary: "管备份、性能与高可用。", core: [["db-design", 3], ["sql", 3], ["redis", 2], ["linux", 2], ["warehouse", 1]], plus: ["docker", "monitoring", "etl"], th: "重备份、性能与高可用，线上事故处理经验值钱。", certs: ["Oracle/MySQL OCP（加分）"], gr: "DBA → 数据库平台 / 架构" },
  { id: "search-be", title: "搜索后端工程师", track: "backend", tier: "A", summary: "做召回与索引服务。", core: [["elasticsearch", 3], ["golang", 2], ["api-design", 2], ["system-design", 2], ["linux", 2]], plus: ["redis", "mq", "grpc"], th: "做召回与索引服务，理解检索与性能调优。", certs: ["无硬性要求"], gr: "搜索后端 → 搜索架构 / 基础架构" },
  { id: "gateway-be", title: "API 网关开发", track: "backend", tier: "A", summary: "做网关与中间件。", core: [["golang", 3], ["microservices", 3], ["api-design", 2], ["redis", 2], ["linux", 2]], plus: ["k8s", "mq", "grpc"], th: "做网关与中间件，重高并发与稳定性。", certs: ["无硬性要求"], gr: "网关开发 → 基础架构 / 中间件专家" },
  { id: "payment-be", title: "支付/交易后端", track: "backend", tier: "A", summary: "做交易链路，重一致性与资金安全。", core: [["java", 3], ["spring", 3], ["db-design", 3], ["redis", 2], ["mq", 2], ["system-design", 2]], plus: ["microservices", "testing", "grpc"], th: "资金安全与一致性是底线，对账与幂等必须扎实。", certs: ["无硬性要求"], gr: "支付后端 → 交易架构 / 金融技术" },
  { id: "im-be", title: "即时通讯后端", track: "backend", tier: "A", summary: "做长连接与消息推送。", core: [["golang", 3], ["websocket", 3], ["redis", 2], ["mq", 2], ["linux", 2], ["system-design", 2]], plus: ["k8s", "docker", "grpc"], th: "长连接与消息推送，重连接管理与海量并发。", certs: ["无硬性要求"], gr: "IM 后端 → 基础架构 / 消息平台" },
  { id: "game-server-be", title: "游戏服务端", track: "backend", tier: "A", summary: "做帧同步/状态同步与逻辑服。", core: [["game-network", 3], ["cpp", 2], ["linux", 3], ["redis", 2], ["db-design", 2]], plus: ["docker", "mq", "network-basics"], th: "帧同步/状态同步与逻辑服，重实时与稳定。", certs: ["无硬性要求"], gr: "游戏服务端 → 游戏技术负责人" },
  { id: "backend-lead", title: "后端技术负责人", track: "backend", tier: "A", summary: "带团队定技术方案。", core: [["microservices", 3], ["system-design", 3], ["java", 3], ["db-design", 2], ["redis", 2], ["mq", 2]], plus: ["k8s", "testing", "spring"], th: "带团队定方案，技术判断与推动力并重。", certs: ["无硬性要求"], gr: "后端负责人 → 技术总监" },
  { id: "blockchain-be", title: "区块链开发", track: "backend", tier: "A", summary: "做合约与链上应用。", core: [["blockchain-basics", 3], ["golang", 2], ["system-design", 2], ["linux", 2], ["api-design", 2]], plus: ["crypto-basics", "testing", "grpc"], th: "合约安全与链上逻辑是核心，安全素养要求高。", certs: ["无硬性要求"], gr: "区块链开发 → 链上架构 / Web3" },
  { id: "be-intern", title: "后端开发实习生", track: "backend", tier: "B", summary: "打杂+学习，重基础与态度。", core: [["spring", 2], ["db-design", 2], ["sql", 2], ["git", 2], ["linux", 1]], plus: ["redis", "api-design", "testing"], th: "打杂+学习，基础扎实与态度好是主要考察点。", certs: ["无硬性要求"], gr: "后端实习 → 后端工程师" },

  // ===== 测试 =====
  { id: "qa-perf", title: "性能测试工程师", track: "qa", tier: "B", summary: "做压测与容量评估。", core: [["testing", 3], ["linux", 2], ["monitoring", 2], ["python", 2], ["system-design", 1]], plus: ["docker", "k8s", "network-basics"], th: "做压测与容量评估，能定位瓶颈与给优化建议。", certs: ["无硬性要求"], gr: "性能测试 → 质量架构 / SRE" },
  { id: "qa-security", title: "安全测试工程师", track: "qa", tier: "A", summary: "做漏洞扫描与渗透验证。", core: [["testing", 3], ["app-sec", 3], ["pentest", 2], ["linux", 2], ["python", 2]], plus: ["network-sec", "crypto-basics", "doc-writing"], th: "懂攻击才能更好测，要会扫漏洞与验证修复。", certs: ["无硬性要求"], gr: "安全测试 → 安全工程 / 渗透" },
  { id: "qa-game", title: "游戏测试", track: "qa", tier: "C", summary: "做功能与数值平衡测试。", core: [["testing", 3], ["game-design", 2], ["structured-expression", 2], ["doc-writing", 2]], plus: ["linux", "community", "level-design"], th: "功能与数值平衡并重，热爱游戏是加分项。", certs: ["无硬性要求"], gr: "游戏测试 → 测试负责人 / 策划" },
  { id: "qa-data", title: "数据测试工程师", track: "qa", tier: "B", summary: "校验数据链路正确性。", core: [["testing", 3], ["sql", 3], ["python", 2], ["data-quality", 2], ["etl", 1]], plus: ["warehouse", "spark", "pandas"], th: "校验数据链路正确性，懂数据比普通测试更稀缺。", certs: ["无硬性要求"], gr: "数据测试 → 数据质量 / 平台" },
  { id: "qa-mobile", title: "移动端测试", track: "qa", tier: "B", summary: "做 App 兼容与自动化。", core: [["testing", 3], ["kotlin", 1], ["swift", 1], ["doc-writing", 2], ["structured-expression", 1]], plus: ["git", "react-native", "node"], th: "做 App 兼容与自动化，设备矩阵与稳定性是重点。", certs: ["无硬性要求"], gr: "移动测试 → 测试架构 / 转开发" },
  { id: "qa-lead", title: "测试架构/负责人", track: "qa", tier: "B", summary: "定测试体系与质量门禁。", core: [["testing", 3], ["system-design", 2], ["python", 2], ["project-mgmt", 2], ["linux", 2]], plus: ["docker", "k8s", "monitoring"], th: "定测试体系与质量门禁，推动左移。", certs: ["无硬性要求"], gr: "测试负责人 → 质量总监" },
  { id: "qa-iot", title: "硬件/嵌入式测试", track: "qa", tier: "C", summary: "做固件与设备测试。", core: [["testing", 3], ["embedded", 1], ["linux", 2], ["doc-writing", 2], ["structured-expression", 1]], plus: ["network-basics", "cpp"], th: "做固件与设备测试，细心与流程意识关键。", certs: ["无硬性要求"], gr: "硬件测试 → 测试负责人 / 转嵌入式" },
  { id: "qa-auto-ui", title: "UI 自动化测试", track: "qa", tier: "B", summary: "做 Web/UI 自动化。", core: [["testing", 3], ["spa-framework", 2], ["js", 2], ["python", 2], ["git", 2]], plus: ["node", "docker", "doc-writing"], th: "做 Web/UI 自动化，框架选型和稳定性是难点。", certs: ["无硬性要求"], gr: "UI 自动化 → 质量架构 / 转开发" },

  // ===== 产品 =====
  { id: "pm-data", title: "数据产品经理", track: "product", tier: "B", summary: "做数据平台与指标体系。", core: [["prd", 3], ["sql", 2], ["metric-system", 3], ["data-driven", 3], ["warehouse", 1]], plus: ["bi-tools", "business-sense", "ab-test"], th: "要懂指标口径，否则容易被开发挑战需求合理性。", certs: ["无硬性要求"], gr: "数据产品 → 数据负责人 / 业务" },
  { id: "pm-growth", title: "增长产品经理", track: "product", tier: "B", summary: "围绕转化做实验。", core: [["prd", 3], ["growth", 3], ["ab-test", 2], ["data-driven", 3], ["user-research", 2]], plus: ["sql", "content-plan", "metric-system"], th: "围绕转化做实验，数据驱动决策是基本功。", certs: ["无硬性要求"], gr: "增长产品 → 增长负责人 / 业务" },
  { id: "pm-strategy", title: "策略/商业分析师", track: "product", tier: "B", summary: "做行业与经营分析。", core: [["prd", 2], ["business-sense", 3], ["data-driven", 3], ["structured-expression", 3], ["stats", 2]], plus: ["sql", "project-mgmt"], th: "行业与经营分析能力强，能影响经营决策。", certs: ["无硬性要求"], gr: "商业分析 → 战略 / 业务负责人" },
  { id: "pm-hardware", title: "硬件产品经理", track: "product", tier: "B", summary: "做软硬件结合产品。", core: [["prd", 3], ["user-research", 3], ["business-sense", 2], ["prototype", 2], ["project-mgmt", 2]], plus: ["tech-english", "structured-expression", "doc-writing"], th: "软硬件结合，要懂供应链与量产约束。", certs: ["无硬性要求"], gr: "硬件产品 → 产品负责人" },
  { id: "pm-game", title: "游戏策划/制作人", track: "product", tier: "B", summary: "设计玩法数值。", core: [["game-design", 3], ["prd", 2], ["data-driven", 2], ["business-sense", 2], ["user-research", 2]], plus: ["level-design", "stats", "community"], th: "设计玩法数值，懂玩家与数据才能做长线。", certs: ["无硬性要求"], gr: "游戏策划 → 制作人 / 主策" },
  { id: "pm-social", title: "社交产品经理", track: "product", tier: "B", summary: "做关系链与互动。", core: [["prd", 3], ["user-research", 3], ["data-driven", 2], ["community", 2], ["growth", 2]], plus: ["sql", "ab-test", "content-plan"], th: "做关系链与互动，懂人性与网络效应。", certs: ["无硬性要求"], gr: "社交产品 → 产品负责人" },
  { id: "pm-intern", title: "产品实习生", track: "product", tier: "C", summary: "打杂+学判断。", core: [["prd", 2], ["user-research", 2], ["data-driven", 2], ["doc-writing", 2], ["structured-expression", 2]], plus: ["prototype", "sql", "project-mgmt"], th: "打杂+学判断，实习与作品集是主要门槛。", certs: ["无硬性要求"], gr: "产品实习 → 产品经理" },
  { id: "pm-international", title: "海外/国际化产品经理", track: "product", tier: "B", summary: "做出海产品设计。", core: [["prd", 3], ["tech-english", 3], ["business-sense", 2], ["user-research", 2], ["data-driven", 2]], plus: ["growth", "content-plan", "project-mgmt"], th: "做出海产品，语言与文化适配能力关键。", certs: ["无硬性要求"], gr: "国际化产品 → 海外业务负责人" },

  // ===== 运营 =====
  { id: "ops-ecom", title: "电商运营", track: "operation", tier: "C", summary: "做店铺与货品运营。", core: [["content-plan", 2], ["data-driven", 3], ["growth", 2], ["business-sense", 2], ["community", 1]], plus: ["short-video", "seo-basics", "doc-writing"], th: "懂货品与流量，能扛 GMV 与转化指标。", certs: ["无硬性要求"], gr: "电商运营 → 运营负责人" },
  { id: "ops-shortvideo", title: "短视频运营", track: "operation", tier: "C", summary: "做账号与流量。", core: [["short-video", 3], ["content-plan", 3], ["data-driven", 2], ["growth", 2], ["doc-writing", 1]], plus: ["community", "seo-basics", "brand-design"], th: "账号与流量说话，能持续产出爆款内容。", certs: ["无硬性要求"], gr: "短视频运营 → 内容负责人" },
  { id: "ops-seo", title: "SEO 优化", track: "operation", tier: "C", summary: "做搜索流量。", core: [["seo-basics", 3], ["content-plan", 2], ["data-driven", 2], ["doc-writing", 2], ["business-sense", 1]], plus: ["growth", "structured-expression", "short-video"], th: "做搜索流量，懂抓取与内容结构。", certs: ["无硬性要求"], gr: "SEO → 流量负责人 / 转增长" },
  { id: "ops-sem", title: "投放/SEM 运营", track: "operation", tier: "B", summary: "管预算与 ROI。", core: [["growth", 3], ["data-driven", 3], ["ab-test", 2], ["business-sense", 2], ["content-plan", 1]], plus: ["sql", "seo-basics", "project-mgmt"], th: "管预算与 ROI，能把投放跑正。", certs: ["无硬性要求"], gr: "投放运营 → 增长负责人" },
  { id: "ops-pr", title: "品牌/公关", track: "operation", tier: "C", summary: "做品牌内容对外沟通。", core: [["doc-writing", 3], ["content-plan", 2], ["structured-expression", 3], ["business-sense", 2], ["community", 1]], plus: ["brand-design", "prototype", "short-video"], th: "对外沟通与危机处理，文字与分寸感关键。", certs: ["无硬性要求"], gr: "品牌公关 → 品牌负责人" },
  { id: "ops-event", title: "活动运营", track: "operation", tier: "C", summary: "策划落地活动。", core: [["project-mgmt", 3], ["content-plan", 2], ["data-driven", 2], ["community", 2], ["doc-writing", 1]], plus: ["growth", "short-video", "seo-basics"], th: "策划落地活动，执行力与细节把控重要。", certs: ["无硬性要求"], gr: "活动运营 → 运营负责人" },
  { id: "ops-cx", title: "用户成功/客服运营", track: "operation", tier: "C", summary: "做客户成功与续费。", core: [["community", 3], ["structured-expression", 2], ["doc-writing", 2], ["data-driven", 1], ["project-mgmt", 1]], plus: ["business-sense", "growth"], th: "做客户成功与续费，沟通与耐心是核心。", certs: ["无硬性要求"], gr: "用户成功 → 客户成功负责人" },
  { id: "ops-bizdev", title: "商务拓展(BD)", track: "operation", tier: "C", summary: "谈合作拉资源。", core: [["business-sense", 3], ["structured-expression", 3], ["project-mgmt", 2], ["doc-writing", 1], ["community", 1]], plus: ["growth", "data-driven"], th: "谈合作拉资源，人脉与谈判能力关键。", certs: ["无硬性要求"], gr: "BD → 商务负责人 / 创业" },
  { id: "ops-lead", title: "运营负责人", track: "operation", tier: "B", summary: "定运营策略带团队。", core: [["data-driven", 3], ["growth", 2], ["project-mgmt", 3], ["content-plan", 2], ["business-sense", 2]], plus: ["sql", "seo-basics", "community"], th: "定运营策略带团队，对整体指标负责。", certs: ["无硬性要求"], gr: "运营负责人 → 业务负责人" },

  // ===== 设计 =====
  { id: "ui-designer", title: "UI 设计师", track: "design", tier: "B", summary: "做界面视觉与规范。", core: [["ui-design", 3], ["visual-design", 3], ["prototype", 2], ["design-system", 2], ["doc-writing", 1]], plus: ["motion-design", "illustration", "brand-design"], th: "作品集决定一切，还原度与审美是门槛。", certs: ["无硬性要求"], gr: "UI 设计 → 资深设计 / 设计负责人" },
  { id: "ux-designer", title: "UX 设计师", track: "design", tier: "B", summary: "做体验研究与交互。", core: [["ux-research", 3], ["interaction-design", 3], ["prototype", 2], ["user-research", 2], ["ui-design", 2]], plus: ["data-driven", "doc-writing", "stats"], th: "用研究驱动体验，能讲清决策依据。", certs: ["无硬性要求"], gr: "UX 设计 → 体验负责人" },
  { id: "product-designer", title: "产品设计师", track: "design", tier: "B", summary: "兼顾体验与视觉。", core: [["ux-research", 3], ["ui-design", 3], ["prototype", 3], ["interaction-design", 2], ["design-system", 2]], plus: ["user-research", "doc-writing", "data-driven"], th: "兼顾体验与视觉，端到端负责设计。", certs: ["无硬性要求"], gr: "产品设计师 → 设计负责人" },
  { id: "visual-designer", title: "视觉设计师", track: "design", tier: "C", summary: "做品牌与营销视觉。", core: [["visual-design", 3], ["illustration", 2], ["motion-design", 2], ["doc-writing", 1], ["brand-design", 2]], plus: ["ui-design", "brand-design"], th: "做品牌与营销视觉，审美与执行力关键。", certs: ["无硬性要求"], gr: "视觉设计 → 资深视觉 / 艺术指导" },
  { id: "interaction-designer", title: "交互设计师", track: "design", tier: "B", summary: "设计信息架构与流程。", core: [["interaction-design", 3], ["ux-research", 2], ["prototype", 3], ["ui-design", 2], ["doc-writing", 1]], plus: ["design-system", "data-driven"], th: "设计信息架构与流程，逻辑清晰是核心。", certs: ["无硬性要求"], gr: "交互设计 → 体验负责人" },
  { id: "motion-designer", title: "动效设计师", track: "design", tier: "C", summary: "做微交互与动效。", core: [["motion-design", 3], ["visual-design", 2], ["ui-design", 2], ["prototype", 1]], plus: ["illustration", "brand-design"], th: "做微交互与动效，细腻与节奏感关键。", certs: ["无硬性要求"], gr: "动效设计 → 资深动效 / 视觉" },
  { id: "design-system-designer", title: "设计系统设计师", track: "design", tier: "B", summary: "维护组件库与规范。", core: [["design-system", 3], ["ui-design", 3], ["prototype", 2], ["visual-design", 2], ["doc-writing", 1]], plus: ["interaction-design", "doc-writing"], th: "维护组件库与规范，设计与开发都懂更吃香。", certs: ["无硬性要求"], gr: "设计系统 → 设计负责人" },
  { id: "game-ui-designer", title: "游戏 UI 设计师", track: "design", tier: "B", summary: "做游戏界面与 HUD。", core: [["game-ui", 3], ["ui-design", 3], ["visual-design", 2], ["illustration", 2], ["motion-design", 1]], plus: ["level-design", "brand-design"], th: "做游戏界面与 HUD，懂游戏语境更顺手。", certs: ["无硬性要求"], gr: "游戏 UI → 游戏美术负责人" },
  { id: "brand-designer", title: "品牌设计师", track: "design", tier: "C", summary: "做 VI 与品牌物料。", core: [["brand-design", 3], ["visual-design", 3], ["illustration", 2], ["doc-writing", 1]], plus: ["motion-design", "ui-design"], th: "做 VI 与品牌物料，概念与一致性关键。", certs: ["无硬性要求"], gr: "品牌设计 → 创意总监" },
  { id: "illustrator", title: "插画师", track: "design", tier: "C", summary: "画插画与配图。", core: [["illustration", 3], ["visual-design", 2], ["motion-design", 1], ["doc-writing", 1]], plus: ["ui-design", "brand-design"], th: "画插画与配图，风格与产出稳定是门槛。", certs: ["无硬性要求"], gr: "插画师 → 资深插画 / 美术指导" },

  // ===== 安全 =====
  { id: "security-engineer", title: "安全工程师", track: "security", tier: "A", summary: "做安全设计与代码审计。", core: [["app-sec", 3], ["linux", 3], ["python", 2], ["network-sec", 2], ["crypto-basics", 2]], plus: ["pentest", "cloud-sec", "system-design"], th: "做安全设计与代码审计，懂攻防才能更好防。", certs: ["CISSP/CISP（加分）"], gr: "安全工程 → 安全负责人 / 架构" },
  { id: "pentester", title: "渗透测试工程师", track: "security", tier: "A", summary: "模拟攻击找漏洞。", core: [["pentest", 3], ["network-sec", 3], ["linux", 3], ["app-sec", 2], ["crypto-basics", 1]], plus: ["security-ops", "cloud-sec", "python"], th: "模拟攻击找漏洞，实战与思路并重。", certs: ["OSCP（加分）"], gr: "渗透测试 → 红队 / 安全专家" },
  { id: "security-ops", title: "安全运营工程师(SOC)", track: "security", tier: "A", summary: "监测与响应安全事件。", core: [["security-ops", 3], ["linux", 2], ["network-sec", 2], ["app-sec", 2], ["monitoring", 1]], plus: ["cloud-sec", "crypto-basics", "k8s"], th: "监测与响应安全事件，冷静与流程意识关键。", certs: ["无硬性要求"], gr: "安全运营 → 安全负责人" },
  { id: "data-security", title: "数据安全工程师", track: "security", tier: "A", summary: "做数据防泄漏与合规。", core: [["data-security", 3], ["sql", 2], ["linux", 2], ["app-sec", 2], ["crypto-basics", 2]], plus: ["db-design", "cloud-sec", "data-governance"], th: "做数据防泄漏与合规，监管趋严需求上升。", certs: ["无硬性要求"], gr: "数据安全 → 安全架构 / 合规" },
  { id: "cloud-security", title: "云安全工程师", track: "security", tier: "A", summary: "做云上安全防护。", core: [["cloud-sec", 3], ["k8s", 2], ["docker", 2], ["linux", 2], ["network-sec", 2]], plus: ["terraform", "monitoring", "cicd"], th: "做云上安全防护，熟悉主流云与容器安全。", certs: ["CCSP（加分）"], gr: "云安全 → 安全架构" },
  { id: "security-analyst", title: "安全分析/合规", track: "security", tier: "B", summary: "做合规与风险评估。", core: [["app-sec", 2], ["data-security", 2], ["crypto-basics", 2], ["doc-writing", 2], ["business-sense", 1]], plus: ["network-sec", "security-ops", "project-mgmt"], th: "做合规与风险评估，文档与沟通能力强。", certs: ["无硬性要求"], gr: "安全分析 → 安全负责人 / 合规" },
  { id: "crypto-engineer", title: "密码/区块链安全", track: "security", tier: "A", summary: "做密码实现与链上安全。", core: [["crypto-basics", 3], ["blockchain-basics", 2], ["app-sec", 2], ["linux", 2], ["python", 2]], plus: ["pentest", "network-sec", "cpp"], th: "做密码实现与链上安全，数学与安全意识并重。", certs: ["无硬性要求"], gr: "密码安全 → 安全专家 / 研究" },
  { id: "security-intern", title: "安全实习生", track: "security", tier: "C", summary: "打杂+学攻防基础。", core: [["linux", 2], ["app-sec", 2], ["network-sec", 2], ["doc-writing", 1], ["python", 1]], plus: ["pentest", "crypto-basics", "security-ops"], th: "打杂+学攻防基础，兴趣与动手欲关键。", certs: ["无硬性要求"], gr: "安全实习 → 安全工程师" },

  // ===== 游戏 =====
  { id: "game-client-unity", title: "Unity 客户端开发", track: "game", tier: "B", summary: "做 Unity 游戏功能与渲染。", core: [["unity", 3], ["game-network", 2], ["shader", 2], ["git", 2], ["ui-design", 1]], plus: ["game-ui", "level-design", "cpp"], th: "做 Unity 游戏功能与渲染，引擎熟练是门槛。", certs: ["无硬性要求"], gr: "Unity 开发 → 客户端主程" },
  { id: "game-client-unreal", title: "Unreal 客户端开发", track: "game", tier: "B", summary: "做 UE 游戏与画质。", core: [["unreal", 3], ["shader", 3], ["game-network", 2], ["cpp", 2], ["git", 2]], plus: ["game-ui", "level-design"], th: "做 UE 游戏与画质，图形与 C++ 功底要求高。", certs: ["无硬性要求"], gr: "UE 开发 → 客户端主程 / 技术美术" },
  { id: "game-designer", title: "游戏策划", track: "game", tier: "B", summary: "设计玩法数值。", core: [["game-design", 3], ["level-design", 2], ["data-driven", 2], ["stats", 2], ["business-sense", 1]], plus: ["user-research", "doc-writing", "community"], th: "设计玩法数值，热爱游戏且懂数据。", certs: ["无硬性要求"], gr: "游戏策划 → 主策 / 制作人" },
  { id: "level-designer", title: "关卡设计师", track: "game", tier: "C", summary: "做关卡与玩法空间。", core: [["level-design", 3], ["game-design", 2], ["visual-design", 1], ["doc-writing", 2], ["ux-research", 1]], plus: ["unity", "prototype", "interaction-design"], th: "做关卡与玩法空间，空间感与创意关键。", certs: ["无硬性要求"], gr: "关卡设计 → 主策 / 设计负责人" },
  { id: "game-art", title: "游戏美术", track: "game", tier: "C", summary: "做原画与美术资源。", core: [["illustration", 3], ["visual-design", 2], ["game-ui", 2], ["motion-design", 1], ["brand-design", 1]], plus: ["shader", "unity"], th: "做原画与美术资源，风格与产出稳定是门槛。", certs: ["无硬性要求"], gr: "游戏美术 → 美术指导" },
  { id: "game-ta", title: "技术美术(TA)", track: "game", tier: "B", summary: "衔接美术与程序。", core: [["shader", 3], ["unity", 2], ["unreal", 2], ["visual-design", 2], ["cpp", 1]], plus: ["game-ui", "motion-design", "level-design"], th: "衔接美术与程序，既懂画面也懂实现。", certs: ["无硬性要求"], gr: "技术美术 → 引擎专家 / 美术负责人" },
  { id: "game-tools", title: "游戏工具开发", track: "game", tier: "B", summary: "做编辑器与流水线工具。", core: [["unity", 2], ["cpp", 2], ["python", 2], ["git", 2], ["system-design", 1]], plus: ["unreal", "shader", "game-design"], th: "做编辑器与流水线工具，提升美术程序效率。", certs: ["无硬性要求"], gr: "工具开发 → 引擎/工具负责人" },
  { id: "game-producer", title: "游戏制作人", track: "game", tier: "B", summary: "把控项目与方向。", core: [["game-design", 3], ["project-mgmt", 3], ["business-sense", 2], ["data-driven", 2], ["user-research", 1]], plus: ["level-design", "doc-writing", "community"], th: "把控项目与方向，统筹策划程序美术。", certs: ["无硬性要求"], gr: "游戏制作人 → 工作室负责人" },

  // ===== 移动端 =====
  { id: "ios-dev", title: "iOS 开发工程师", track: "mobile", tier: "B", summary: "做 iPhone/iPad 应用。", core: [["swift", 3], ["mobile-arch", 2], ["git", 2]], plus: ["mini-program", "react-native", "ui-design"], th: "做 iPhone/iPad 应用，Swift 与生态熟悉是门槛。", certs: ["无硬性要求"], gr: "iOS 开发 → 移动架构 / 客户端负责人" },
  { id: "android-dev", title: "Android 开发工程师", track: "mobile", tier: "B", summary: "做安卓应用。", core: [["kotlin", 3], ["mobile-arch", 2], ["git", 2], ["java", 1]], plus: ["mini-program", "flutter", "ui-design"], th: "国内安卓机型多，兼容与性能调优重要。", certs: ["无硬性要求"], gr: "Android 开发 → 移动架构" },
  { id: "flutter-dev", title: "Flutter 开发", track: "mobile", tier: "B", summary: "跨端一套代码。", core: [["flutter", 3], ["mobile-arch", 2], ["git", 2]], plus: ["swift", "kotlin", "ui-design"], th: "跨端一套代码，UI 一致性与性能平衡。", certs: ["无硬性要求"], gr: "Flutter 开发 → 跨端负责人" },
  { id: "rn-dev", title: "React Native 开发", track: "mobile", tier: "B", summary: "用 RN 跨端。", core: [["react-native", 3], ["js", 3], ["spa-framework", 2], ["ts", 2], ["git", 2]], plus: ["swift", "kotlin", "node"], th: "用 RN 跨端，前端背景转移动很容易上手。", certs: ["无硬性要求"], gr: "RN 开发 → 跨端负责人" },
  { id: "mobile-arch", title: "移动端架构师", track: "mobile", tier: "B", summary: "定移动端架构与规范。", core: [["mobile-arch", 3], ["swift", 2], ["kotlin", 2], ["system-design", 2], ["git", 2]], plus: ["flutter", "mini-program", "react-native"], th: "定移动端架构与规范，组件化与性能。", certs: ["无硬性要求"], gr: "移动架构 → 客户端负责人 / CTO" },
  { id: "mini-program-dev", title: "小程序开发", track: "mobile", tier: "B", summary: "做微信/支付宝小程序。", core: [["mini-program", 3], ["js", 2], ["html-css", 2], ["spa-framework", 2], ["ts", 1]], plus: ["node", "react-native", "ui-design"], th: "微信生态需求大，熟生命周期与审核规则。", certs: ["无硬性要求"], gr: "小程序开发 → 全栈 / 移动负责人" },
  { id: "mobile-test", title: "移动端测试", track: "mobile", tier: "B", summary: "App 兼容与自动化。", core: [["testing", 3], ["kotlin", 1], ["swift", 1], ["doc-writing", 2], ["structured-expression", 1]], plus: ["git", "react-native", "node"], th: "App 兼容与自动化，设备矩阵是重点。", certs: ["无硬性要求"], gr: "移动测试 → 测试架构" },
  { id: "cross-platform-lead", title: "跨端负责人", track: "mobile", tier: "B", summary: "带跨端团队。", core: [["mobile-arch", 3], ["flutter", 2], ["react-native", 2], ["system-design", 2], ["git", 2]], plus: ["swift", "kotlin", "mini-program"], th: "带跨端团队，统一技术选型与体验。", certs: ["无硬性要求"], gr: "跨端负责人 → 客户端总监" },

  // ===== 基础架构 =====
  { id: "devops-eng", title: "DevOps 工程师", track: "infra", tier: "A", summary: "做 CI/CD 与部署。", core: [["docker", 3], ["cicd", 3], ["linux", 3], ["k8s", 2], ["git", 2]], plus: ["terraform", "monitoring", "cloud-platform"], th: "做 CI/CD 与部署，把交付效率提上去。", certs: ["CKA（加分）"], gr: "DevOps → 平台工程 / SRE" },
  { id: "sre-eng", title: "SRE 工程师", track: "infra", tier: "A", summary: "保稳定性与容量。", core: [["sre-basics", 3], ["k8s", 3], ["linux", 3], ["monitoring", 3], ["docker", 2]], plus: ["terraform", "cicd", "network-basics"], th: "保稳定性与容量，SLO 与事故复盘是日常。", certs: ["CKA/SRE 认证（加分）"], gr: "SRE → 基础架构 / 稳定性负责人" },
  { id: "cloud-eng", title: "云工程师", track: "infra", tier: "A", summary: "管云资源与架构。", core: [["cloud-platform", 3], ["terraform", 2], ["k8s", 2], ["linux", 2], ["docker", 2]], plus: ["monitoring", "cicd", "network-basics"], th: "管云资源与架构，成本与合规也要管。", certs: ["云厂商认证（加分）"], gr: "云工程 → 云平台负责人" },
  { id: "k8s-admin", title: "Kubernetes 管理员", track: "infra", tier: "A", summary: "运维 K8s 集群。", core: [["k8s", 3], ["docker", 3], ["linux", 3], ["network-basics", 2], ["monitoring", 2]], plus: ["terraform", "cloud-platform", "cicd"], th: "运维 K8s 集群，排障与升级经验值钱。", certs: ["CKA（加分）"], gr: "K8s 管理员 → 基础架构" },
  { id: "platform-eng", title: "平台工程工程师", track: "infra", tier: "A", summary: "做内部研发平台。", core: [["cicd", 3], ["docker", 3], ["k8s", 2], ["system-design", 2], ["linux", 2]], plus: ["terraform", "monitoring", "cloud-platform"], th: "做内部研发平台，提升团队自助能力。", certs: ["无硬性要求"], gr: "平台工程 → 基础架构负责人" },
  { id: "network-eng", title: "网络工程师", track: "infra", tier: "B", summary: "管网络与连通。", core: [["network-basics", 3], ["linux", 2], ["cloud-platform", 2], ["docker", 1], ["monitoring", 1]], plus: ["k8s", "network-sec"], th: "管网络与连通，排障与规划能力关键。", certs: ["CCNA/CCNP（加分）"], gr: "网络工程 → 基础架构" },
  { id: "observability-eng", title: "可观测性工程师", track: "infra", tier: "A", summary: "建监控日志追踪体系。", core: [["monitoring", 3], ["linux", 2], ["k8s", 2], ["docker", 2], ["python", 1]], plus: ["terraform", "cicd", "network-basics"], th: "建监控日志追踪体系，让问题可被看见。", certs: ["无硬性要求"], gr: "可观测性 → 基础架构 / SRE" },
  { id: "dba-platform", title: "数据库平台工程师", track: "infra", tier: "B", summary: "管数据库平台与高可用。", core: [["db-design", 3], ["sql", 3], ["docker", 2], ["linux", 2], ["redis", 2]], plus: ["k8s", "monitoring", "warehouse"], th: "管数据库平台与高可用，自动化运维是趋势。", certs: ["云数据库认证（加分）"], gr: "数据库平台 → 数据平台负责人" },
];

// ---------------------------------------------------------------------------
// 校验 + 合并 + 写回 + 重新种子化
// ---------------------------------------------------------------------------
const TIERS = {
  A: { intern: "180–320 元/天", junior: "15–30K/月" },
  B: { intern: "130–220 元/天", junior: "10–18K/月" },
  C: { intern: "100–180 元/天", junior: "6–13K/月" },
};

const existingSkillIds = new Set(skillsJson.skills.map((s) => s.id));
const existingTrackIds = new Set(jobsJson.tracks.map((t) => t.id));
const existingJobIds = new Set(jobsJson.jobs.map((j) => j.id));

const skillIds = new Set([...existingSkillIds, ...NEW_SKILLS.map((s) => s.id)]);
const trackIds = new Set([...existingTrackIds, ...NEW_TRACKS.map((t) => t.id)]);

const errors = [];
const seenJobIds = new Set(existingJobIds);

for (const s of NEW_SKILLS) {
  if (existingSkillIds.has(s.id)) errors.push(`技能 id 重复（与已有冲突）: ${s.id}`);
  if (!s.id || !s.name || !s.category) errors.push(`技能字段缺失: ${JSON.stringify(s).slice(0, 60)}`);
}
for (const t of NEW_TRACKS) {
  if (existingTrackIds.has(t.id)) errors.push(`方向 id 重复: ${t.id}`);
}

for (const j of NEW_JOBS) {
  if (seenJobIds.has(j.id)) errors.push(`岗位 id 重复: ${j.id}`);
  seenJobIds.add(j.id);
  if (!trackIds.has(j.track)) errors.push(`岗位 ${j.id} 的 track 不存在: ${j.track}`);
  if (!TIERS[j.tier]) errors.push(`岗位 ${j.id} 的 tier 非法: ${j.tier}`);
  if (!Array.isArray(j.core) || j.core.length === 0) errors.push(`岗位 ${j.id} 缺少 core`);
  for (const [sid, w] of j.core) {
    if (!skillIds.has(sid)) errors.push(`岗位 ${j.id} core 技能不存在: ${sid}`);
    if (![1, 2, 3].includes(w)) errors.push(`岗位 ${j.id} core 权重非法(${sid}): ${w}`);
  }
  for (const sid of j.plus || []) {
    if (!skillIds.has(sid)) errors.push(`岗位 ${j.id} plus 技能不存在: ${sid}`);
  }
}

if (errors.length) {
  console.error(`\n❌ 校验失败，共 ${errors.length} 处错误，未写文件、未动数据库：\n`);
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}

// ---- 合并写回 JSON ----
const mergedTracks = [...jobsJson.tracks, ...NEW_TRACKS];
const mergedSkills = [...skillsJson.skills, ...NEW_SKILLS];
const mergedJobs = [...jobsJson.jobs, ...NEW_JOBS.map((j) => {
  const salary = TIERS[j.tier];
  const growth = j.gr || `${j.title} → 资深${j.title} → 技术/业务负责人`;
  return {
    id: j.id,
    title: j.title,
    track: j.track,
    summary: j.summary,
    core: j.core.map(([s, w]) => ({ s, w })),
    plus: j.plus || [],
    threshold: j.th,
    salary,
    certs: j.certs,
    growth,
  };
})];

jobsJson.tracks = mergedTracks;
jobsJson.jobs = mergedJobs;
jobsJson._meta.version = "2.0";
jobsJson._meta.note = "岗位库 v2：在 v1 的 20 个互联网岗位基础上扩展到 130+ 岗位，新增设计/安全/游戏/移动端/基础架构 5 个方向，技能覆盖同步扩充。core 中 w 为权重：3=硬门槛、2=重要、1=加分。数据来自公开招聘平台常见报价的整理，薪资仅作量级参考，实际以目标 JD 为准。";

skillsJson.skills = mergedSkills;
skillsJson._meta.version = "2.0";

fs.writeFileSync(jobsPath, JSON.stringify(jobsJson, null, 2) + "\n", "utf-8");
fs.writeFileSync(skillsPath, JSON.stringify(skillsJson, null, 2) + "\n", "utf-8");
console.log(`✅ 已写回 JSON：岗位 ${mergedJobs.length} 个，技能 ${mergedSkills.length} 项，方向 ${mergedTracks.length} 个`);

// ---- 重新种子化 SQLite（仅 jobs/skills/tracks，不动 user_profile/user_plans）----
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA foreign_keys = OFF;");
db.exec("DELETE FROM jobs; DELETE FROM skills; DELETE FROM tracks;");

const insertTrack = db.prepare("INSERT OR REPLACE INTO tracks (id, name) VALUES (?, ?)");
for (const t of jobsJson.tracks) insertTrack.run(t.id, t.name);

const insertJob = db.prepare(
  `INSERT OR REPLACE INTO jobs
     (id, title, track, summary, core, plus, threshold, salary_intern, salary_junior, certs, growth)
   VALUES (@id, @title, @track, @summary, @core, @plus, @threshold, @salary_intern, @salary_junior, @certs, @growth)`
);
for (const j of jobsJson.jobs) {
  insertJob.run({
    id: j.id,
    title: j.title,
    track: j.track,
    summary: j.summary ?? "",
    core: JSON.stringify(j.core ?? []),
    plus: JSON.stringify(j.plus ?? []),
    threshold: j.threshold ?? "",
    salary_intern: j.salary?.intern ?? "",
    salary_junior: j.salary?.junior ?? "",
    certs: JSON.stringify(j.certs ?? []),
    growth: j.growth ?? "",
  });
}

const insertSkill = db.prepare(
  `INSERT OR REPLACE INTO skills
     (id, name, category, aliases, estHours, resources)
   VALUES (@id, @name, @category, @aliases, @estHours, @resources)`
);
for (const s of skillsJson.skills) {
  insertSkill.run({
    id: s.id,
    name: s.name,
    category: s.category ?? "",
    aliases: JSON.stringify(s.aliases ?? []),
    estHours: s.estHours ?? 0,
    resources: JSON.stringify(s.resources ?? []),
  });
}

const setMeta = db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)");
setMeta.run("jobs_meta", JSON.stringify(jobsJson._meta ?? {}));
setMeta.run("skills_meta", JSON.stringify(skillsJson._meta ?? {}));
db.close();

console.log(`✅ 已重新种子化 SQLite（career.db）：jobs/skills/tracks 已更新，user 表保留`);
console.log(`\n最终规模：岗位 ${mergedJobs.length} 个 / 技能 ${mergedSkills.length} 项 / 方向 ${mergedTracks.length} 个`);
