/**
 * Planner agent. Per ADR-0005, this is one of the 5 pre-declared
 * agents. Wired end-to-end — reads novel state + last prose, calls
 * the LLM, parses the YAML plan, writes `plan:` back into the chapter
 * frontmatter, transitions status → planned.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { ExtensionAPI, ModelRegistry } from "@earendil-works/pi-coding-agent"
import * as yaml from "js-yaml"
import { Type } from "typebox"
import {
	DEFAULT_LANGUAGE,
	errorMessage,
	type Language,
	localizedError,
	resolveLanguage,
	statusDisplay,
	toolStrings,
} from "../i18n/index.ts"
import { loadAgentPrompt } from "../i18n/prompts.ts"
import { composeBatchPlanRequest, composePlanRequest } from "../novel/plan-context.ts"
import {
	injectWikiReferences,
	PLANNER_TABLES,
	plannerWikiQuery,
	validateTemplateRefs,
} from "../wiki/context.ts"
import { applyStatus } from "../workflow/status.ts"

const MAX_BATCH_CHAPTERS = 8
const YAML_BLOCK_RE = /```\s*(?:yaml|yml)\s*\n([\s\S]*?)```/i

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?([\s\S]*)$/

function parseYamlFrontmatter(content: string): {
	frontmatter: Record<string, unknown>
	body: string
} {
	const m = FRONTMATTER_RE.exec(content)
	if (!m || m[1] === undefined || m[2] === undefined) {
		return { frontmatter: {}, body: content }
	}
	let parsed: unknown
	try {
		parsed = yaml.load(m[1])
	} catch {
		return { frontmatter: {}, body: m[2] }
	}
	if (typeof parsed !== "object" || parsed === null) {
		return { frontmatter: {}, body: m[2] }
	}
	return { frontmatter: parsed as Record<string, unknown>, body: m[2] }
}

function serializeFrontmatter(fm: Record<string, unknown>): string {
	const lines = ["---"]
	for (const [key, value] of Object.entries(fm)) {
		if (value === undefined) continue
		const rendered =
			value === null
				? "null"
				: typeof value === "object"
					? yaml.dump(value, { lineWidth: -1, flowLevel: 0 }).trimEnd()
					: typeof value === "string"
						? JSON.stringify(value)
						: String(value)
		lines.push(`${key}: ${rendered}`)
	}
	lines.push("---")
	return lines.join("\n")
}
export function extractYamlBlock(llmOutput: string): string | null {
	const m = YAML_BLOCK_RE.exec(llmOutput)
	if (!m?.[1]) return null
	return m[1].trim()
}

export function registerPlannerAgent(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "delegate_to_planner",
		label: toolStrings(DEFAULT_LANGUAGE, "delegate_to_planner").label,
		description: toolStrings(DEFAULT_LANGUAGE, "delegate_to_planner").description,
		promptSnippet: toolStrings(DEFAULT_LANGUAGE, "delegate_to_planner").promptSnippet,
		promptGuidelines: [...toolStrings(DEFAULT_LANGUAGE, "delegate_to_planner").promptGuidelines],
		parameters: Type.Object({
			chapter_id: Type.String({
				description: "Chapter filename (e.g. 0005.md) or absolute path.",
			}),
			chapters: Type.Optional(
				Type.Number({
					minimum: 1,
					maximum: 8,
					description: `Plan this many successive chapters in one LLM call (ADR-0009). Default 1, max ${MAX_BATCH_CHAPTERS}.`,
				}),
			),
			scope: Type.Optional(Type.String({ description: "User note: POV hint, focus, etc." })),
			language: Type.Optional(
				Type.Union([Type.Literal("en"), Type.Literal("zh")], {
					description: "Override the working language for this call.",
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const p = params as {
				chapter_id: string
				chapters?: number
				scope?: string
				language?: Language
			}
			if (!ctx.model) {
				localizedError(DEFAULT_LANGUAGE, "editor_no_model", "delegate_to_planner")
			}
			const lang = resolveLanguage(ctx, {
				flag: p.language,
				chapterPath: p.chapter_id,
			})
			const n = clampBatchSize(p.chapters ?? 1)
			if (n === 1) {
				return runSinglePlanner(ctx, p, lang)
			}
			return runBatchPlanner(ctx, p, lang, n)
		},
	})
}

function readChapter(path: string): {
	frontmatter: Record<string, unknown>
	body: string
} {
	return parseYamlFrontmatter(readFileSync(path, "utf8"))
}

function buildPlannerUserMessage(
	request: ReturnType<typeof composePlanRequest> & {
		wikiReferences?: unknown
		wikiWarning?: string | null
	},
	scope: string | undefined,
	lang: Language,
): string {
	const payload = JSON.stringify(
		{
			novelRepo: request.novelRepo,
			chapterPath: request.chapterPath,
			chapterNumber: request.chapterNumber,
			existingPlan: request.existingPlan,
			characterProfiles: request.characterProfiles,
			activeStoryLines: request.activeStoryLines,
			lastProseTail: request.lastProseTail,
			approvedChapterCount: request.approvedChapterCount,
			wikiReferences: request.wikiReferences,
		},
		null,
		2,
	)
	const closing =
		lang === "zh"
			? "请仅以 ```yaml 围栏的 YAML 计划块返回。计划必须包含 template_refs（或 template_refs_exempt + 理由）。"
			: "Return ONLY a YAML plan block between ```yaml fences. The plan MUST include template_refs (or template_refs_exempt + rationale)."
	return [
		`Working language: ${lang}`,
		"Plan request:",
		"```",
		payload,
		"```",
		request.wikiWarning ? `\nWarning: ${request.wikiWarning}` : "",
		scope ? `\nUser note: ${scope}\n` : "",
		closing,
	].join("\n")
}

function extractTextFromResult(result: {
	content: Array<{ type: string; text?: string }>
}): string {
	return result.content
		.filter((b) => b.type === "text")
		.map((b) => b.text ?? "")
		.join("")
}

function parsePlannerPlan(llmOutput: string, lang: Language): Record<string, unknown> {
	const yamlBody = extractYamlBlock(llmOutput)
	if (yamlBody === null) {
		localizedError(lang, "editor_no_yaml_plan", "delegate_to_planner")
	}
	let parsed: unknown
	try {
		parsed = yaml.load(yamlBody)
	} catch (err) {
		throw new Error(`delegate_to_planner: YAML parse error: ${(err as Error).message}`)
	}
	if (typeof parsed !== "object" || parsed === null) {
		throw new Error("delegate_to_planner: parsed YAML is not an object (expected { plan: {...} }).")
	}
	const plan = (parsed as { plan?: unknown }).plan ?? parsed
	if (typeof plan !== "object" || plan === null) {
		throw new Error("delegate_to_planner: parsed plan is not an object.")
	}
	const refCheck = validateTemplateRefs(plan as Record<string, unknown>)
	if (!refCheck.valid) {
		localizedError(lang, "plan_missing_template_refs", "delegate_to_planner")
	}
	return plan as Record<string, unknown>
}

function persistPlannerPlan(chapterPath: string, plan: Record<string, unknown>): void {
	const { frontmatter: existing, body } = readChapter(chapterPath)
	const updated: Record<string, unknown> = { ...existing, plan }
	const rebuilt = `${serializeFrontmatter(updated)}\n\n${body}`
	writeFileSync(chapterPath, rebuilt, "utf8")
	applyStatus(chapterPath, "planned")
}

function clampBatchSize(n: number): number {
	if (!Number.isFinite(n)) return 1
	return Math.min(MAX_BATCH_CHAPTERS, Math.max(1, Math.floor(n)))
}
function resolveBatchChapterPaths(cwd: string, anchor: string, n: number): readonly string[] {
	const novelRepoMatch = findNovelRepoFromCwd(cwd)
	if (!novelRepoMatch) return []
	const chaptersDir = join(novelRepoMatch, "chapters")
	if (!existsSync(chaptersDir)) return []
	const anchorAbs = anchor.startsWith("/") ? anchor : join(novelRepoMatch, "chapters", anchor)
	const anchorResolved = existsSync(anchorAbs) ? anchorAbs : null
	const allFiles = readdirSync(chaptersDir)
		.filter((f) => f.endsWith(".md"))
		.sort()
	const startIdx =
		anchorResolved === null
			? 0
			: Math.max(0, allFiles.indexOf(anchorResolved.slice(chaptersDir.length + 1)))
	const writable: string[] = []
	for (let i = startIdx; i < allFiles.length && writable.length < n; i++) {
		const fileName = allFiles[i]
		if (fileName === undefined) continue
		const fullPath = join(chaptersDir, fileName)
		if (!isWritableChapter(fullPath)) continue
		writable.push(fullPath)
	}
	return writable
}

function isWritableChapter(chapterPath: string): boolean {
	const raw = readFileSync(chapterPath, "utf8")
	const m = FRONTMATTER_RE.exec(raw)
	if (!m || m[1] === undefined) return true
	const statusMatch = /^status:\s*(\S+)/m.exec(m[1])
	if (!statusMatch) return true
	const status = statusMatch[1]
	return status !== "approved" && status !== "canonized"
}
function findNovelRepoFromCwd(cwd: string): string | null {
	try {
		const marker = join(cwd, ".pi", "settings.json")
		if (existsSync(marker)) return cwd
	} catch {
		return null
	}
	return null
}

function buildBatchPlannerUserMessage(
	batch: {
		novelRepo: string
		chapters: readonly {
			chapterPath: string
			chapterNumber: number | null
			existingPlan: Record<string, unknown> | null
		}[]
		characterProfiles: Record<string, string>
		activeStoryLines: readonly string[]
		lastProseTail: string | null
		approvedChapterCount: number
		wikiReferences?: unknown
		wikiWarning?: string | null
	},
	scope: string | undefined,
	lang: Language,
): string {
	const payload = JSON.stringify(
		{
			novelRepo: batch.novelRepo,
			chapterCount: batch.chapters.length,
			chapters: batch.chapters.map((c) => ({
				chapterPath: c.chapterPath,
				chapterNumber: c.chapterNumber,
				existingPlan: c.existingPlan,
			})),
			characterProfiles: batch.characterProfiles,
			activeStoryLines: batch.activeStoryLines,
			lastProseTail: batch.lastProseTail,
			approvedChapterCount: batch.approvedChapterCount,
			wikiReferences: batch.wikiReferences,
		},
		null,
		2,
	)
	const closing =
		lang === "zh"
			? `请以 \`\`\`yaml 围栏的 YAML 块返回，包含全部 ${batch.chapters.length} 个计划，形式为 chapters: [{plan...}, {plan...}, ...]。每个 plan 都必须包含 template_refs（或 template_refs_exempt + 理由）。`
			: `Return ONLY a YAML block between \`\`\`yaml fences with all ${batch.chapters.length} plans as chapters: [{plan...}, {plan...}, ...]. Each plan MUST include template_refs (or template_refs_exempt + rationale).`
	return [
		`Working language: ${lang}`,
		`Batch plan request (${batch.chapters.length} chapters):`,
		"```",
		payload,
		"```",
		batch.wikiWarning ? `\nWarning: ${batch.wikiWarning}` : "",
		scope ? `\nUser note: ${scope}\n` : "",
		closing,
	].join("\n")
}

function parseBatchPlannerPlans(
	llmOutput: string,
	expected: number,
	_lang: Language,
): Array<Record<string, unknown> | null> {
	const yamlBody = extractYamlBlock(llmOutput)
	if (yamlBody === null) return []
	let parsed: unknown
	try {
		parsed = yaml.load(yamlBody)
	} catch {
		return []
	}
	if (typeof parsed !== "object" || parsed === null) return []
	const obj = parsed as { chapters?: unknown; plan?: unknown }
	if (Array.isArray(obj.chapters)) {
		const out: Array<Record<string, unknown> | null> = []
		for (const raw of obj.chapters) {
			if (typeof raw === "object" && raw !== null) {
				out.push(raw as Record<string, unknown>)
			} else {
				out.push(null)
			}
		}
		return out
	}
	if (typeof obj.plan === "object" && obj.plan !== null) {
		return [obj.plan as Record<string, unknown>]
	}
	const _ = expected
	return []
}

function formatBatchResult(
	lang: Language,
	persisted: number,
	failed: number,
	statusLabel: string,
): string {
	if (lang === "zh") {
		return `已写入 ${persisted} 个计划${failed > 0 ? `，${failed} 个验证失败` : ""}。状态 → ${statusLabel}。`
	}
	return `Wrote ${persisted} plan(s)${failed > 0 ? `, ${failed} failed validation` : ""}. Status → ${statusLabel}.`
}

interface PlannerParams {
	readonly chapter_id: string
	readonly chapters?: number
	readonly scope?: string
	readonly language?: Language
}

type ToolResult = {
	content: Array<{ type: "text"; text: string }>
	details: Record<string, unknown>
}

async function runSinglePlanner(
	ctx: Parameters<typeof injectWikiReferences>[0],
	p: PlannerParams,
	lang: Language,
): Promise<ToolResult> {
	if (!ctx.model) {
		localizedError(DEFAULT_LANGUAGE, "editor_no_model", "delegate_to_planner")
	}
	const request = composePlanRequest({
		chapterPath: p.chapter_id,
		cwd: ctx.cwd,
	})
	const wiki = await injectWikiReferences(
		ctx,
		plannerWikiQuery({
			activeStoryLines: request.activeStoryLines,
			characterProfiles: request.characterProfiles,
			existingPlan: request.existingPlan,
		}),
		{ tables: PLANNER_TABLES, language: lang },
	)
	const requestWithWiki = {
		...request,
		wikiReferences: wiki.wikiReferences,
		wikiWarning: wiki.wikiWarning,
	}
	const promptBody = loadAgentPrompt("planner", lang)
	const userMessage = buildPlannerUserMessage(requestWithWiki, p.scope, lang)

	const result = await (ctx.modelRegistry as ModelRegistry).complete(ctx.model, {
		systemPrompt: promptBody,
		messages: [{ role: "user", content: userMessage, timestamp: Date.now() }],
	})

	const plan = parsePlannerPlan(extractTextFromResult(result), lang)
	persistPlannerPlan(request.chapterPath, plan)

	const statusLabel = statusDisplay(lang, "planned")
	const planMsg =
		lang === "zh"
			? `已为第 ${request.chapterNumber ?? "?"} 章（${request.chapterPath}）写入计划。状态 → ${statusLabel}。`
			: `Plan written for chapter ${request.chapterNumber ?? "?"} at ${request.chapterPath}. Status → ${statusLabel}.`
	return {
		content: [{ type: "text", text: planMsg }],
		details: { chapterPath: request.chapterPath, plan, language: lang },
	}
}

async function runBatchPlanner(
	ctx: Parameters<typeof injectWikiReferences>[0],
	p: PlannerParams,
	lang: Language,
	n: number,
): Promise<ToolResult> {
	if (!ctx.model) {
		localizedError(DEFAULT_LANGUAGE, "editor_no_model", "delegate_to_planner")
	}
	const batchPaths = resolveBatchChapterPaths(ctx.cwd, p.chapter_id, n)
	if (batchPaths.length === 0) {
		localizedError(lang, "plan_no_chapters_to_plan")
	}
	const batch = composeBatchPlanRequest({
		chapterPaths: batchPaths,
		cwd: ctx.cwd,
	})
	const wiki = await injectWikiReferences(
		ctx,
		plannerWikiQuery({
			activeStoryLines: batch.activeStoryLines,
			characterProfiles: batch.characterProfiles,
			existingPlan: batch.chapters[0]?.existingPlan ?? null,
		}),
		{ tables: PLANNER_TABLES, language: lang },
	)
	const batchWithWiki = {
		...batch,
		wikiReferences: wiki.wikiReferences,
		wikiWarning: wiki.wikiWarning,
	}
	const promptBody = loadAgentPrompt("planner", lang)
	const userMessage = buildBatchPlannerUserMessage(batchWithWiki, p.scope, lang)

	const result = await (ctx.modelRegistry as ModelRegistry).complete(ctx.model, {
		systemPrompt: promptBody,
		messages: [{ role: "user", content: userMessage, timestamp: Date.now() }],
	})

	const blocks = parseBatchPlannerPlans(extractTextFromResult(result), batchPaths.length, lang)
	const persisted: string[] = []
	const failed: Array<{ chapterPath: string; reason: string }> = []
	for (let i = 0; i < blocks.length && i < batchPaths.length; i++) {
		const block = blocks[i]
		const path = batchPaths[i]
		if (!block || !path) continue
		const refCheck = validateTemplateRefs(block)
		if (!refCheck.valid) {
			failed.push({ chapterPath: path, reason: refCheck.reason })
			continue
		}
		persistPlannerPlan(path, block)
		persisted.push(path)
	}
	const statusLabel = statusDisplay(lang, "planned")
	const planMsg = formatBatchResult(lang, persisted.length, failed.length, statusLabel)
	const details: Record<string, unknown> = {
		chapterPaths: batchPaths,
		persisted,
		failed,
		language: lang,
	}
	if (failed.length > 0) {
		details.warning = errorMessage(lang, "plan_block_validation_failed")
	}
	return { content: [{ type: "text", text: planMsg }], details }
}
