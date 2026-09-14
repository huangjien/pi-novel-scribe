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

import { readFileSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"
import { composeSceneContext, isDraftable } from "../novel/context.ts"
import { applyStatus } from "../workflow/status.ts"

const PROMPT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../../prompts/writer.md")

function loadWriterPromptBody(): string {
	const raw = readFileSync(PROMPT_PATH, "utf8")
	const sep = raw.indexOf("\n---")
	if (sep === -1) return raw
	const second = raw.indexOf("\n---", sep + 4)
	if (second === -1) return raw.slice(sep + 4)
	return raw.slice(second + 5).trim()
}

export function registerWriterAgent(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "delegate_to_writer",
		label: "Writer",
		description:
			"Draft prose for a chapter. Reads scene context (Q7) deterministically, calls the LLM with the Writer prompt, writes prose into the chapter file, and transitions status → human_editing.",
		promptSnippet: "Generate chapter prose from the active scene context.",
		promptGuidelines: [
			"Use delegate_to_writer only when the chapter has an approved or provisional plan.",
			"Always set chapter_id (filename or absolute path) so the Writer knows what to draft.",
			"After drafting, the canonical workflow continues to Continuity validation (Phase 5+).",
		],
		parameters: Type.Object({
			chapter_id: Type.String({
				description:
					"Chapter filename (e.g. 0005.md) relative to novelRepo/chapters/, or an absolute path.",
			}),
			input: Type.Optional(
				Type.String({ description: "Optional user note (POV hint, scene focus, etc.)." }),
			),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const p = params as { chapter_id: string; input?: string }
			const chapterArg = p.chapter_id
			if (!ctx.model) {
				throw new Error("delegate_to_writer: no active model in this session.")
			}

			const scene = composeSceneContext({
				chapterPath: chapterArg,
				cwd: ctx.cwd,
			})

			if (!isDraftable(scene.status)) {
				throw new Error(
					`delegate_to_writer: chapter is ${scene.status} — refusing to overwrite approved canon.`,
				)
			}

			const promptBody = loadWriterPromptBody()
			const userMessage = [
				"Scene context (deterministic, Q7):",
				"```",
				JSON.stringify(
					{
						chapterPath: scene.chapterPath,
						chapterNumber: scene.chapterNumber,
						pov: scene.pov,
						plan: scene.plan,
						characterProfile: scene.characterProfile,
					},
					null,
					2,
				),
				"```",
				p.input ? `\nUser note: ${p.input}` : "",
				"\nWrite the chapter prose now. Use @scene markers to delineate scenes. Output ONLY prose.",
			].join("\n")

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
				throw new Error("delegate_to_writer: LLM produced no prose.")
			}

			writeFileSync(scene.chapterPath, finalProse, "utf8")
			applyStatus(scene.chapterPath, "human_editing")

			const wordCount = finalProse.split(/\s+/).length
			return {
				content: [
					{
						type: "text",
						text: `Drafted ${wordCount} words into ${scene.chapterPath}. Status → human_editing.`,
					},
				],
				details: {
					chapterPath: scene.chapterPath,
					wordCount,
					pov: scene.pov,
				},
			}
		},
	})
}

// Re-export so loader paths work even though we already use registerWriterAgent above.
export { isDraftable }

// (Internal — kept to avoid unused-import warnings if writer.ts is imported standalone)
void join
void isAbsolute
