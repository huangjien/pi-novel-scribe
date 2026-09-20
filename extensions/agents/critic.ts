/**
 * Critic agent. Per ADR-0005, this ships as ONE LLM call with
 * segmented `category` field. Subagents (Story/Character/Pacing/Prose)
 * are earned by measured need, not declared up front.
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
	toolStrings,
} from "../i18n/index.ts"
import { loadAgentPrompt } from "../i18n/prompts.ts"
import { composeCriticContext } from "../novel/critic-context.ts"
import { extractYamlBlock } from "../novel/yaml-extract.ts"
import { CRITIC_TABLES, criticWikiQuery, injectWikiReferences } from "../wiki/context.ts"
import { WIKI_TABLES } from "../wiki/schema.ts"

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?([\s\S]*)$/

export interface CriticPatternRef {
	readonly table: (typeof WIKI_TABLES)[number]
	readonly id: string
}

export interface CriticIssue {
	readonly category: string
	readonly severity: string
	readonly evidence: string
	readonly impact: string
	readonly recommendation: string
	readonly pattern_ref?: CriticPatternRef | null
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
		label: toolStrings(DEFAULT_LANGUAGE, "delegate_to_critic").label,
		description: toolStrings(DEFAULT_LANGUAGE, "delegate_to_critic").description,
		promptSnippet: toolStrings(DEFAULT_LANGUAGE, "delegate_to_critic").promptSnippet,
		promptGuidelines: [...toolStrings(DEFAULT_LANGUAGE, "delegate_to_critic").promptGuidelines],
		parameters: Type.Object({
			chapter_id: Type.String({ description: "Chapter filename or absolute path." }),
			rubric: Type.Optional(
				Type.String({ description: "Optional per-category severity thresholds." }),
			),
			language: Type.Optional(
				Type.Union([Type.Literal("en"), Type.Literal("zh")], {
					description: "Override the working language for this call.",
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const p = params as { chapter_id: string; rubric?: string; language?: Language }
			if (!ctx.model) {
				localizedError(DEFAULT_LANGUAGE, "editor_no_model", "delegate_to_critic")
			}
			const ctxData = composeCriticContext({
				chapterPath: p.chapter_id,
				cwd: ctx.cwd,
			})
			const lang = resolveLanguage(ctx, {
				flag: p.language,
				chapterPath: p.chapter_id,
			})
			const wiki = await injectWikiReferences(
				ctx,
				criticWikiQuery({ plan: ctxData.plan, pov: ctxData.pov }),
				{ tables: CRITIC_TABLES, language: lang },
			)
			const ctxDataWithWiki = {
				...ctxData,
				wikiReferences: wiki.wikiReferences,
				wikiWarning: wiki.wikiWarning,
			}
			const promptBody = loadAgentPrompt("critic", lang)
			const userMessage = buildCriticUserMessage(ctxDataWithWiki, p.rubric, lang)

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
			const review = parseCriticYamlResponse(text, lang, p.chapter_id)
			const { frontmatter: existing, body } = readChapter(ctxData.chapterPath)
			const updated: Record<string, unknown> = { ...existing, review }
			const rebuilt = `${serializeFrontmatter(updated)}\n\n${body}`
			writeFileSync(ctxData.chapterPath, rebuilt, "utf8")
			const summaryTxt = review.summary || (lang === "zh" ? "（无）" : "(none)")
			const msg =
				lang === "zh"
					? `已审阅第 ${ctxData.chapterNumber ?? "?"} 章：${review.issues.length} 个问题。摘要：${summaryTxt}`
					: `Reviewed chapter ${ctxData.chapterNumber ?? "?"}: ${review.issues.length} issue(s). Summary: ${summaryTxt}`
			return {
				content: [{ type: "text", text: msg }],
				details: { chapterPath: ctxData.chapterPath, review, language: lang },
			}
		},
	})
}

function coercePatternRef(raw: unknown): CriticPatternRef | null {
	if (typeof raw !== "object" || raw === null) return null
	const v = raw as { table?: unknown; id?: unknown }
	if (
		typeof v.table !== "string" ||
		!(WIKI_TABLES as readonly string[]).includes(v.table) ||
		typeof v.id !== "string" ||
		v.id.trim().length === 0
	) {
		return null
	}
	return { table: v.table as CriticPatternRef["table"], id: v.id }
}

function extractIssues(raw: unknown): CriticIssue[] {
	if (!Array.isArray(raw)) return []
	const out: CriticIssue[] = []
	for (const item of raw) {
		if (typeof item !== "object" || item === null) continue
		const v = item as Partial<CriticIssue> & { pattern_ref?: unknown }
		if (
			typeof v.category === "string" &&
			typeof v.severity === "string" &&
			typeof v.evidence === "string" &&
			typeof v.impact === "string" &&
			typeof v.recommendation === "string"
		) {
			const patternRef = coercePatternRef(v.pattern_ref)
			out.push({
				category: v.category,
				severity: v.severity,
				evidence: v.evidence,
				impact: v.impact,
				recommendation: v.recommendation,
				...(patternRef ? { pattern_ref: patternRef } : {}),
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

interface CriticContextData {
	readonly novelRepo: string
	readonly chapterPath: string
	readonly chapterNumber: number | null
	readonly wordCount: number
	readonly plan: unknown
	readonly pov: string | null
	readonly characterProfile: string | null
	readonly activeStoryLines: readonly unknown[]
	readonly storyLineIndex: readonly unknown[]
	readonly prose: string
	readonly wikiReferences?: unknown
	readonly wikiWarning?: string | null
}

function buildCriticUserMessage(
	ctxData: CriticContextData,
	rubric: string | undefined,
	lang: Language,
): string {
	const closing =
		lang === "zh"
			? "请仅以 ```yaml 围栏的 YAML 审阅块返回。"
			: "Return ONLY a YAML review block between ```yaml fences."
	return [
		`Working language: ${lang}`,
		"Review request:",
		"```",
		JSON.stringify(ctxData, null, 2),
		"```",
		ctxData.wikiWarning ? `\nWarning: ${ctxData.wikiWarning}` : "",
		rubric ? `\nRubric: ${rubric}\n` : "",
		closing,
	].join("\n")
}

function parseCriticYamlResponse(text: string, lang: Language, chapterId: string): CriticReview {
	const yamlBody = extractYamlBlock(text)
	if (yamlBody === null) {
		localizedError(lang, "editor_no_yaml_review", "delegate_to_critic")
	}
	let parsedReview: unknown
	try {
		parsedReview = yaml.load(yamlBody)
	} catch (err) {
		throw new Error(
			`delegate_to_critic (${chapterId}): YAML parse error: ${(err as Error).message}`,
		)
	}
	if (typeof parsedReview !== "object" || parsedReview === null) {
		throw new Error("delegate_to_critic: parsed YAML is not an object.")
	}
	const obj = parsedReview as { issues?: unknown; summary?: unknown }
	return {
		issues: extractIssues(obj.issues),
		summary: typeof obj.summary === "string" ? obj.summary : "",
		atChapter: null,
		reviewedAt: new Date().toISOString(),
	}
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
