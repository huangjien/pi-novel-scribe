/**
 * Continuity agent. Per ADR-0005, this is one of the 5 pre-declared
 * agents. Wired end-to-end in Phase 4 (read-side). Phase 5 will add
 * canon_propose / write-side.
 *
 * Continuity's two modes (Q3 worldview):
 *   - **Inspect / investigate** (read-only): questions about reader
 *     knowledge, character beliefs, scene facts, divergences.
 *   - **Refresh** (mutating, Phase 5+): re-derives beliefs from prose
 *     and writes `state/character-beliefs.yaml` overrides.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"
import {
	deriveCharacterKnowledgeAt,
	deriveReaderKnowledgeAt,
	findDivergences,
	listApprovedChapters,
} from "../novel/continuity.ts"
import { resolveNovelRepo } from "../state/path-resolver.ts"

type Mode = "inspect" | "investigate" | "refresh"

export function registerContinuityAgent(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "delegate_to_continuity",
		label: "Continuity",
		description:
			"Canonical consistency queries. Read-only: inspect_novel_state (what does X know), investigate_continuity_break (find divergence), refresh (Phase 5+: writes back beliefs).",
		promptSnippet: "Read novel state, derive beliefs, find contradictions.",
		promptGuidelines: [
			"Use delegate_to_continuity for inspect_novel_state and investigate_continuity_break routes.",
			"Continuity is read-only in Phase 4. Mutation of canonical state goes through canon_propose (Phase 5).",
		],
		parameters: Type.Object({
			query: Type.String({ description: "What to check or inspect." }),
			mode: Type.Optional(
				Type.Union([Type.Literal("inspect"), Type.Literal("investigate"), Type.Literal("refresh")]),
			),
			character: Type.Optional(
				Type.String({ description: "Character id when querying character knowledge." }),
			),
			chapter_index: Type.Optional(
				Type.Number({ description: "Limit derivation to chapters ≤ N. Defaults to all approved." }),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const p = params as {
				query: string
				mode?: Mode
				character?: string
				chapter_index?: number
			}
			const novelRepo = resolveNovelRepo(ctx.cwd).path
			const mode = p.mode ?? inferMode(p.query)
			const chapterIndex = p.chapter_index ?? Number.POSITIVE_INFINITY
			const character = p.character ?? extractCharacterId(p.query)

			let summary: string
			switch (mode) {
				case "inspect":
					summary = handleInspect(novelRepo, character, chapterIndex, p.query)
					break
				case "investigate":
					summary = handleInvestigate(novelRepo, chapterIndex)
					break
				case "refresh": {
					const { refreshCharacterBeliefs } = await import("../novel/continuity-refresh.ts")
					const result = refreshCharacterBeliefs(novelRepo)
					summary = `Refreshed character beliefs: ${result.derivedCharacters.length} character(s), ${result.approvedChapterCount} approved chapter(s) processed. Wrote: ${result.outputPath}.`
					break
				}
			}

			return {
				content: [{ type: "text", text: summary }],
				details: {
					mode,
					character,
					chapterIndex,
				},
			}
		},
	})
}

function inferMode(query: string): Mode {
	const lower = query.toLowerCase()
	if (lower.includes("contradict") || lower.includes("consistent") || lower.includes("why did")) {
		return "investigate"
	}
	return "inspect"
}

function extractCharacterId(query: string): string | undefined {
	const m = /\b(?:what does|does|do)\s+([a-z][a-z0-9_-]{1,30})\s+(?:know|believe)\b/i.exec(query)
	if (m?.[1]) return m[1]
	const m2 = /\b([a-z][a-z0-9_-]{1,30})'s\s+(?:beliefs?|knowledge)\b/i.exec(query)
	if (m2?.[1]) return m2[1]
	return undefined
}

function handleInspect(
	novelRepo: string,
	character: string | undefined,
	chapterIndex: number,
	_query: string,
): string {
	const approved = listApprovedChapters(novelRepo)
	if (approved.length === 0) {
		return `No approved chapters found in ${novelRepo}.`
	}
	if (character) {
		const knowledge = deriveCharacterKnowledgeAt(novelRepo, chapterIndex, character)
		return `${character} has witnessed ${knowledge.length} scene-fact(s) through chapter ${Number.isFinite(chapterIndex) ? chapterIndex : "?"}: ${knowledge.join(", ") || "(none)"}.`
	}
	const reader = deriveReaderKnowledgeAt(novelRepo, chapterIndex)
	return `Reader knows ${reader.length} scene-fact(s) across ${approved.length} approved chapters: ${reader.join(", ") || "(none)"}.`
}

function handleInvestigate(novelRepo: string, chapterIndex: number): string {
	const divergences = findDivergences(novelRepo, chapterIndex)
	if (divergences.length === 0)
		return "No divergences detected between authored overrides and derived character knowledge."
	const lines = divergences.map(
		(d) => `- [${d.type}] ${d.character}: "${d.belief}" (at chapter ${d.at_chapter})`,
	)
	return `Found ${divergences.length} divergence(s):\n${lines.join("\n")}`
}
