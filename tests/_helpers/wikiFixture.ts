/**
 * Shared wiki fixture: an on-disk SQLite DB with the same FTS5 schema
 * as the wst snapshot (subset of tables used by wiki-context tests).
 * Extracted from the inline fixture in wiki.test.ts so packet-level
 * injection tests (ADR-0008) can reuse it.
 */

import type { DatabaseSync as DatabaseSyncInstance } from "node:sqlite"
import { DatabaseSync } from "../../extensions/wiki/db.ts"

export const WIKI_FIXTURE_SCHEMA_SQL = `
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
`

export function seedWikiFixture(dbPath: string): void {
	const db = new DatabaseSync(dbPath)
	db.exec(WIKI_FIXTURE_SCHEMA_SQL)
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
	const insertPattern = db.prepare(
		`INSERT INTO writing_patterns (id, idx, title, summary, content, language_code, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
	)
	insertPattern.run(
		"wp-001",
		1,
		"Late-Turn Pacing Pattern",
		"Delay the planned turn too long and urgency leaks out of the scene.",
		"Place the scene's turn within the first two-thirds of the scene; a turn that lands on the final page reads as an afterthought.",
		"en",
		"2026-04-01T00:00:00Z",
		"2026-04-01T00:00:00Z",
	)
	db.close()
}

// ============================================================================
// Embedding-eval fixture (ADR-0012 Q30 / Phase 14)
// ============================================================================

/**
 * 32-word vocabulary used to deterministically vectorize fixture rows.
 * Each word is hashed into one of 32 buckets by simple sum-of-codepoints
 * mod 32 — so the vector for any text is a pure function of its words.
 */
const VOCAB_SIZE = 32

/** Tokenize and hash into a 32-dim bag-of-hashes vector, then L2-normalize. */
export function fixtureVectorize(text: string): number[] {
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
export function cosineSimilarity(a: number[], b: number[]): number {
	let dot = 0
	for (let i = 0; i < a.length; i++) dot += (a[i] ?? 0) * (b[i] ?? 0)
	return dot
}

function vectorToText(v: number[]): string {
	return JSON.stringify(v.map((n) => Number(n.toFixed(6))))
}

/**
 * Seed a populated fixture for the Phase 14 embedding evaluation.
 * Adds rows to all 3 tables (more than seedWikiFixture so precision
 * can be measured against non-trivial candidate sets) and writes a
 * deterministic 32-dim TF-style vector into each row's `embedding`
 * column.
 *
 * The eval queries in `tests/embedding-eval.test.ts` are designed
 * against these specific rows — when you add/rename a row, update
 * the queries and the expected-top-1 list.
 */
export function seedEmbeddingEvalFixture(dbPath: string): void {
	const db = new DatabaseSync(dbPath)
	db.exec(WIKI_FIXTURE_SCHEMA_SQL)

	// story_lines (5 rows)
	const storyLines: Array<{
		id: string
		title: string
		description: string
		content: string
		language: string
	}> = [
		{
			id: "sl-e-001",
			title: "Fichtean Curve Crisis-Driven Narrative Structure",
			description: "High-intensity, crisis-driven narrative structure that removes slow setup",
			content:
				"The Fichtean Curve starts with immediate action and escalates through multiple crises. Each crisis must raise stakes.",
			language: "en",
		},
		{
			id: "sl-e-002",
			title: "Three-Act Classic Narrative Structure",
			description: "Setup, confrontation, resolution — the classical narrative arc",
			content:
				"The three-act structure divides a story into setup, confrontation, and resolution. Each act contains a turning point.",
			language: "en",
		},
		{
			id: "sl-e-003",
			title: "Hero's Journey Mythic Monomyth",
			description: "Departure, initiation, return — Campbell's monomyth applied to character arcs",
			content:
				"The hero departs the ordinary world, undergoes initiation through trials, and returns transformed.",
			language: "en",
		},
		{
			id: "sl-e-004",
			title: "Mystery Investigation Arc",
			description: "A protagonist pursues clues through escalating revelations",
			content:
				"Investigation arcs structure a story around clue discovery, red herrings, and a final reveal.",
			language: "en",
		},
		{
			id: "sl-e-005",
			title: "Romance Relationship Arc",
			description: "Two characters move from distance to connection over a story",
			content: "Romance arcs follow meet-cute, obstacles, dark night, and commitment.",
			language: "en",
		},
	]
	const insertStoryLine = db.prepare(
		`INSERT INTO story_lines (id, title, description, content, language, embedding, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
	)
	for (const r of storyLines) {
		const v = fixtureVectorize(`${r.title} ${r.description} ${r.content}`)
		insertStoryLine.run(
			r.id,
			r.title,
			r.description,
			r.content,
			r.language,
			vectorToText(v),
			"2026-01-01T00:00:00Z",
		)
	}

	const scenes: Array<{
		id: string
		idx: number
		title: string
		summaries: string
		synopses: string
	}> = [
		{
			id: "st-e-001",
			idx: 1,
			title: "Confrontation Scene",
			summaries: "Two characters with opposed goals meet in a charged moment.",
			synopses:
				"The confrontation scene forces both parties to drop their masks and reveals character through conflict.",
		},
		{
			id: "st-e-002",
			idx: 2,
			title: "Reveal Scene",
			summaries: "A secret is disclosed to a character or the audience.",
			synopses: "The reveal scene reframes prior events and shifts the protagonist's goal.",
		},
		{
			id: "st-e-003",
			idx: 3,
			title: "Pursuit Scene",
			summaries: "A chase or escape sequence that escalates tension.",
			synopses: "Pursuit scenes compress time and space, raising stakes through physical urgency.",
		},
		{
			id: "st-e-004",
			idx: 4,
			title: "Quiet Aftermath Scene",
			summaries: "Two characters sit with the consequence of a prior event.",
			synopses:
				"Aftermath scenes give the reader and protagonist room to absorb change before the next beat.",
		},
		{
			id: "st-e-005",
			idx: 5,
			title: "Opening Hook Scene",
			summaries: "The first scene that establishes voice, setting, and stakes.",
			synopses:
				"A good opening scene promises conflict, plants a question, and earns the reader's attention.",
		},
	]
	const insertScene = db.prepare(
		`INSERT INTO scene_templates (id, idx, title, scene_summaries, scene_synopses, language_code, embedding, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	)
	for (const r of scenes) {
		const v = fixtureVectorize(`${r.title} ${r.summaries} ${r.synopses}`)
		insertScene.run(
			r.id,
			r.idx,
			r.title,
			r.summaries,
			r.synopses,
			"en",
			vectorToText(v),
			"2026-03-01T00:00:00Z",
			"2026-03-01T00:00:00Z",
		)
	}

	const patterns: Array<{
		id: string
		idx: number
		title: string
		summary: string
		content: string
	}> = [
		{
			id: "wp-e-001",
			idx: 1,
			title: "Late-Turn Pacing Pattern",
			summary: "Delay the planned turn too long and urgency leaks out of the scene.",
			content:
				"Place the scene's turn within the first two-thirds of the scene; a turn that lands on the final page reads as an afterthought.",
		},
		{
			id: "wp-e-002",
			idx: 2,
			title: "Open With a Question Pattern",
			summary: "Plant a question in the reader's mind before explaining anything.",
			content:
				"Opening lines that raise an unanswered question compel the reader forward. State the question, then withhold the answer until the scene earns it.",
		},
		{
			id: "wp-e-003",
			idx: 3,
			title: "Sentence Rhythm Variation Pattern",
			summary: "Mix short and long sentences to control pacing.",
			content:
				"A paragraph of medium-length sentences gains urgency from one short sentence. Use rhythm variation as breath control.",
		},
		{
			id: "wp-e-004",
			idx: 4,
			title: "Show Versus Tell Pattern",
			summary: "Replace summary with concrete sensory detail.",
			content:
				"Instead of 'she was angry', describe the fist, the held breath, the slammed door. Show the body, not the label.",
		},
		{
			id: "wp-e-005",
			idx: 5,
			title: "Echo the Opening at the Close Pattern",
			summary: "Return to the scene's first image in the final paragraph.",
			content:
				"An echoed closing creates a frame the reader feels without naming. The image should be transformed, not merely repeated.",
		},
	]
	const insertPattern = db.prepare(
		`INSERT INTO writing_patterns (id, idx, title, summary, content, language_code, embedding, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	)
	for (const r of patterns) {
		const v = fixtureVectorize(`${r.title} ${r.summary} ${r.content}`)
		insertPattern.run(
			r.id,
			r.idx,
			r.title,
			r.summary,
			r.content,
			"en",
			vectorToText(v),
			"2026-04-01T00:00:00Z",
			"2026-04-01T00:00:00Z",
		)
	}

	db.close()
}

export type WikiFixtureDb = DatabaseSyncInstance
