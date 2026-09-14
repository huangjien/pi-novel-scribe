/**
 * LLM Wiki — pi tool wrapper. Per ADR-0006 §2.
 *
 * Registers `wiki_search` so any agent can pull the top 5 most
 * thematically aligned reference templates from the wst corpus. Pure
 * tool: no new agent, no new slash command.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"
import { DEFAULT_TABLES, DEFAULT_TOP_N, searchWiki, WIKI_TABLES } from "../wiki/index.ts"

export function registerWikiSearchTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "wiki_search",
		label: "Wiki Search",
		description:
			"Search the reference corpus (story_lines, character_templates, scene_templates, writing_patterns, prompts) for templates thematically aligned with a query. Returns FTS5 candidates and an LLM-reranked top-N with rationale.",
		promptSnippet: "Look up matching reference templates from the LLM wiki.",
		promptGuidelines: [
			"Use wiki_search when a planner/critic needs thematically aligned reference templates for a chapter or character concept.",
			"Always set query to a single sentence describing the chapter plan, character concept, or scene intent.",
			"Top N defaults to 5; raise it (max 20) for broader coverage, lower it for tight top picks.",
			"Tables default to all 5; restrict to one table when you have a narrow question (e.g., only character_templates).",
			"Pass rerank=false only when you want pure FTS5 BM25 results without the LLM call.",
		],
		parameters: Type.Object({
			query: Type.String({
				description: "Chapter plan, character concept, or scene intent (1+ sentence).",
			}),
			tables: Type.Optional(
				Type.Array(Type.Union(WIKI_TABLES.map((t) => Type.Literal(t))), {
					description: "Restrict the search to these tables. Default: all 5.",
				}),
			),
			topN: Type.Optional(
				Type.Number({
					minimum: 1,
					maximum: 20,
					description: `How many picks to return. Default: ${DEFAULT_TOP_N}.`,
				}),
			),
			rerank: Type.Optional(
				Type.Boolean({ description: "Run LLM rerank on top candidates. Default: true." }),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const p = params as {
				query: string
				tables?: readonly (typeof WIKI_TABLES)[number][]
				topN?: number
				rerank?: boolean
			}

			const tables = (
				p.tables && p.tables.length > 0 ? p.tables : DEFAULT_TABLES
			) as readonly (typeof WIKI_TABLES)[number][]
			const topN = p.topN ?? DEFAULT_TOP_N

			const result = await searchWiki(ctx, p.query, {
				tables,
				topN,
				rerank: p.rerank ?? true,
			})

			const pickLines = result.picks
				.map((pick) => `- [${pick.table}] id=${pick.id} — ${pick.rationale}`)
				.join("\n")

			const candidateLines = result.candidates
				.slice(0, 10)
				.map((c) => `- [${c.table}] ${c.title} (bm25=${c.bm25.toFixed(3)})`)
				.join("\n")

			const text = [
				`wiki_search: ${result.picks.length} pick(s) for "${result.query}" (reranked=${result.reranked}).`,
				"",
				"Picks:",
				pickLines || "(none)",
				"",
				"Top candidates:",
				candidateLines || "(none)",
			].join("\n")

			return {
				content: [{ type: "text", text }],
				details: {
					query: result.query,
					picks: result.picks,
					candidates: result.candidates,
					reranked: result.reranked,
				},
			}
		},
	})
}
