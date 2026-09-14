/**
 * Tests for extensions/wiki/ — pure unit tests using an in-memory
 * SQLite DB with the same FTS5 schema as the wst snapshot.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ExtensionContext } from "@earendil-works/pi-coding-agent"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	_resetWikiDbCache,
	DatabaseSync,
	type DatabaseSyncInstance,
	openWikiDb,
	resolveWikiDbPath,
} from "../extensions/wiki/db.ts"
import { buildFtsQuery, ftsSearch, ftsSearchAll } from "../extensions/wiki/fts.ts"
import { searchWiki } from "../extensions/wiki/index.ts"
import { buildRerankPrompt, parseRerankResponse } from "../extensions/wiki/rerank.ts"
import { WIKI_TABLES } from "../extensions/wiki/schema.ts"

const FIXTURE_SCHEMA_SQL = `
CREATE TABLE story_lines (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    content TEXT,
    language TEXT NOT NULL DEFAULT 'en',
    locked INTEGER NOT NULL DEFAULT 0,
    is_public INTEGER NOT NULL DEFAULT 1,
    owner_id TEXT,
    embedding TEXT,
    created_at TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'supabase'
);
CREATE VIRTUAL TABLE story_lines_fts USING fts5(
    title, description, content,
    content='story_lines', content_rowid='rowid'
);
CREATE TRIGGER story_lines_ai AFTER INSERT ON story_lines BEGIN
    INSERT INTO story_lines_fts(rowid, title, description, content)
    VALUES (new.rowid, new.title, new.description, new.content);
END;
CREATE TRIGGER story_lines_ad AFTER DELETE ON story_lines BEGIN
    INSERT INTO story_lines_fts(story_lines_fts, rowid, title, description, content)
    VALUES ('delete', old.rowid, old.title, old.description, old.content);
END;
CREATE TRIGGER story_lines_au AFTER UPDATE ON story_lines BEGIN
    INSERT INTO story_lines_fts(story_lines_fts, rowid, title, description, content)
    VALUES ('delete', old.rowid, old.title, old.description, old.content);
    INSERT INTO story_lines_fts(rowid, title, description, content)
    VALUES (new.rowid, new.title, new.description, new.content);
END;

CREATE TABLE character_templates (
    id TEXT PRIMARY KEY,
    idx INTEGER NOT NULL,
    title TEXT NOT NULL,
    character_summaries TEXT,
    character_synopses TEXT,
    language_code TEXT NOT NULL DEFAULT 'en',
    embedding TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'supabase'
);
CREATE VIRTUAL TABLE character_templates_fts USING fts5(
    title, character_summaries, character_synopses,
    content='character_templates', content_rowid='rowid'
);
CREATE TRIGGER character_templates_ai AFTER INSERT ON character_templates BEGIN
    INSERT INTO character_templates_fts(rowid, title, character_summaries, character_synopses)
    VALUES (new.rowid, new.title, new.character_summaries, new.character_synopses);
END;
CREATE TRIGGER character_templates_ad AFTER DELETE ON character_templates BEGIN
    INSERT INTO character_templates_fts(character_templates_fts, rowid, title, character_summaries, character_synopses)
    VALUES ('delete', old.rowid, old.title, old.character_summaries, old.character_synopses);
END;
CREATE TRIGGER character_templates_au AFTER UPDATE ON character_templates BEGIN
    INSERT INTO character_templates_fts(character_templates_fts, rowid, title, character_summaries, character_synopses)
    VALUES ('delete', old.rowid, old.title, old.character_summaries, old.character_synopses);
    INSERT INTO character_templates_fts(rowid, title, character_summaries, character_synopses)
    VALUES (new.rowid, new.title, new.character_summaries, new.character_synopses);
END;

CREATE TABLE scene_templates (
    id TEXT PRIMARY KEY,
    idx INTEGER NOT NULL,
    title TEXT NOT NULL,
    scene_summaries TEXT,
    scene_synopses TEXT,
    language_code TEXT NOT NULL DEFAULT 'en',
    embedding TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'supabase'
);
CREATE VIRTUAL TABLE scene_templates_fts USING fts5(
    title, scene_summaries, scene_synopses,
    content='scene_templates', content_rowid='rowid'
);
CREATE TRIGGER scene_templates_ai AFTER INSERT ON scene_templates BEGIN
    INSERT INTO scene_templates_fts(rowid, title, scene_summaries, scene_synopses)
    VALUES (new.rowid, new.title, new.scene_summaries, new.scene_synopses);
END;

CREATE TABLE writing_patterns (
    id TEXT PRIMARY KEY,
    idx INTEGER NOT NULL,
    title TEXT NOT NULL,
    summary TEXT,
    content TEXT,
    language_code TEXT NOT NULL DEFAULT 'en',
    embedding TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'supabase'
);
CREATE VIRTUAL TABLE writing_patterns_fts USING fts5(
    title, summary, content,
    content='writing_patterns', content_rowid='rowid'
);
CREATE TRIGGER writing_patterns_ai AFTER INSERT ON writing_patterns BEGIN
    INSERT INTO writing_patterns_fts(rowid, title, summary, content)
    VALUES (new.rowid, new.title, new.summary, new.content);
END;

CREATE TABLE prompts (
    id TEXT PRIMARY KEY,
    idx INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT 'en',
    embedding TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'supabase'
);
CREATE VIRTUAL TABLE prompts_fts USING fts5(
    title, content,
    content='prompts', content_rowid='rowid'
);
CREATE TRIGGER prompts_ai AFTER INSERT ON prompts BEGIN
    INSERT INTO prompts_fts(rowid, title, content)
    VALUES (new.rowid, new.title, new.content);
END;
`

function seedFixture(db: DatabaseSyncInstance): void {
	db.exec(FIXTURE_SCHEMA_SQL)

	const insertStoryLine = db.prepare(
		`INSERT INTO story_lines (id, title, description, content, language, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
	)
	insertStoryLine.run(
		"sl-001",
		"Fichtean Curve Crisis-Driven Narrative Structure",
		"High-intensity, crisis-driven narrative structure that removes slow setup",
		"The Fichtean Curve starts with immediate action and escalates through multiple crises. Each crisis must raise stakes.",
		"en",
		"2026-01-01T00:00:00Z",
	)
	insertStoryLine.run(
		"sl-002",
		"Dan Harmon Story Circle",
		"Circular, character-centered narrative structure",
		"Eight cyclical steps: you, need, go, search, find, take, return, change. Each cycle is a complete mini-story.",
		"en",
		"2026-01-02T00:00:00Z",
	)
	insertStoryLine.run(
		"sl-003",
		"经典三幕式叙事结构",
		"经典三幕式叙事结构（铺垫–对抗–结局）",
		"经典三幕式叙事结构将故事划分为三个主阶段：第一幕（建置）、第二幕（对抗）、第三幕（结局）。",
		"zh",
		"2026-01-03T00:00:00Z",
	)

	const insertCharacter = db.prepare(
		`INSERT INTO character_templates (id, idx, title, character_summaries, character_synopses, language_code, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
	)
	insertCharacter.run(
		"ct-001",
		1,
		"贾雨村",
		"投机型求生者 - 官僚原型",
		"贾雨村是红楼梦中的次要人物。一个善于投机的落魄书生，依靠科举成功后投靠权贵，迅速升迁却最终因贪婪腐败而败落。",
		"zh",
		"2026-02-01T00:00:00Z",
		"2026-02-01T00:00:00Z",
	)
	insertCharacter.run(
		"ct-002",
		2,
		"基督山伯爵",
		"复仇者 - 浪漫主义英雄",
		"基督山伯爵是被陷害入狱后越狱复仇的浪漫主义英雄。在法老号船上担任代理船长期间遭人陷害，含冤入狱十四年。",
		"zh",
		"2026-02-02T00:00:00Z",
		"2026-02-02T00:00:00Z",
	)

	const insertScene = db.prepare(
		`INSERT INTO scene_templates (id, idx, title, scene_summaries, scene_synopses, language_code, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
	)
	insertScene.run(
		"st-001",
		1,
		"Confrontation Scene",
		"Two characters with opposed goals meet in a charged moment.",
		"The confrontation scene forces both parties to drop their masks and reveals character through conflict.",
		"en",
		"2026-03-01T00:00:00Z",
		"2026-03-01T00:00:00Z",
	)
}

let tmpDir = ""
let dbPath = ""

function writeSettings(wikiDbPath?: string): string {
	const dir = join(tmpDir, "novel-repo", ".pi")
	mkdirSync(dir, { recursive: true })
	const settings: Record<string, string> = {}
	if (wikiDbPath) settings.wikiDbPath = wikiDbPath
	writeFileSync(join(dir, "settings.json"), JSON.stringify(settings))
	return join(tmpDir, "novel-repo")
}

beforeEach(() => {
	_resetWikiDbCache()
	tmpDir = join(tmpdir(), `wiki-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
	mkdirSync(tmpDir, { recursive: true })
	dbPath = join(tmpDir, "fixture.db")
	const seedDb = new DatabaseSync(dbPath)
	seedFixture(seedDb)
	seedDb.close()
})

afterEach(() => {
	_resetWikiDbCache()
	rmSync(tmpDir, { recursive: true, force: true })
})

describe("extensions/wiki/db", () => {
	it("readWikiDbPathSetting finds wikiDbPath from .pi/settings.json", () => {
		const cwd = writeSettings(dbPath)
		const path = resolveWikiDbPath(cwd)
		expect(path).toBe(dbPath)
	})

	it("readWikiDbPathSetting returns null when no settings file exists", () => {
		const path = resolveWikiDbPath(tmpDir)
		// Falls back to the default snapshot path even when no settings file
		expect(path).toMatch(/snapshots\/scribe-/)
	})

	it("openWikiDb opens the DB and exposes FTS5 virtual tables", () => {
		const db = openWikiDb(dbPath)
		const tables = db
			.prepare(
				"SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%_fts' ORDER BY name",
			)
			.all() as Array<{ name: string }>
		expect(tables.map((t) => t.name)).toContain("story_lines_fts")
		expect(tables.map((t) => t.name)).toContain("character_templates_fts")
	})

	it("openWikiDb throws when the path is missing", () => {
		expect(() => openWikiDb(join(tmpDir, "does-not-exist.db"))).toThrow(/wiki DB not found/)
	})
})

describe("extensions/wiki/fts", () => {
	it("buildFtsQuery quotes tokens and adds prefix match", () => {
		expect(buildFtsQuery("Fichtean Curve")).toBe('"Fichtean"* "Curve"*')
		expect(buildFtsQuery("  spaced  out  ")).toBe('"spaced"* "out"*')
		expect(buildFtsQuery("")).toBe("")
		expect(buildFtsQuery('a"b')).toBe('"a""b"*')
		expect(buildFtsQuery("crisis narrative")).toBe('"crisis"* "narrative"*')
		expect(buildFtsQuery("foo\t\nbar")).toBe('"foo"* "bar"*')
	})

	it("ftsSearch returns BM25-ordered rows for story_lines", () => {
		const db = openWikiDb(dbPath)
		const rows = ftsSearch(db, "story_lines", "narrative structure", 5)
		expect(rows.length).toBeGreaterThan(0)
		expect(rows[0]?.table).toBe("story_lines")
		expect(rows[0]?.id).toMatch(/^sl-/)
		// BM25 ordered ascending (lower is better)
		for (let i = 1; i < rows.length; i++) {
			expect((rows[i - 1]?.bm25 ?? 0) <= (rows[i]?.bm25 ?? 0)).toBe(true)
		}
	})

	it("ftsSearch returns empty for an unknown query", () => {
		const db = openWikiDb(dbPath)
		const rows = ftsSearch(db, "story_lines", "nonexistenttermxyz", 5)
		expect(rows).toEqual([])
	})

	it("ftsSearchAll interleaves candidates across tables by BM25", () => {
		const db = openWikiDb(dbPath)
		const rows = ftsSearchAll(db, "narrative", ["story_lines", "character_templates"], 5)
		// story_lines rows match the word "narrative"
		expect(rows.some((r) => r.table === "story_lines")).toBe(true)
		// Sorted ascending by BM25
		for (let i = 1; i < rows.length; i++) {
			expect((rows[i - 1]?.bm25 ?? 0) <= (rows[i]?.bm25 ?? 0)).toBe(true)
		}
	})
})

describe("extensions/wiki/rerank", () => {
	it("buildRerankPrompt lists every candidate with id, title, language", () => {
		const candidates = [
			{
				table: "story_lines" as const,
				id: "sl-001",
				title: "Fichtean",
				summary: "Crisis-driven",
				snippet: "snip",
				language: "en",
				bm25: 1.234,
			},
			{
				table: "character_templates" as const,
				id: "ct-002",
				title: "Monte Cristo",
				summary: "Revenger",
				snippet: "snip2",
				language: "zh",
				bm25: 2.5,
			},
		]
		const prompt = buildRerankPrompt("revenge arc", candidates, 5)
		expect(prompt).toContain("Query: revenge arc")
		expect(prompt).toContain("[story_lines] id=sl-001")
		expect(prompt).toContain("[character_templates] id=ct-002")
		expect(prompt).toContain("language=en")
	})

	it("parseRerankResponse extracts picks from a clean JSON response", () => {
		const raw = JSON.stringify({
			picks: [
				{ table: "story_lines", id: "sl-001", rationale: "Strong match for crisis-driven arc" },
				{ table: "character_templates", id: "ct-002", rationale: "Revenger archetype fits" },
			],
		})
		const ids = new Set(["sl-001", "ct-002"])
		const picks = parseRerankResponse(raw, ids, 5)
		expect(picks).toEqual([
			{ table: "story_lines", id: "sl-001", rationale: "Strong match for crisis-driven arc" },
			{ table: "character_templates", id: "ct-002", rationale: "Revenger archetype fits" },
		])
	})

	it("parseRerankResponse strips a markdown json fence", () => {
		const raw = `\`\`\`json\n${JSON.stringify({ picks: [{ table: "story_lines", id: "sl-001", rationale: "r" }] })}\n\`\`\``
		const picks = parseRerankResponse(raw, new Set(["sl-001"]), 5)
		expect(picks).toHaveLength(1)
		expect(picks[0]?.id).toBe("sl-001")
	})

	it("parseRerankResponse returns [] on malformed input", () => {
		expect(parseRerankResponse("not json", new Set(["x"]), 5)).toEqual([])
		expect(parseRerankResponse(JSON.stringify({ wrong: "shape" }), new Set(["x"]), 5)).toEqual([])
		expect(parseRerankResponse("null", new Set(["x"]), 5)).toEqual([])
	})

	it("parseRerankResponse rejects picks with ids not in the candidate set", () => {
		const raw = JSON.stringify({
			picks: [{ table: "story_lines", id: "sl-bogus", rationale: "r" }],
		})
		expect(parseRerankResponse(raw, new Set(["sl-real"]), 5)).toEqual([])
	})

	it("parseRerankResponse respects the topN cap", () => {
		const raw = JSON.stringify({
			picks: [
				{ table: "story_lines", id: "sl-001", rationale: "a" },
				{ table: "story_lines", id: "sl-002", rationale: "b" },
				{ table: "story_lines", id: "sl-003", rationale: "c" },
			],
		})
		const ids = new Set(["sl-001", "sl-002", "sl-003"])
		expect(parseRerankResponse(raw, ids, 2)).toHaveLength(2)
	})
})

describe("extensions/wiki/index — searchWiki end-to-end", () => {
	function makeCtx(cwd: string): ExtensionContext {
		return {
			cwd,
			model: undefined,
			modelRegistry: undefined,
			ui: {
				notify: () => {},
				setWidget: () => {},
			},
		} as unknown as ExtensionContext
	}

	it("returns empty result for an empty query", async () => {
		const cwd = writeSettings(dbPath)
		const ctx = makeCtx(cwd)
		const result = await searchWiki(ctx, "   ", { rerank: false })
		expect(result.candidates).toEqual([])
		expect(result.picks).toEqual([])
		expect(result.reranked).toBe(false)
	})

	it("returns FTS5 candidates without rerank when rerank=false", async () => {
		const cwd = writeSettings(dbPath)
		const ctx = makeCtx(cwd)
		const result = await searchWiki(ctx, "narrative", {
			tables: ["story_lines"],
			topN: 3,
			rerank: false,
		})
		expect(result.reranked).toBe(false)
		expect(result.candidates.length).toBeGreaterThan(0)
		expect(result.candidates.length).toBeLessThanOrEqual(3)
		expect(result.candidates.every((c) => c.table === "story_lines")).toBe(true)
	})

	it("clamps topN to [1, 20]", async () => {
		const cwd = writeSettings(dbPath)
		const ctx = makeCtx(cwd)
		const r1 = await searchWiki(ctx, "narrative", {
			tables: ["story_lines"],
			topN: 0,
			rerank: false,
		})
		expect(r1.picks.length).toBe(1)
		const r2 = await searchWiki(ctx, "narrative", {
			tables: ["story_lines"],
			topN: 999,
			rerank: false,
		})
		expect(r2.picks.length).toBeLessThanOrEqual(20)
	})

	it("calls registry.complete() once when rerank=true and ctx.model is set", async () => {
		const cwd = writeSettings(dbPath)
		const complete = vi.fn().mockResolvedValue({
			content: [
				{
					type: "text",
					text: JSON.stringify({
						picks: [{ table: "story_lines", id: "sl-001", rationale: "best crisis arc" }],
					}),
				},
			],
		})
		const ctx = {
			cwd,
			model: { id: "test-model" },
			modelRegistry: { complete },
			ui: { notify: () => {}, setWidget: () => {} },
		} as unknown as ExtensionContext

		const result = await searchWiki(ctx, "crisis narrative", {
			tables: ["story_lines"],
			topN: 1,
			rerank: true,
		})

		expect(complete).toHaveBeenCalledTimes(1)
		expect(result.reranked).toBe(true)
		expect(result.picks).toHaveLength(1)
		expect(result.picks[0]?.id).toBe("sl-001")
		expect(result.picks[0]?.rationale).toBe("best crisis arc")
	})

	it("does not call LLM when there are no candidates", async () => {
		const cwd = writeSettings(dbPath)
		const complete = vi.fn()
		const ctx = {
			cwd,
			model: { id: "test-model" },
			modelRegistry: { complete },
			ui: { notify: () => {}, setWidget: () => {} },
		} as unknown as ExtensionContext

		const result = await searchWiki(ctx, "nonexistenttermxyz12345", {
			tables: ["story_lines"],
			topN: 5,
			rerank: true,
		})

		expect(complete).not.toHaveBeenCalled()
		expect(result.candidates).toEqual([])
		expect(result.picks).toEqual([])
		expect(result.reranked).toBe(true)
	})

	it("skips rerank when fewer candidates than topN — returns them as picks with bm25 rationale", async () => {
		const cwd = writeSettings(dbPath)
		const complete = vi.fn()
		const ctx = {
			cwd,
			model: { id: "test-model" },
			modelRegistry: { complete },
			ui: { notify: () => {}, setWidget: () => {} },
		} as unknown as ExtensionContext

		const result = await searchWiki(ctx, "narrative", {
			tables: ["story_lines"],
			topN: 50, // > total candidates
			rerank: true,
		})

		expect(complete).not.toHaveBeenCalled()
		expect(result.picks.length).toBeGreaterThan(0)
		expect(result.picks[0]?.rationale).toMatch(/bm25=/)
		expect(result.picks[0]?.rationale).toContain("only candidate")
	})

	it("WIKI_TABLES contains the 5 expected tables in order", () => {
		expect(WIKI_TABLES).toEqual([
			"story_lines",
			"character_templates",
			"scene_templates",
			"writing_patterns",
			"prompts",
		])
	})
})
