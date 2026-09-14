/**
 * LLM Wiki — pi tool wrapper. Per ADR-0006 §2.
 *
 * Registers `wiki_search` so any agent can pull the top 5 most
 * thematically aligned reference templates from the wst corpus. Pure
 * tool: no new agent, no new slash command.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"
import { DEFAULT_LANGUAGE, type Language, resolveLanguage, toolStrings } from "../i18n/index.ts"
import { DEFAULT_TABLES, DEFAULT_TOP_N, searchWiki, WIKI_TABLES } from "../wiki/index.ts"

export function registerWikiSearchTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "wiki_search",
		label: toolStrings(DEFAULT_LANGUAGE, "wiki_search").label,
		description: toolStrings(DEFAULT_LANGUAGE, "wiki_search").description,
		promptSnippet: toolStrings(DEFAULT_LANGUAGE, "wiki_search").promptSnippet,
		promptGuidelines: [...toolStrings(DEFAULT_LANGUAGE, "wiki_search").promptGuidelines],
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
			language: Type.Optional(
				Type.Union([Type.Literal("en"), Type.Literal("zh")], {
					description: "Override the working language for this call.",
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const p = params as {
				query: string
				tables?: readonly (typeof WIKI_TABLES)[number][]
				topN?: number
				rerank?: boolean
				language?: Language
			}

			const lang = resolveLanguage(ctx, { flag: p.language, cwd: ctx.cwd })
			const tables = (
				p.tables && p.tables.length > 0 ? p.tables : DEFAULT_TABLES
			) as readonly (typeof WIKI_TABLES)[number][]
			const topN = p.topN ?? DEFAULT_TOP_N

			const result = await searchWiki(ctx, p.query, {
				tables,
				topN,
				rerank: p.rerank ?? true,
			})

			const text = formatWikiResult(result, lang)

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

function formatWikiResult(result: Awaited<ReturnType<typeof searchWiki>>, lang: Language): string {
	const pickLines = result.picks
		.map((pick) => `- [${pick.table}] id=${pick.id} — ${pick.rationale}`)
		.join("\n")
	const candidateLines = result.candidates
		.slice(0, 10)
		.map((c) => `- [${c.table}] ${c.title} (bm25=${c.bm25.toFixed(3)})`)
		.join("\n")
	const heading = lang === "zh" ? "维基检索" : "wiki_search"
	const picksHeader = lang === "zh" ? "挑选结果：" : "Picks:"
	const candidatesHeader = lang === "zh" ? "热门候选：" : "Top candidates:"
	const noneLabel = lang === "zh" ? "（无）" : "(none)"
	const summary =
		lang === "zh"
			? `${heading}：针对「${result.query}」共 ${result.picks.length} 个选择（${result.reranked ? "已重排" : "未重排"}）。`
			: `${heading}: ${result.picks.length} pick(s) for "${result.query}" (reranked=${result.reranked}).`
	return [
		summary,
		"",
		picksHeader,
		pickLines || noneLabel,
		"",
		candidatesHeader,
		candidateLines || noneLabel,
	].join("\n")
}
