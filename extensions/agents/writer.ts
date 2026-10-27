/**
 * Writer agent. Per ADR-0005, this is one of the 5 pre-declared agents.
 * Wired end-to-end in Phase 3 — reads scene context (Q7), calls the
 * active LLM, writes the resulting prose into the chapter file, and
 * transitions `status: planned → human_editing`.
 *
 * Out of scope for Phase 3:
 *   - The proposed_state_changes flow (Q8 approval gate). For now, prose
 *     lands in human_editing; Continuity / canon_propose will land in
 *     Phase 5.
 *   - Multi-chapter scoped writing. Phase 3 is single-chapter.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
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
import { composeSceneContext, isDraftable } from "../novel/context.ts"
import {
	injectWikiReferences,
	validateTemplateRefs,
	WRITER_TABLES,
	writerWikiQuery,
} from "../wiki/context.ts"
import { applyStatus, mergeProseIntoChapter } from "../workflow/status.ts"

export function registerWriterAgent(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "delegate_to_writer",
		label: toolStrings(DEFAULT_LANGUAGE, "delegate_to_writer").label,
		description: toolStrings(DEFAULT_LANGUAGE, "delegate_to_writer").description,
		promptSnippet: toolStrings(DEFAULT_LANGUAGE, "delegate_to_writer").promptSnippet,
		promptGuidelines: [...toolStrings(DEFAULT_LANGUAGE, "delegate_to_writer").promptGuidelines],
		parameters: Type.Object({
			chapter_id: Type.String({
				description:
					"Chapter filename (e.g. 0005.md) relative to novelRepo/chapters/, or an absolute path.",
			}),
			input: Type.Optional(
				Type.String({ description: "Optional user note (POV hint, scene focus, etc.)." }),
			),
			language: Type.Optional(
				Type.Union([Type.Literal("en"), Type.Literal("zh")], {
					description:
						"Override the working language for this call. Falls back to chapter frontmatter / settings / auto-detect.",
				}),
			),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const p = params as { chapter_id: string; input?: string; language?: Language }
			const chapterArg = p.chapter_id
			if (!ctx.model) {
				localizedError(DEFAULT_LANGUAGE, "editor_no_model", "delegate_to_writer")
			}

			const scene = composeSceneContext({
				chapterPath: chapterArg,
				cwd: ctx.cwd,
			})

			if (!isDraftable(scene.status)) {
				localizedError(DEFAULT_LANGUAGE, "editor_chapter_approved", [
					"delegate_to_writer",
					scene.status ?? "(unknown)",
				])
			}

			const lang = resolveLanguage(ctx, {
				flag: p.language,
				chapterPath: chapterArg,
			})

			if (Object.keys(scene.plan).length > 0) {
				enforcePlanTemplateRefs(lang, scene.plan)
			}

			const wiki = await injectWikiReferences(ctx, writerWikiQuery(scene), {
				tables: WRITER_TABLES,
				language: lang,
			})

			const promptBody = loadAgentPrompt("writer", lang)
			const userMessage = buildWriterUserMessage(
				{
					chapterPath: scene.chapterPath,
					chapterNumber: scene.chapterNumber,
					pov: scene.pov,
					plan: scene.plan,
					characterProfile: scene.characterProfile,
					wikiReferences: wiki.wikiReferences,
				},
				wiki.wikiWarning,
				p.input,
				lang,
			)

			const result = await ctx.modelRegistry.complete(
				ctx.model,
				{
					systemPrompt: promptBody,
					messages: [{ role: "user", content: userMessage, timestamp: Date.now() }],
				},
				{ signal },
			)

			const proseParts = result.content
				.filter((block: { type: string }) => block.type === "text")
				.map((block: { type: string; text?: string }) => block.text ?? "")
			const finalProse = proseParts.join("").trim()
			if (finalProse.length === 0) {
				localizedError(lang, "editor_no_prose", "delegate_to_writer")
			}

			mergeProseIntoChapter(scene.chapterPath, finalProse)
			applyStatus(scene.chapterPath, "human_editing")

			const wordCount = finalProse.split(/\s+/).length
			const statusLabel = statusDisplay(lang, "human_editing")
			return {
				content: [
					{
						type: "text",
						text:
							lang === "zh"
								? `已为 ${scene.chapterPath} 起草 ${wordCount} 字。状态 → ${statusLabel}。`
								: `Drafted ${wordCount} words into ${scene.chapterPath}. Status → ${statusLabel}.`,
					},
				],
				details: {
					chapterPath: scene.chapterPath,
					wordCount,
					pov: scene.pov,
					language: lang,
					wikiPicks: wiki.wikiReferences ? wiki.wikiReferences.picks.length : 0,
					wikiDegraded: wiki.wikiReferences === null,
				},
			}
		},
	})
}

// Re-export so loader paths work even though we already use registerWriterAgent above.
export { isDraftable }

interface WriterPacket {
	readonly chapterPath: string
	readonly chapterNumber: number | null
	readonly pov: string | null
	readonly plan: Record<string, unknown>
	readonly characterProfile: string | null
	readonly wikiReferences: unknown
}

function enforcePlanTemplateRefs(lang: Language, plan: Record<string, unknown>): void {
	const check = validateTemplateRefs(plan)
	if (!check.valid) {
		localizedError(lang, "plan_missing_template_refs", "delegate_to_writer")
	}
}

function buildWriterUserMessage(
	packet: WriterPacket,
	wikiWarning: string | null,
	userNote: string | undefined,
	lang: Language,
): string {
	const closing =
		lang === "zh"
			? "\n请用中文撰写本章节正文，使用 @scene 标记划分场景。仅输出正文。"
			: "\nWrite the chapter prose now. Use @scene markers to delineate scenes. Output ONLY prose."
	return [
		`Working language: ${lang}`,
		"Scene context (deterministic, Q7 + Q21):",
		"```",
		JSON.stringify(packet, null, 2),
		"```",
		wikiWarning ? `\nWarning: ${wikiWarning}` : "",
		userNote ? `\nUser note: ${userNote}` : "",
		closing,
	].join("\n")
}
