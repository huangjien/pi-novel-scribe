/**
 * Planner agent. Per ADR-0005, this is one of the 5 pre-declared
 * agents. Wired end-to-end — reads novel state + last prose, calls
 * the LLM, parses the YAML plan, writes `plan:` back into the chapter
 * frontmatter, transitions status → planned.
 */

import { readFileSync, writeFileSync } from "node:fs"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import * as yaml from "js-yaml"
import { Type } from "typebox"
import {
	DEFAULT_LANGUAGE,
	type Language,
	localizedError,
	resolveLanguage,
	statusDisplay,
	toolStrings,
} from "../i18n/index.ts"
import { loadAgentPrompt } from "../i18n/prompts.ts"
import { composePlanRequest } from "../novel/plan-context.ts"
import { applyStatus } from "../workflow/status.ts"

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
		const rendered = value === null ? "null" : JSON.stringify(value)
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
			scope: Type.Optional(Type.String({ description: "User note: POV hint, focus, etc." })),
			language: Type.Optional(
				Type.Union([Type.Literal("en"), Type.Literal("zh")], {
					description: "Override the working language for this call.",
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const p = params as { chapter_id: string; scope?: string; language?: Language }
			if (!ctx.model) {
				localizedError(DEFAULT_LANGUAGE, "editor_no_model", "delegate_to_planner")
			}

			const request = composePlanRequest({
				chapterPath: p.chapter_id,
				cwd: ctx.cwd,
			})

			const lang = resolveLanguage(ctx, {
				flag: p.language,
				chapterPath: p.chapter_id,
			})
			const promptBody = loadAgentPrompt("planner", lang)
			const userMessage = buildPlannerUserMessage(request, p.scope, lang)

			const result = await ctx.modelRegistry.complete(
				ctx.model,
				{
					systemPrompt: promptBody,
					messages: [{ role: "user", content: userMessage, timestamp: Date.now() }],
				},
				{},
			)

			const yamlBody = extractYamlBlock(extractTextFromResult(result))
			if (yamlBody === null) {
				localizedError(lang, "editor_no_yaml_plan", "delegate_to_planner")
			}

			let parsedPlan: unknown
			try {
				parsedPlan = yaml.load(yamlBody)
			} catch (err) {
				throw new Error(`delegate_to_planner: YAML parse error: ${(err as Error).message}`)
			}
			if (typeof parsedPlan !== "object" || parsedPlan === null) {
				throw new Error(
					"delegate_to_planner: parsed YAML is not an object (expected { plan: {...} }).",
				)
			}

			const { frontmatter: existing, body } = readChapter(request.chapterPath)
			const updated: Record<string, unknown> = {
				...existing,
				plan: (parsedPlan as { plan?: unknown }).plan ?? parsedPlan,
			}
			const rebuilt = `${serializeFrontmatter(updated)}\n\n${body}`
			writeFileSync(request.chapterPath, rebuilt, "utf8")
			applyStatus(request.chapterPath, "planned")

			const statusLabel = statusDisplay(lang, "planned")
			const planMsg =
				lang === "zh"
					? `已为第 ${request.chapterNumber ?? "?"} 章（${request.chapterPath}）写入计划。状态 → ${statusLabel}。`
					: `Plan written for chapter ${request.chapterNumber ?? "?"} at ${request.chapterPath}. Status → ${statusLabel}.`
			return {
				content: [{ type: "text", text: planMsg }],
				details: { chapterPath: request.chapterPath, plan: parsedPlan, language: lang },
			}
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
	request: ReturnType<typeof composePlanRequest>,
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
		},
		null,
		2,
	)
	const closing =
		lang === "zh"
			? "请仅以 ```yaml 围栏的 YAML 计划块返回。"
			: "Return ONLY a YAML plan block between ```yaml fences."
	return [
		`Working language: ${lang}`,
		"Plan request:",
		"```",
		payload,
		"```",
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
