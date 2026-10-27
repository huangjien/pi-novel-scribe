/**
 * Cosine-vector rerank helper. Per ADR-0012 Q30/Q31 (Phase 14).
 *
 * Reads the `embedding TEXT` column on a wiki table, computes cosine
 * similarity against the query vector (built with the same hash scheme
 * as `tests/_helpers/wikiFixture.ts`), and returns top-N candidates.
 *
 * This helper is opt-in: it is wired into the public `searchWiki` only
 * if the Phase 14 embedding eval (`tests/embedding-eval.test.ts`)
 * passes the Q31 tie threshold. Below tie → documented "not adopted"
 * and `vector.ts` stays as an unused-but-tested module.
 */

import type { DatabaseSync } from "node:sqlite"
import { languageColumnFor, snippetColumnFor, summaryColumnFor } from "./fts.ts"
import type { WikiCandidate, WikiTable } from "./schema.ts"

/**
 * Mirror of `tests/_helpers/wikiFixture.ts` `fixtureVectorize`. Kept in
 * sync deliberately — both functions are pure, deterministic, and
 * produce identical vectors for identical input.
 */
const VOCAB_SIZE = 32

/** Tokenize and hash into a 32-dim bag-of-hashes vector, then L2-normalize. */
export function textToVector(text: string): number[] {
	const vec = new Array<number>(VOCAB_SIZE).fill(0)
	for (const word of text.toLowerCase().split(/\W+/)) {
		if (word.length < 3) continue
		let hash = 0
		for (let i = 0; i < word.length; i++) {
			hash = (hash * 31 + word.charCodeAt(i)) >>> 0
		}
		const idx = hash % VOCAB_SIZE
		vec[idx] = (vec[idx] ?? 0) + 1
	}
	let norm = 0
	for (const v of vec) norm += v * v
	norm = Math.sqrt(norm)
	if (norm === 0) return vec
	for (let i = 0; i < vec.length; i++) vec[i] = (vec[i] ?? 0) / norm
	return vec
}

/** Cosine similarity between two unit-length vectors. */
export function cosine(a: number[], b: number[]): number {
	let dot = 0
	for (let i = 0; i < a.length; i++) dot += (a[i] ?? 0) * (b[i] ?? 0)
	return dot
}

interface RawEmbeddingRow {
	readonly id: string
	readonly title: string
	readonly summary: string
	readonly snippet: string
	readonly language: string
	readonly embedding: string | null
}

/**
 * Return up to `limit` candidates from `table` ranked by cosine
 * similarity between the query vector and each row's `embedding`
 * column. Rows with a missing/null/empty `embedding` are skipped.
 */
export function vectorSearch(
	db: DatabaseSync,
	table: WikiTable,
	query: string,
	limit: number,
): readonly WikiCandidate[] {
	const queryVec = textToVector(query)
	if (queryVec.every((v) => v === 0)) return []

	const rows = db
		.prepare(
			`SELECT id, title, ${summaryColumnFor(table)} AS summary, ${snippetColumnFor(table)} AS snippet, ${languageColumnFor(table)} AS language, embedding FROM ${table} WHERE embedding IS NOT NULL AND embedding != ''`,
		)
		.all() as unknown as RawEmbeddingRow[]

	const scored: Array<{ row: RawEmbeddingRow; score: number }> = []
	for (const row of rows) {
		if (!row.embedding) continue
		const rowVec = parseEmbedding(row.embedding)
		if (!rowVec || rowVec.length === 0) continue
		const score = cosine(queryVec, rowVec)
		scored.push({ row, score })
	}
	scored.sort((a, b) => b.score - a.score)

	const out: WikiCandidate[] = []
	for (let i = 0; i < scored.length && i < limit; i++) {
		const entry = scored[i]
		if (!entry) continue
		const { row, score } = entry
		out.push({
			table,
			id: row.id,
			title: row.title,
			summary: row.summary,
			snippet: row.snippet,
			language: row.language,
			bm25: score,
		})
	}
	return out
}

/** Search across multiple tables; results merged and ranked by score. */
export function vectorSearchAll(
	db: DatabaseSync,
	query: string,
	tables: readonly WikiTable[],
	perTableLimit: number,
): readonly WikiCandidate[] {
	const out: WikiCandidate[] = []
	for (const table of tables) {
		out.push(...vectorSearch(db, table, query, perTableLimit))
	}
	out.sort((a, b) => b.bm25 - a.bm25)
	return out
}

function parseEmbedding(raw: string): number[] | null {
	try {
		const parsed = JSON.parse(raw)
		if (!Array.isArray(parsed)) return null
		const vec: number[] = []
		for (const v of parsed) {
			if (typeof v !== "number" || !Number.isFinite(v)) return null
			vec.push(v)
		}
		return vec
	} catch {
		return null
	}
}
