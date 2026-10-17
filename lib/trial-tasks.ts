export interface TrialTask {
  id: string;
  role: string;
  category: string;
  minutes: number;
  title: string;
  summary: string;
  context: string;
  materials: { heading: string; content: string }[];
  prompts: { id: string; label: string; hint: string }[];
  checklist: string[];
  reference: string[];
}

/** 不依赖已有经历、模型或外部服务的入门工作样本。 */
export const TRIAL_TASKS: TrialTask[] = [
  {
    id: "analyst-refunds",
    role: "数据分析",
    category: "发现问题 · 用数据支持判断",
    minutes: 15,
    title: "哪类商品的退款率最高？",
    summary: "算出一个比例，再写出谨慎的结论和下一步核查点。",
    context: "一家网店想了解最近三类商品的退款情况。你拿到的是汇总数据，先用它回答一个小问题，不需要任何软件。",
    materials: [
      { heading: "文具", content: "28 笔订单 · 2 笔退款" },
      { heading: "食品", content: "36 笔订单 · 6 笔退款" },
      { heading: "电子产品", content: "18 笔订单 · 4 笔退款" },
    ],
    prompts: [
      { id: "finding", label: "退款率最高的是哪类？写出你的计算过程", hint: "例如：退款笔数 ÷ 订单数 = ……" },
      { id: "interpretation", label: "用一句话描述你看到的现象", hint: "只写数据能支持的结论，先别猜原因" },
      { id: "next-check", label: "你会再核实什么，避免误判？", hint: "例如：退款原因、具体商品或观察时间" },
    ],
    checklist: ["用退款笔数除以订单数计算比例", "指出比例最高的类别并引用数字", "把观察到的现象和推测原因分开", "提出一个具体的后续核查点"],
    reference: [
      "电子产品：4 ÷ 18 ≈ 22.2%；食品：6 ÷ 36 ≈ 16.7%；文具：2 ÷ 28 ≈ 7.1%。",
      "这批汇总数据里，电子产品退款率最高。订单量不大，不能据此断言商品质量有问题。",
      "可以继续按商品型号、退款原因和时间段拆分，确认是否由少数商品或偶发情况造成。",
    ],
  },
  {
    id: "frontend-event-form",
    role: "前端开发",
    category: "设计交互 · 让流程清楚可用",
    minutes: 15,
    title: "把社团报名表的边界情况补齐",
    summary: "不必写代码，先把关键页面状态和反馈写清楚。",
    context: "社团要办一场限 40 人的活动，报名页需要收集姓名、专业和联系方式。活动名额可能报满，也可能有人重复提交；页面主要给手机用户使用。",
    materials: [
      { heading: "目标", content: "让报名者知道是否报名成功，以及接下来要做什么" },
      { heading: "约束", content: "最多 40 人；信息不完整时不能提交；可能重复报名" },
      { heading: "设备", content: "优先考虑窄屏手机，字段和按钮要容易点击" },
    ],
    prompts: [
      { id: "states", label: "写出你会设计的 3 个页面状态", hint: "例如：填写中、提交中、成功 / 失败" },
      { id: "feedback", label: "名额已满或信息漏填时，页面分别怎么反馈？", hint: "说明提示放在哪里、用户下一步能做什么" },
      { id: "acceptance", label: "给开发或测试同学写一条验收条件", hint: "用“当……时，页面应该……”描述" },
    ],
    checklist: ["覆盖填写、提交结果等至少三个状态", "明确指出漏填时需要修改的字段", "说明名额已满时不能继续误报成功", "验收条件能被另一位同学实际检查"],
    reference: [
      "可考虑：填写中、提交中、报名成功、资料不完整、名额已满、重复报名。重点是反馈明确且不误导。",
      "漏填时定位到具体字段并说明需要补什么；名额已满时说明无法报名，并提供候补或联系入口（如果主办方提供）。",
      "例如：当名额已满时，用户点击提交后页面显示“名额已满”，保留已填写信息，并且不显示报名成功。",
    ],
  },
  {
    id: "product-funnel",
    role: "产品分析",
    category: "理解流程 · 找到值得验证的问题",
    minutes: 15,
    title: "新生报名流程，卡在了哪一步？",
    summary: "读懂简单漏斗，提出一个可验证的问题，不急着给原因下结论。",
    context: "学生组织做了一个迎新活动报名页，记录了 100 位访问者的行为。负责人想知道页面是否需要调整。",
    materials: [
      { heading: "访问页面", content: "100 人" },
      { heading: "点击报名", content: "38 人" },
      { heading: "完成报名", content: "12 人" },
    ],
    prompts: [
      { id: "funnel", label: "写出从访问到完成报名的整体转化率", hint: "完成报名人数 ÷ 访问人数" },
      { id: "observation", label: "你能从这组数据确认什么？", hint: "描述事实，区分事实和对原因的猜测" },
      { id: "experiment", label: "下一步收集什么信息来验证问题？", hint: "给一个具体、能执行的观察或小实验" },
    ],
    checklist: ["正确写出整体转化率", "提到点击后完成的环节也有流失", "不把数据直接解释成某个确定原因", "提出一项可观察或可比较的验证办法"],
    reference: [
      "整体转化率为 12 ÷ 100 = 12%；点击报名后完成的人数比例为 12 ÷ 38 ≈ 31.6%。",
      "数据说明从访问到完成有流失，且点击报名后也有不少人没有完成；单凭人数看不出流失原因。",
      "可以先记录表单哪一步退出最多，或访谈几位未完成者，再决定是否调整字段和说明。",
    ],
  },
];

export function getTrialTask(taskId: string): TrialTask | undefined {
  return TRIAL_TASKS.find((task) => task.id === taskId);
}
