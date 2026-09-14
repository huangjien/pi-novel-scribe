/**
 * LLM Wiki — SQLite connection helper. Per ADR-0006 §1, §3.
 *
 * Resolves the wiki DB path from `.pi/settings.json` (key `wikiDbPath`),
 * falling back to the wst snapshot default. Opens a single
 * `DatabaseSync` connection (Node 22+ built-in).
 */

import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite"
import type { WikiTable } from "./schema.ts"

/**
 * `node:sqlite` is a Node 22+ built-in. We import it via
 * `createRequire(import.meta.url)` so the binding goes through Node's
 * CommonJS resolver directly. This bypasses bundlers that strip the
 * `node:` prefix (Vite/Vitest SSR loader, esbuild, etc.) and keeps
 * the import top-level / synchronous — no `await import()`.
 */
const nodeRequire = createRequire(import.meta.url)
const sqliteModule = nodeRequire("node:sqlite") as typeof import("node:sqlite")
export const DatabaseSync = sqliteModule.DatabaseSync
export type { DatabaseSyncType }

export const DEFAULT_WIKI_DB_PATH =
	"/Users/huangjien/workspace/wst/novel_harness/data/snapshots/scribe-2026-08-07-authorconsole-restore.db"

/** Type re-export so callers don't have to import `node:sqlite`. */
export type DatabaseSyncInstance = DatabaseSyncType

/** Read `wikiDbPath` from `.pi/settings.json` if present. Pure. */
export function readWikiDbPathSetting(novelRepoOrCwd: string): string | null {
	const candidates: string[] = []
	let dir = resolve(novelRepoOrCwd)
	for (let i = 0; i < 5; i++) {
		candidates.push(join(dir, ".pi", "settings.json"))
		candidates.push(join(dir, "settings.json"))
		const parent = dirname(dir)
		if (parent === dir) break
		dir = parent
	}
	for (const path of candidates) {
		if (!existsSync(path)) continue
		try {
			const raw = readFileSync(path, "utf8")
			const parsed: unknown = JSON.parse(raw)
			if (typeof parsed !== "object" || parsed === null) continue
			const obj = parsed as { wikiDbPath?: unknown }
			if (typeof obj.wikiDbPath === "string" && obj.wikiDbPath.length > 0) {
				return resolve(dirname(path), obj.wikiDbPath)
			}
		} catch {}
	}
	return null
}

/**
 * Resolve the wiki DB path: `wikiDbPath` setting → `DEFAULT_WIKI_DB_PATH`.
 * The default is intentionally a wst snapshot; never falls back to
 * `sync.db` (wrong schema — sync target for the Flutter reader).
 */
export function resolveWikiDbPath(novelRepoOrCwd: string): string {
	return readWikiDbPathSetting(novelRepoOrCwd) ?? DEFAULT_WIKI_DB_PATH
}

let cachedDb: { path: string; db: DatabaseSyncInstance } | null = null

/**
 * Open (or reuse) a single read-only `DatabaseSync` for the wiki DB.
 * Caches by absolute path; callers must not close the returned handle.
 */
export function openWikiDb(path: string): DatabaseSyncInstance {
	const abs = resolve(path)
	if (cachedDb && cachedDb.path === abs) return cachedDb.db
	if (!existsSync(abs)) {
		throw new Error(
			`wiki DB not found at ${abs}. Set "wikiDbPath" in .pi/settings.json or restore ${DEFAULT_WIKI_DB_PATH}.`,
		)
	}
	const db = new DatabaseSync(abs, { readOnly: true, allowExtension: false })
	cachedDb = { path: abs, db }
	return db
}

/** Test-only: drop the cached connection so tests can swap DBs. */
export function _resetWikiDbCache(): void {
	if (cachedDb) {
		try {
			cachedDb.db.close()
		} catch {
			// ignore close errors on already-closed handles
		}
		cachedDb = null
	}
}

/** SQL fragment selecting the searchable text column for a wiki table. */
export function ftsTableFor(table: WikiTable): string {
	return `${table}_fts`
}

/** SQL fragment joining the base table to its FTS5 shadow for snippets. */
export function baseTableFor(table: WikiTable): string {
	return table
}

/** Searchable columns per table (matches the FTS5 CREATE TABLE statements). */
export function ftsColumnsFor(table: WikiTable): readonly string[] {
	switch (table) {
		case "story_lines":
			return ["title", "description", "content"]
		case "character_templates":
			return ["title", "character_summaries", "character_synopses"]
		case "scene_templates":
			return ["title", "scene_summaries", "scene_synopses"]
		case "writing_patterns":
			return ["title", "summary", "content"]
		case "prompts":
			return ["title", "content"]
	}
}
