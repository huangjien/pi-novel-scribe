/**
 * LLM Wiki — FTS5 BM25 candidate retrieval. Per ADR-0006 §4 step 1.
 *
 * Pure SQL: queries each table's `*_fts` virtual table, returns top
 * candidates ordered by BM25 score. No LLM involvement.
 */

import type { DatabaseSync } from "node:sqlite"
import { baseTableFor, ftsColumnsFor, ftsTableFor } from "./db.ts"
import type { WikiCandidate, WikiTable } from "./schema.ts"

/**
 * Escape a user query for FTS5 MATCH. We split on whitespace and
 * double-quote each token; bare-word queries (e.g., "boat") match as
 * prefix; quoted tokens match exactly. This is a pragmatic balance:
 * users do not write FTS5 syntax, but we still avoid SQL-injection
 * vectors.
 */
export function buildFtsQuery(rawQuery: string): string {
	const tokens = rawQuery
		.split(/\s+/)
		.map((t) => t.trim())
		.filter((t) => t.length > 0)
		.map((t) => t.replace(/"/g, '""'))
	if (tokens.length === 0) return ""
	return tokens.map((t) => `"${t}"*`).join(" ")
}

/** Per-table snippet column (the prose the FTS5 shadow mirrors). Exported so the vector-rerank helper (`extensions/wiki/vector.ts`) can SELECT the same column without duplicating the per-table map. */
export function snippetColumnFor(table: WikiTable): string {
	switch (table) {
		case "story_lines":
			return "content"
		case "character_templates":
			return "character_synopses"
		case "scene_templates":
			return "scene_synopses"
		case "writing_patterns":
			return "content"
		case "prompts":
			return "content"
	}
}

/** Per-table summary column. */
/** Per-table summary column. Exported so the vector-rerank helper (`extensions/wiki/vector.ts`) can SELECT the same column without duplicating the per-table map. */
export function summaryColumnFor(table: WikiTable): string {
	switch (table) {
		case "story_lines":
			return "description"
		case "character_templates":
			return "character_summaries"
		case "scene_templates":
			return "scene_summaries"
		case "writing_patterns":
			return "summary"
		case "prompts":
			return "content"
	}
}

/** Per-table language column. Exported for the same reason as `snippetColumnFor` / `summaryColumnFor`. */
export function languageColumnFor(table: WikiTable): string {
	switch (table) {
		case "story_lines":
			return "language"
		case "character_templates":
		case "scene_templates":
			return "language_code"
		case "writing_patterns":
			return "language_code"
		case "prompts":
			return "language"
	}
}

/**
 * Run an FTS5 BM25 search against one table. Returns up to `limit`
 * candidates ordered by score (lower BM25 = better).
 */
export function ftsSearch(
	db: DatabaseSync,
	table: WikiTable,
	query: string,
	limit: number,
): readonly WikiCandidate[] {
	const ftsQuery = buildFtsQuery(query)
	if (!ftsQuery) return []

	const fts = ftsTableFor(table)
	const base = baseTableFor(table)
	const snippetCol = snippetColumnFor(table)
	const summaryCol = summaryColumnFor(table)
	const langCol = languageColumnFor(table)
	const idCol = "id"

	const sql = `
		SELECT
			b.${idCol} AS id,
			b.title AS title,
			COALESCE(substr(b.${summaryCol}, 1, 240), '') AS summary,
			COALESCE(substr(b.${snippetCol}, 1, 320), '') AS snippet,
			COALESCE(b.${langCol}, '') AS language,
			bm25(${fts}) AS bm25
		FROM ${fts} f
		JOIN ${base} b ON b.rowid = f.rowid
		WHERE ${fts} MATCH ?
		ORDER BY bm25(${fts}) ASC
		LIMIT ?
	`

	const stmt = db.prepare(sql)
	const rows = stmt.all(ftsQuery, limit) as Array<{
		id: string
		title: string
		summary: string
		snippet: string
		language: string
		bm25: number
	}>

	return rows.map((r) => ({
		table,
		id: r.id,
		title: r.title,
		summary: r.summary,
		snippet: r.snippet,
		language: r.language,
		bm25: r.bm25,
	}))
}

/**
 * Search across multiple wiki tables; returns candidates interleaved
 * by BM25 score.
 */
export function ftsSearchAll(
	db: DatabaseSync,
	query: string,
	tables: readonly WikiTable[],
	perTableLimit: number,
): readonly WikiCandidate[] {
	const out: WikiCandidate[] = []
	for (const table of tables) {
		out.push(...ftsSearch(db, table, query, perTableLimit))
	}
	out.sort((a, b) => a.bm25 - b.bm25)
	return out
}

/** Schema introspector — used by tests to assert FTS5 columns. */
export function wikiTableFtsColumns(table: WikiTable): readonly string[] {
	return ftsColumnsFor(table)
}
