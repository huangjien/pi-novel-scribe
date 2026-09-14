/**
 * Resolve the user's novel-repo path. Per ADR-0001 (Q1), the novel lives
 * in a separate git repo, separate from this extension.
 *
 * Resolution order:
 *   1. Walk up from `cwd` looking for `~/.pi/novel-scribe/.pi/settings.json`
 *      with a `novelRepo` string field.
 *   2. Walk up looking for `~/.pi/novel-scribe/.pi/novel-state.yaml` marker
 *      file — its parent directory IS the novel repo.
 *   3. Fall back to `cwd` itself (treat cwd as the novel repo).
 */

import { existsSync, readFileSync } from "node:fs"
import { dirname, isAbsolute, join } from "node:path"
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent"

const NOVEL_STATE_MARKER = "novel-state.yaml"
const SETTINGS_FILE = "settings.json"

export interface ResolvedNovelRepo {
	readonly path: string
	readonly source: "settings" | "marker" | "fallback"
}

export function resolveNovelRepo(cwd: string): ResolvedNovelRepo {
	const fromSettings = findNovelRepoInSettings(cwd)
	if (fromSettings) return fromSettings
	const fromMarker = findNovelRepoInMarker(cwd)
	if (fromMarker) return fromMarker
	return { path: cwd, source: "fallback" }
}

function findNovelRepoInSettings(cwd: string): ResolvedNovelRepo | null {
	for (const dir of walkUp(cwd)) {
		const settingsPath = join(dir, CONFIG_DIR_NAME, SETTINGS_FILE)
		if (!existsSync(settingsPath)) continue
		const value = readNovelRepoField(settingsPath)
		if (value === null) continue
		const resolved = isAbsolute(value) ? value : join(dir, value)
		return { path: resolved, source: "settings" }
	}
	return null
}

function readNovelRepoField(path: string): string | null {
	let raw: string
	try {
		raw = readFileSync(path, "utf8")
	} catch {
		return null
	}
	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch {
		return null
	}
	if (!isPlainObject(parsed)) return null
	const value = parsed.novelRepo
	if (typeof value !== "string" || value.length === 0) return null
	return value
}

function findNovelRepoInMarker(cwd: string): ResolvedNovelRepo | null {
	for (const dir of walkUp(cwd)) {
		const markerPath = join(dir, CONFIG_DIR_NAME, NOVEL_STATE_MARKER)
		if (existsSync(markerPath)) return { path: dir, source: "marker" }
	}
	return null
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null
}

/** Returns ancestor paths from `start` up to (and including) filesystem root. */
export function walkUp(start: string): string[] {
	const result: string[] = []
	let current = start
	while (true) {
		result.push(current)
		const parent = dirname(current)
		if (parent === current) break
		current = parent
	}
	return result
}
