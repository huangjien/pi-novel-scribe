/**
 * 中文（简体）UI 字符串 — 工具描述、promptSnippet、promptGuidelines、
 * 标签、状态显示名、错误信息模板。
 *
 * 按 ADR-0007：工具内部名称保留英文（`delegate_to_writer`），此处仅
 * 用于**面向作者的**字符串。章节 frontmatter 中的 status 键保留英文；
 * 显示表只用于工具输出消息。
 */

import type { WorkflowStatus } from "../../workflow/status.ts"

export interface ToolStrings {
	readonly description: string
	readonly promptSnippet: string
	readonly promptGuidelines: readonly string[]
	readonly label: string
}

export const TOOL_STRINGS_ZH: Readonly<Record<string, ToolStrings>> = {
	wiki_search: {
		label: "维基检索",
		description:
			"在参考语料（story_lines、character_templates、scene_templates、writing_patterns、prompts）中按主题匹配模板，返回 FTS5 候选与 LLM 重排的前 N 项及其理由。",
		promptSnippet: "从 LLM 维基中检索主题匹配的参考模板。",
		promptGuidelines: [
			"当规划者/审阅者需要为章节或人物概念寻找主题匹配的参考模板时使用 wiki_search。",
			"query 必须是一句完整的话，描述章节计划、人物概念或场景意图。",
			"topN 默认为 5；可上调（最大 20）以扩大覆盖范围，或下调以精选。",
			"tables 默认为全部 5 张；当问题聚焦时（例如只关心 character_templates）可缩小范围。",
			"仅在希望得到纯 FTS5 BM25 结果（不调用 LLM）时设置 rerank=false。",
		],
	},
	run_director: {
		label: "调度器",
		description:
			"通过 config/route.yaml 将用户输入路由到对应工作流，返回匹配到的意图与主代理。第 2 阶段限制：未匹配时抛出错误（LLM 兜底在第 3+ 阶段）。",
		promptSnippet: "将用户输入与路由表匹配；返回意图与调度计划。",
		promptGuidelines: [
			"当用户键入 /novel 且需要决定调用哪个工作流时使用 run_director。",
			"run_director 之后，LLM 应根据返回的意图名调用 delegate_to_<intent>。",
			"调度计划的 `support` 列表混合了代理 ID 与直接工具名。裸名（如 `wiki_search`）表示直接调用该工具；其他名称对应 `delegate_to_<name>`。",
			"将 support 项与主代理并行调用。开始起草前先阅读 wiki_search 的挑选结果，使章节有参考模板支撑。",
		],
	},
	delegate_to_writer: {
		label: "执笔者",
		description:
			"为章节起草正文。确定性读取场景上下文（Q7），用执笔者提示调用 LLM，将正文写入章节文件，并将状态转移为 human_editing。",
		promptSnippet: "基于当前场景上下文生成章节正文。",
		promptGuidelines: [
			"仅当章节已有批准或临时计划时使用 delegate_to_writer。",
			"始终设置 chapter_id（文件名或绝对路径）以便执笔者知道为哪个章节起草。",
			"场景上下文数据包含有 wikiReferences（语料匹配，Q21）——以被引用模板的节拍作为默认节奏起草。",
			"起草完成后，规范工作流继续进入连续性校验（第 5+ 阶段）。",
		],
	},
	delegate_to_planner: {
		label: "规划者",
		description:
			"生成章节计划。读取小说状态，调用 LLM，解析 YAML 计划，写回章节 frontmatter，将状态转移为 planned。使用 `chapters=N`（1–8）可在一次 LLM 调用中批量规划 N 个连续章节（ADR-0009）。",
		promptSnippet: "从小说状态生成章节计划（通过 chapters 参数一次最多批量 8 个）。",
		promptGuidelines: [
			"当用户要求规划章节时（路由 plan_chapter）使用 delegate_to_planner。",
			"用户请求批量时（如 /novel plan 5）传入 `chapters=N`（1–8）。N=1 为默认值，保留单章行为。",
			"只输出 YAML 计划块——N=1 时为单个对象，N>1 时为 `chapters: [{plan}, ...]`。",
			"计划必须通过 template_refs 引用语料库模板（或显式豁免）——数据包中的 wikiReferences 即候选（Q22 / ADR-0008）。",
			"计划写入后，由用户审阅；只有经过审阅，/novel write 才会调用 delegate_to_writer。",
		],
	},
	delegate_to_critic: {
		label: "审阅者",
		description:
			"审阅一章。按 `category`（story / character / pacing / prose / foreshadowing / continuity-issue / other）和严重度（blocker / high / medium / low / praise）分段输出问题，可选 `pattern_ref` 将问题锚定到 writing_patterns 条目。输出写入章节 frontmatter 的 `review:` 字段。",
		promptSnippet: "审阅一章并按类别输出问题。",
		promptGuidelines: [
			"当用户要求审阅、批评或对一章提供反馈时（路由 review_chapter）使用 delegate_to_critic。",
			"始终设置 chapter_id 以便审阅者知道审阅哪一章。",
			"审阅数据包含有 wikiReferences（writing_patterns 匹配）—— applicable 时用 pattern_ref 为问题提供依据（ADR-0008 §4）。",
			"只输出 YAML 审阅块——不要任何前言或解释。",
		],
	},
	delegate_to_continuity: {
		label: "连续性",
		description:
			"规范一致性查询。只读：inspect_novel_state（X 知道什么）、investigate_continuity_break（查找矛盾）、refresh（第 5+ 阶段：写回信念）。",
		promptSnippet: "读取小说状态，推导信念，查找矛盾。",
		promptGuidelines: [
			"对 inspect_novel_state 与 investigate_continuity_break 路由使用 delegate_to_continuity。",
			"第 4 阶段的连续性是只读的。规范状态的变更通过 canon_propose（第 5 阶段）进行。",
		],
	},
}

