/**
 * LLM Wiki — session-scoped rerank cache + budget. Per ADR-0008 §5 (Q23).
 *
 * The cache is **in-process only**: keyed by
 * `(query, tables, topN, dbPath)` and validated against the wiki DB's
 * mtime so a refreshed corpus invalidates entries. The novel repo is
 * never written — a restart simply re-reranks (bounded by the budget).
 *
 * The rerank budget caps LLM rerank calls per packet assembly (default
 * 3, one per query class); overflow falls back to BM25 order.
 */

import { statSync } from "node:fs"
import type { WikiResult, WikiTable } from "./schema.ts"

export const RERANK_BUDGET_PER_ASSEMBLY = 3

interface CacheEntry {
	readonly dbMtimeMs: number
	readonly result: WikiResult
}

const cache = new Map<string, CacheEntry>()

/** mtime of the wiki DB in ms; null when the file is missing/unreadable. */
export function dbMtimeMs(dbPath: string): number | null {
	try {
		return statSync(dbPath).mtimeMs
	} catch {
		return null
	}
}

/** Stable cache key for a wiki lookup. Tables are sorted so order never matters. */
export function wikiCacheKey(
	query: string,
	tables: readonly WikiTable[],
	topN: number,
	dbPath: string,
): string {
	return JSON.stringify({ query, tables: [...tables].sort(), topN, dbPath })
}

/** Return the cached result if present AND the DB has not changed since. */
export function getCachedWikiResult(key: string, currentMtimeMs: number): WikiResult | null {
	const entry = cache.get(key)
	if (!entry) return null
	if (entry.dbMtimeMs !== currentMtimeMs) {
		cache.delete(key)
		return null
	}
	return entry.result
}

export function setCachedWikiResult(key: string, mtimeMs: number, result: WikiResult): void {
	cache.set(key, { dbMtimeMs: mtimeMs, result })
}

/** Test-only: drop all cached entries. */
export function clearWikiCache(): void {
	cache.clear()
}

export interface RerankBudget {
	/** Consume one rerank ticket; false when the budget is exhausted. */
	tryConsume(): boolean
	remaining(): number
}

/**
 * Per-packet-assembly budget (ADR-0008 §5). Each assembly creates one
 * budget; a single-query assembly can consume at most one ticket.
 */
export function createRerankBudget(max: number = RERANK_BUDGET_PER_ASSEMBLY): RerankBudget {
	let used = 0
	return {
		tryConsume() {
			if (used >= max) return false
			used++
			return true
		},
		remaining() {
			return max - used
		},
	}
}
