/**
 * LLM Wiki — schema types. Per ADR-0006.
 *
 * The wiki is a read-only consumer of the wst (NovelScribe) FastAPI
 * backend's SQLite reference corpus. It exposes narrative-structure
 * templates, character archetypes, scene archetypes, writing patterns,
 * and prompts.
 *
 * This file declares the shape of wiki items, candidate matches, and
 * the public `searchWiki` return type. No I/O.
 */

export const WIKI_TABLES = [
	"story_lines",
	"character_templates",
	"scene_templates",
	"writing_patterns",
	"prompts",
] as const

export const DEFAULT_TABLES: readonly WikiTable[] = WIKI_TABLES

export const DEFAULT_TOP_N = 5
export const DEFAULT_PER_TABLE_LIMIT = 15

export type WikiTable = (typeof WIKI_TABLES)[number]

/** A single wiki row reduced to the fields the tool surfaces. */
export interface WikiItem {
	readonly table: WikiTable
	readonly id: string
	readonly title: string
	readonly summary: string
	readonly snippet: string
	readonly language: string
	readonly meta: Readonly<Record<string, string>>
}

/** A FTS5 candidate retrieved before rerank. */
export interface WikiCandidate {
	readonly table: WikiTable
	readonly id: string
	readonly title: string
	readonly summary: string
	readonly snippet: string
	readonly language: string
	readonly bm25: number
}

/** One LLM rerank pick — top item with rationale. */
export interface WikiPick {
	readonly table: WikiTable
	readonly id: string
	readonly rationale: string
}

/** Public return shape of `searchWiki`. */
export interface WikiResult {
	readonly query: string
	readonly candidates: readonly WikiCandidate[]
	readonly picks: readonly WikiPick[]
	readonly reranked: boolean
}

/** Shape we ask the LLM to return during rerank. */
export interface RerankLLMResponse {
	readonly picks: readonly { table: WikiTable; id: string; rationale: string }[]
}