export const STATUS_DISPLAY_ZH: Readonly<Record<WorkflowStatus, string>> = {
	planned: "已规划",
	writing: "撰写中",
	drafted: "已起草",
	human_editing: "作者编辑中",
	edited: "已编辑",
	continuity_check: "连续性检查",
	reviewing: "审阅中",
	revision_required: "需要修订",
	approved: "已批准",
	canonized: "已经典化",
}

export const HELP_TEXT_ZH = `可用子命令：
  /novel write [章节] [--lang=<en|zh>]  — 在编辑器中打开章节；保存即标记为 drafted。
  /novel help                            — 显示此消息。
  /novel <任意内容>                       — LLM 工具循环（run_director → delegate_to_<primary>）。

内置代理工具：
  delegate_to_writer       — 基于场景上下文起草正文（Q7）。
  delegate_to_planner      — 计划阶段意图。
  delegate_to_critic       — 审阅意图。
  delegate_to_continuity   — 规范一致性（第 4 阶段：只读）。
  run_director             — 路由表调度器（ADR-0004）。
  canon_propose            — 提议规范变更（第 5 阶段）。
  canon_approve            — 规范变更草稿的编辑器关卡（第 6.6 阶段）。
  wiki_search              — LLM 维基：精选前 N 个参考模板（第 8 阶段）。
`

export const ERROR_MESSAGES_ZH = {
	wiki_no_model: "wiki 重排需要当前会话已绑定模型；在已绑定模型的 pi 会话中运行。",
	wiki_db_missing: (path: string) =>
		`未找到维基数据库：${path}。请在 .pi/settings.json 中设置 "wikiDbPath" 或恢复默认快照。`,
	editor_no_model: (agent: string) => `${agent}：当前会话中未绑定模型。`,
	editor_chapter_approved: (agent: string, status: string) =>
		`${agent}：章节状态为 ${status}——拒绝覆盖已批准的规范。`,
	editor_no_prose: (agent: string) => `${agent}：LLM 未生成任何正文。`,
	editor_no_yaml_plan: (agent: string) => `${agent}：LLM 输出中没有 \`\`\`yaml 围栏的计划块。`,
	editor_no_yaml_review: (agent: string) => `${agent}：LLM 输出中没有 \`\`\`yaml 围栏的审阅块。`,
	route_no_match: (input: string) =>
		`run_director：没有路由匹配输入 "${input.slice(0, 60)}"，LLM 兜底尚未接入（第 3+ 阶段）。请在 config/route.yaml 中添加兜底路由，或接入 LLM 分类器。`,
	plan_missing_template_refs: (agent: string) =>
		`${agent}：计划未引用任何 template_refs，也没有显式豁免。请引用语料库模板（template_refs），或设置 template_refs_exempt: true 并填写 template_refs_exempt_rationale（Q22 / ADR-0008）。`,
	plan_no_chapters_to_plan:
		"delegate_to_planner（批量）：chapters/ 下未找到可规划的章节。请检查锚点并确保至少一个章节处于非终态。",
	plan_block_validation_failed:
		"delegate_to_planner（批量）：一个或多个计划块验证失败（缺少 template_refs 或结构不合法）。已写入成功的计划；失败的章节文件保持原状。请用更小的 chapters 数量重跑，仅重试失败的章节。",
	wiki_packet_degraded: (reason: string) =>
		`本数据包的维基参考不可用（写作将继续，不带参考模板）：${reason}`,
	wiki_rerank_budget: "本数据包组装的维基重排预算已耗尽——回退为 BM25 排序。",
} as const
