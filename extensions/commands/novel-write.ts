/**
 * `/novel write` command handler — the canonical Phase 0.5 vertical.
 *
 * Per ADR-0003: `pi -e ./extensions/index.ts -p "/novel write"` opens the
 * next chapter file in the user's editor and updates chapter `status`
 * to `drafted` only on save.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent"
import { type EditorInjection, openInEditor } from "../editor/open.ts"
import { resolveNovelRepo } from "../state/path-resolver.ts"
import { applyStatus, getStatus, parseFrontmatter } from "../workflow/status.ts"

const CHAPTERS_DIR = "chapters"

export interface NextChapter {
	readonly chapterPath: string
	readonly created: boolean
	readonly chapterNumber: number
}

/**
 * Find the next chapter to write. Returns the lowest-numbered file
 * that doesn't yet have a terminal status (`approved` / `canonized`),
 * creating a new chapter if the directory is missing or empty.
 */
export function findNextChapter(novelRepo: string): NextChapter {
	const chaptersDir = join(novelRepo, CHAPTERS_DIR)
	if (!existsSync(chaptersDir)) {
		const initial = createChapterFile(chaptersDir, 1)
		return { chapterPath: initial, created: true, chapterNumber: 1 }
	}

	const files = readdirSync(chaptersDir)
		.filter((f) => f.endsWith(".md"))
		.sort()

	for (const file of files) {
		const path = join(chaptersDir, file)
		const content = readFileIfExists(path)
		const { frontmatter } = parseFrontmatter(content)
		const status = getStatus(frontmatter)
		const isTerminal = status === "approved" || status === "canonized"
		if (!isTerminal) {
			const chapterNumber = extractChapterNumber(frontmatter, file)
			return { chapterPath: path, created: false, chapterNumber }
		}
	}

	const nextNumber = files.length + 1
	const next = createChapterFile(chaptersDir, nextNumber)
	return { chapterPath: next, created: true, chapterNumber: nextNumber }
}

function createChapterFile(chaptersDir: string, chapterNumber: number): string {
	mkdirSync(chaptersDir, { recursive: true })
	const padded = String(chapterNumber).padStart(4, "0")
	const path = join(chaptersDir, `${padded}.md`)
	const frontmatter = `---\nchapter: ${chapterNumber}\nstatus: planned\n---\n\n# Chapter ${chapterNumber}\n\n`
	writeFileSync(path, frontmatter, "utf8")
	return path
}

function readFileIfExists(path: string): string {
	try {
		return readFileSync(path, "utf8")
	} catch {
		return ""
	}
}

function extractChapterNumber(frontmatter: { chapter?: unknown }, filename: string): number {
	if (typeof frontmatter.chapter === "number") return frontmatter.chapter
	const match = /^(\d+)\.md$/.exec(filename)
	if (match?.[1]) {
		return Number.parseInt(match[1], 10)
	}
	return 0
}

export async function handleNovelWrite(
	ctx: ExtensionCommandContext,
	injection?: EditorInjection,
): Promise<void> {
	const novelRepo = resolveNovelRepo(ctx.cwd)
	ctx.ui.notify(`Novel repo: ${novelRepo.path} (source: ${novelRepo.source})`, "info")

	const next = findNextChapter(novelRepo.path)
	const label = next.created ? "Created new chapter" : "Opening chapter"
	ctx.ui.notify(`${label} ${next.chapterNumber}: ${next.chapterPath}`, "info")

	const result = await openInEditor(next.chapterPath, injection)

	if (!result.saved) {
		ctx.ui.notify(
			`Editor exited without saving — chapter ${next.chapterNumber} not marked drafted.`,
			"warning",
		)
		return
	}

	applyStatus(next.chapterPath, "drafted")
	ctx.ui.notify(
		`Saved. Chapter ${next.chapterNumber} marked status: drafted (took ${result.durationMs}ms).`,
		"info",
	)
}
