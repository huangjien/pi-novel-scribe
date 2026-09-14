/**
 * Critic agent. Per ADR-0005, this ships as ONE LLM call with
 * segmented `category` field. Subagents (Story/Character/Pacing/Prose)
 * are earned by measured need, not declared up front.
 */

import { readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import * as yaml from "js-yaml"
import { Type } from "typebox"
import { composeCriticContext } from "../novel/critic-context.ts"
import { extractYamlBlock } from "../novel/yaml-extract.ts"

const PROMPT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../../prompts/critic.md")

function loadCriticPromptBody(): string {
	const raw = readFileSync(PROMPT_PATH, "utf8")
	const sep = raw.indexOf("\n---")
	if (sep === -1) return raw
	const second = raw.indexOf("\n---", sep + 4)
	if (second === -1) return raw.slice(sep + 4)
	return raw.slice(second + 5).trim()
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?([\s\S]*)$/

export interface CriticIssue {
	readonly category: string
	readonly severity: string
	readonly evidence: string
	readonly impact: string
	readonly recommendation: string
}

export interface CriticReview {
	readonly issues: readonly CriticIssue[]
	readonly summary: string
	readonly atChapter: number | null
	readonly reviewedAt: string
}

export function registerCriticAgent(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "delegate_to_critic",
		label: "Critic",
		description:
			"Review a chapter. Issues are segmented by `category` (story / character / pacing / prose / foreshadowing / continuity-issue / other) with severity (blocker / high / medium / low / praise). Output written to chapter frontmatter `review:` field.",
		promptSnippet: "Review a chapter and emit categorized issues.",
		promptGuidelines: [
			"Use delegate_to_critic when the user asks for review, critique, or feedback on a chapter (route review_chapter).",
			"Always set chapter_id so the Critic knows which chapter to read.",
			"Output ONLY a YAML review block — no preamble, no commentary.",
		],
		parameters: Type.Object({
			chapter_id: Type.String({ description: "Chapter filename or absolute path." }),
			rubric: Type.Optional(
				Type.String({ description: "Optional per-category severity thresholds." }),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const p = params as { chapter_id: string; rubric?: string }
			if (!ctx.model) {
				throw new Error("delegate_to_critic: no active model in this session.")
			}
			const ctxData = composeCriticContext({
				chapterPath: p.chapter_id,
				cwd: ctx.cwd,
			})
			const promptBody = loadCriticPromptBody()
			const userMessage = `Review request:\n\`\`\`\n${JSON.stringify(
				{
					novelRepo: ctxData.novelRepo,
					chapterPath: ctxData.chapterPath,
					chapterNumber: ctxData.chapterNumber,
					wordCount: ctxData.wordCount,
					plan: ctxData.plan,
					pov: ctxData.pov,
					characterProfile: ctxData.characterProfile,
					activeStoryLines: ctxData.activeStoryLines,
					storyLineIndex: ctxData.storyLineIndex,
					prose: ctxData.prose,
				},
				null,
				2,
			)}\n\`\`\`\n${p.rubric ? `\nRubric: ${p.rubric}\n` : ""}\nReturn ONLY a YAML review block between \`\`\`yaml fences.`

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
				throw new Error("delegate_to_critic: LLM output had no ```yaml fenced review block.")
			}
			let parsedReview: unknown
			try {
				parsedReview = yaml.load(yamlBody)
			} catch (err) {
				throw new Error(`delegate_to_critic: YAML parse error: ${(err as Error).message}`)
			}
			if (typeof parsedReview !== "object" || parsedReview === null) {
				throw new Error("delegate_to_critic: parsed YAML is not an object.")
			}
			const review: CriticReview = {
				issues: extractIssues((parsedReview as { issues?: unknown }).issues),
				summary:
					typeof (parsedReview as { summary?: unknown }).summary === "string"
						? (parsedReview as { summary: string }).summary
						: "",
				atChapter: ctxData.chapterNumber,
				reviewedAt: new Date().toISOString(),
			}
			const { frontmatter: existing, body } = readChapter(ctxData.chapterPath)
			const updated: Record<string, unknown> = { ...existing, review }
			const rebuilt = `${serializeFrontmatter(updated)}\n\n${body}`
			writeFileSync(ctxData.chapterPath, rebuilt, "utf8")
			return {
				content: [
					{
						type: "text",
						text: `Reviewed chapter ${ctxData.chapterNumber ?? "?"}: ${review.issues.length} issue(s). Summary: ${review.summary || "(none)"}`,
					},
				],
				details: { chapterPath: ctxData.chapterPath, review },
			}
		},
	})
}

function extractIssues(raw: unknown): CriticIssue[] {
	if (!Array.isArray(raw)) return []
	const out: CriticIssue[] = []
	for (const item of raw) {
		if (typeof item !== "object" || item === null) continue
		const v = item as Partial<CriticIssue>
		if (
			typeof v.category === "string" &&
			typeof v.severity === "string" &&
			typeof v.evidence === "string" &&
			typeof v.impact === "string" &&
			typeof v.recommendation === "string"
		) {
			out.push({
				category: v.category,
				severity: v.severity,
				evidence: v.evidence,
				impact: v.impact,
				recommendation: v.recommendation,
			})
		}
	}
	return out
}

function readChapter(path: string): {
	frontmatter: Record<string, unknown>
	body: string
} {
	const raw = readFileSync(path, "utf8")
	const m = FRONTMATTER_RE.exec(raw)
	if (!m || m[1] === undefined || m[2] === undefined) {
		return { frontmatter: {}, body: raw }
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
