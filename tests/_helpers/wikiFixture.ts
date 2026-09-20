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

export type WikiFixtureDb = DatabaseSyncInstance
