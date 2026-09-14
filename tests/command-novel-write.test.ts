/**
 * Tests for the `/novel write` command handler.
 * The editor is injected — we never spawn a real subprocess.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { findNextChapter, handleNovelWrite } from "../extensions/commands/novel-write.ts"
import type { StatFn } from "../extensions/editor/open.ts"
import { makeNoSaveSpawn, makeSaveSpawn } from "./_helpers/fakeChild.ts"

let tmpDir = ""

beforeEach(() => {
	tmpDir = join(tmpdir(), `novel-write-${Date.now()}-${Math.random().toString(36).slice(2)}`)
	mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true })
	vi.restoreAllMocks()
})

function makeCtx(): ExtensionCommandContext & {
	_$notifications: Array<{ msg: string; kind: string }>
} {
	const notifications: Array<{ msg: string; kind: string }> = []
	return {
		cwd: tmpDir,
		ui: {
			notify: (msg: string, kind = "info") => notifications.push({ msg, kind }),
		},
		_$notifications: notifications,
	} as unknown as ExtensionCommandContext & {
		_$notifications: Array<{ msg: string; kind: string }>
	}
}

function makeRealStat(): StatFn {
	return ((p: string) => {
		const { statSync } = require("node:fs") as typeof import("node:fs")
		return statSync(p) as never
	}) as StatFn
}

describe("findNextChapter", () => {
	it("creates chapter 0001.md when chapters/ is missing", () => {
		const result = findNextChapter(tmpDir)
		expect(result.created).toBe(true)
		expect(result.chapterNumber).toBe(1)
		expect(result.chapterPath).toBe(join(tmpDir, "chapters", "0001.md"))
		expect(existsSync(result.chapterPath)).toBe(true)
		const content = readFileSync(result.chapterPath, "utf8")
		expect(content).toContain("status: planned")
	})

	it("returns the lowest-numbered non-terminal chapter", () => {
		const chaptersDir = join(tmpDir, "chapters")
		mkdirSync(chaptersDir, { recursive: true })
		writeFileSync(
			join(chaptersDir, "0001.md"),
			`---\nchapter: 1\nstatus: approved\n---\n\nDone.`,
			"utf8",
		)
		writeFileSync(
			join(chaptersDir, "0002.md"),
			`---\nchapter: 2\nstatus: drafted\n---\n\nIn progress.`,
			"utf8",
		)
		const result = findNextChapter(tmpDir)
		expect(result.created).toBe(false)
		expect(result.chapterNumber).toBe(2)
		expect(result.chapterPath).toBe(join(chaptersDir, "0002.md"))
	})

	it("creates a fresh chapter if every existing one is terminal", () => {
		const chaptersDir = join(tmpDir, "chapters")
		mkdirSync(chaptersDir, { recursive: true })
		writeFileSync(
			join(chaptersDir, "0001.md"),
			`---\nchapter: 1\nstatus: canonized\n---\n\nDone.`,
			"utf8",
		)
		const result = findNextChapter(tmpDir)
		expect(result.created).toBe(true)
		expect(result.chapterNumber).toBe(2)
	})

	it("falls back to filename when frontmatter has no chapter number", () => {
		const chaptersDir = join(tmpDir, "chapters")
		mkdirSync(chaptersDir, { recursive: true })
		writeFileSync(join(chaptersDir, "0007.md"), `---\nstatus: planned\n---\n\nBody.`, "utf8")
		const result = findNextChapter(tmpDir)
		expect(result.chapterNumber).toBe(7)
	})
})

describe("handleNovelWrite", () => {
	it("opens the next chapter and writes status=drafted on save", async () => {
		const ctx = makeCtx()
		await handleNovelWrite(ctx, { spawn: makeSaveSpawn(), stat: makeRealStat() })

		expect(ctx._$notifications.some((n) => n.msg.includes("Saved"))).toBe(true)
		expect(ctx._$notifications.some((n) => n.msg.includes("drafted"))).toBe(true)

		const chapterPath = join(tmpDir, "chapters", "0001.md")
		expect(existsSync(chapterPath)).toBe(true)
		const updated = readFileSync(chapterPath, "utf8")
		expect(updated).toMatch(/status:\s*"?drafted"?/)
	})

	it("skips the drafted transition when the editor exits without saving", async () => {
		const ctx = makeCtx()
		await handleNovelWrite(ctx, { spawn: makeNoSaveSpawn(), stat: makeRealStat() })

		expect(ctx._$notifications.some((n) => n.msg.includes("not marked drafted"))).toBe(true)
	})

	it("uses the injected spawn so it works even with no $EDITOR set", async () => {
		const ctx = makeCtx()
		const before = process.env.EDITOR
		const beforeVisual = process.env.VISUAL
		delete process.env.EDITOR
		delete process.env.VISUAL
		try {
			await handleNovelWrite(ctx, { spawn: makeSaveSpawn(), stat: makeRealStat() })
		} finally {
			if (before !== undefined) process.env.EDITOR = before
			if (beforeVisual !== undefined) process.env.VISUAL = beforeVisual
		}
		const chapterPath = join(tmpDir, "chapters", "0001.md")
		expect(existsSync(chapterPath)).toBe(true)
	})
})
