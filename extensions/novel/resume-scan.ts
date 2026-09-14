/**
 * Resume-on-exit scan. Per Q9 / §18, a chapter in `human_editing` is
 * the canonical "in-flight" state — when pi exits mid-edit, the next
 * session should know.
 *
 * This module scans `<novelRepo>/chapters/` for chapters whose frontmatter
 * `status` is one of: `writing | drafted | human_editing | edited |
 * continuity_check | reviewing | revision_required`. Returns the list so
 * session_start can surface a "Resume chapter 0005.md in editor?" prompt.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

export interface ResumableChapter {
	readonly chapterPath: string
	readonly chapterNumber: number | null
	readonly status: string
}

const RESUMABLE_STATUSES = new Set([
	"writing",
	"drafted",
	"human_editing",
	"edited",
	"continuity_check",
	"reviewing",
	"revision_required",
])

export function listResumableChapters(novelRepo: string): readonly ResumableChapter[] {
	const chaptersDir = join(novelRepo, "chapters")
	if (!existsSync(chaptersDir)) return []
	const files = readdirSync(chaptersDir)
		.filter((f) => f.endsWith(".md"))
		.sort()
	const out: ResumableChapter[] = []
	for (const file of files) {
		const path = join(chaptersDir, file)
		const raw = readFileSync(path, "utf8")
		const status = readFrontmatterStatus(raw)
		if (status === null) continue
		if (!RESUMABLE_STATUSES.has(status)) continue
		out.push({
			chapterPath: path,
			chapterNumber: readChapterNumber(raw),
			status,
		})
	}
	return out
}

function readFrontmatterStatus(content: string): string | null {
	const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)
	if (!m || m[1] === undefined) return null
	for (const line of m[1].split("\n")) {
		const colon = line.indexOf(":")
		if (colon === -1) continue
		const key = line.slice(0, colon).trim()
		if (key !== "status") continue
		let value: string = line.slice(colon + 1).trim()
		if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
		return value
	}
	return null
}

function readChapterNumber(content: string): number | null {
	const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)
	if (!m || m[1] === undefined) return null
	for (const line of m[1].split("\n")) {
		const colon = line.indexOf(":")
		if (colon === -1) continue
		const key = line.slice(0, colon).trim()
		if (key !== "chapter") continue
		const value = Number(line.slice(colon + 1).trim())
		return Number.isFinite(value) ? value : null
	}
	return null
}
