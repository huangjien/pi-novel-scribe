/**
 * LLM Wiki — public entry point. Per ADR-0006 §1.
 *
 * `searchWiki(ctx, query, options)` is the single function agents
 * (Planner, Writer, Critic) call to consult the reference corpus.
 */

import type { Model } from "@earendil-works/pi-ai"
import type { ExtensionContext, ModelRegistry } from "@earendil-works/pi-coding-agent"
import { openWikiDb, resolveWikiDbPath } from "./db.ts"
import { ftsSearchAll } from "./fts.ts"
import { rerankWithLLM } from "./rerank.ts"
import {
	DEFAULT_PER_TABLE_LIMIT,
	DEFAULT_TABLES,
	DEFAULT_TOP_N,
	type WikiResult,
	type WikiTable,
} from "./schema.ts"
import { vectorSearchAll } from "./vector.ts"

export interface SearchWikiOptions {
	readonly tables?: readonly WikiTable[]
	readonly topN?: number
	readonly rerank?: boolean
	readonly perTableLimit?: number
}

/**
 * Resolve the wiki DB, run FTS5, optionally rerank via LLM. Returns
 * a structured `WikiResult` with both raw candidates and final picks.
 */
export async function searchWiki(
	ctx: ExtensionContext,
	query: string,
	options: SearchWikiOptions = {},
): Promise<WikiResult> {
	const trimmed = query.trim()
	if (trimmed.length === 0) {
		return { query: trimmed, candidates: [], picks: [], reranked: false }
	}

	const tables = options.tables ?? DEFAULT_TABLES
	const topN = clamp(options.topN ?? DEFAULT_TOP_N, 1, 20)
	const rerank = options.rerank ?? true
	const perTableLimit = options.perTableLimit ?? Math.max(DEFAULT_PER_TABLE_LIMIT, topN * 3)

	const dbPath = resolveWikiDbPath(ctx.cwd)
	const db = openWikiDb(dbPath)
	const ftsCandidates = ftsSearchAll(db, trimmed, tables, perTableLimit)
	const vecCandidates = vectorSearchAll(db, trimmed, tables, perTableLimit)
	const candidates = mergeCandidateSets(ftsCandidates, vecCandidates)

	if (!rerank) {
		return {
			query: trimmed,
			candidates: candidates.slice(0, topN),
			picks: candidates.slice(0, topN).map((c) => ({
				table: c.table,
				id: c.id,
				rationale: `bm25=${c.bm25.toFixed(3)}`,
			})),
			reranked: false,
		}
	}

	if (!ctx.model) {
		throw new Error(
			"wiki rerank requires an active model; pass options.modelId or run inside a pi session with a model bound.",
		)
	}

	const picks = await rerankWithLLM(
		ctx.modelRegistry as ModelRegistry,
		ctx.model as Model<never>,
		trimmed,
		candidates,
		topN,
	)
	return { query: trimmed, candidates, picks, reranked: true }
}

function clamp(n: number, lo: number, hi: number): number {
	if (Number.isNaN(n)) return lo
	return Math.min(hi, Math.max(lo, n))
}

/**
 * Merge FTS5 + vector candidate sets, deduped by (table, id), with
 * FTS5 entries kept first (and at their original index when they also
 * appear in the vector set — FTS5 is the historical default, so its
 * ordering is treated as canonical).
 */
function mergeCandidateSets(
	ftsCandidates: readonly import("./schema.ts").WikiCandidate[],
	vecCandidates: readonly import("./schema.ts").WikiCandidate[],
): import("./schema.ts").WikiCandidate[] {
	const seen = new Set<string>()
	const out: import("./schema.ts").WikiCandidate[] = []
	for (const c of ftsCandidates) {
		const key = `${c.table}\u0000${c.id}`
		if (seen.has(key)) continue
		seen.add(key)
		out.push(c)
	}
	for (const c of vecCandidates) {
		const key = `${c.table}\u0000${c.id}`
		if (seen.has(key)) continue
		seen.add(key)
		out.push(c)
	}
	return out
}

export { openWikiDb, resolveWikiDbPath } from "./db.ts"
export { buildFtsQuery, ftsSearch, ftsSearchAll } from "./fts.ts"
export {
	buildRerankPrompt,
	parseRerankResponse,
	rerankWithLLM,
} from "./rerank.ts"
export type {
	RerankLLMResponse,
	WikiCandidate,
	WikiItem,
	WikiPick,
	WikiResult,
	WikiTable,
} from "./schema.ts"
export {
	DEFAULT_PER_TABLE_LIMIT,
	DEFAULT_TABLES,
	DEFAULT_TOP_N,
	WIKI_TABLES,
} from "./schema.ts"
