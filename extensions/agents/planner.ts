/**
 * Planner agent. Per ADR-0005, this is one of the 5 pre-declared
 * agents. Wired end-to-end — reads novel state + last prose, calls
 * the LLM, parses the YAML plan, writes `plan:` back into the chapter
 * frontmatter, transitions status → planned.
 */

import { readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import * as yaml from "js-yaml"
import { Type } from "typebox"
import { composePlanRequest } from "../novel/plan-context.ts"
import { applyStatus } from "../workflow/status.ts"

const PROMPT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../../prompts/planner.md")

function loadPlannerPromptBody(): string {
	const raw = readFileSync(PROMPT_PATH, "utf8")
	const sep = raw.indexOf("\n---")
	if (sep === -1) return raw
	const second = raw.indexOf("\n---", sep + 4)
	if (second === -1) return raw.slice(sep + 4)
	return raw.slice(second + 5).trim()
}

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
		label: "Planner",
		description:
			"Generate a chapter plan. Reads novel state, calls the LLM, parses the YAML plan, writes it back to chapter frontmatter, transitions status → planned.",
		promptSnippet: "Generate a chapter plan from novel state.",
		promptGuidelines: [
			"Use delegate_to_planner when the user asks to plan a chapter (route plan_chapter).",
			"Output ONLY a YAML plan block — no preamble, no commentary.",
			"After the plan is written, the user reviews it; only then does /novel write invoke delegate_to_writer.",
		],
		parameters: Type.Object({
			chapter_id: Type.String({
				description: "Chapter filename (e.g. 0005.md) or absolute path.",
			}),
			scope: Type.Optional(Type.String({ description: "User note: POV hint, focus, etc." })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const p = params as { chapter_id: string; scope?: string }
			if (!ctx.model) {
				throw new Error("delegate_to_planner: no active model in this session.")
			}

			const request = composePlanRequest({
				chapterPath: p.chapter_id,
				cwd: ctx.cwd,
			})

			const promptBody = loadPlannerPromptBody()
			const userMessage = `Plan request:\n\`\`\`\n${JSON.stringify(
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
			)}\n\`\`\`\n${p.scope ? `\nUser note: ${p.scope}\n` : ""}\nReturn ONLY a YAML plan block between \`\`\`yaml fences.`

			const result = await ctx.modelRegistry.complete(
				ctx.model,
				{
					systemPrompt: promptBody,
					messages: [{ role: "user", content: userMessage, timestamp: Date.now() }],
				},
				{},
			)

			const text = result.content
				.filter((b: { type: string }) => b.type === "text")
				.map((b: { type: string; text?: string }) => b.text ?? "")
				.join("")
			const yamlBody = extractYamlBlock(text)
			if (yamlBody === null) {
				throw new Error("delegate_to_planner: LLM output had no ```yaml fenced plan block.")
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

			return {
				content: [
					{
						type: "text",
						text: `Plan written for chapter ${request.chapterNumber ?? "?"} at ${request.chapterPath}. Status → planned.`,
					},
				],
				details: { chapterPath: request.chapterPath, plan: parsedPlan },
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
