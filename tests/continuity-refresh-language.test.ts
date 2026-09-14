/**
 * Tests for the language filter on refreshCharacterBeliefs (Phase 9).
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { refreshCharacterBeliefs } from "../extensions/novel/continuity-refresh.ts"

let tmpDir = ""

beforeEach(() => {
	tmpDir = join(tmpdir(), `refresh-lang-${Date.now()}-${Math.random().toString(36).slice(2)}`)
	mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true })
})

function writeChapter(
	file: string,
	opts: { chapter: number; language?: "en" | "zh"; pov: string; sceneId: string },
): void {
	const langLine = opts.language ? `language: ${opts.language}\n` : ""
	writeFileSync(
		file,
		`---\nchapter: ${opts.chapter}\nstatus: approved\n${langLine}---\n\n@scene id=${opts.sceneId} pov=${opts.pov}\n\nBody for chapter ${opts.chapter}.`,
		"utf8",
	)
}

describe("refreshCharacterBeliefs language filter", () => {
	it("without a language filter, includes all approved chapters", () => {
		const chaptersDir = join(tmpDir, "chapters")
		mkdirSync(chaptersDir, { recursive: true })
		writeChapter(join(chaptersDir, "0001.md"), {
			chapter: 1,
			language: "en",
			pov: "sara",
			sceneId: "a",
		})
		writeChapter(join(chaptersDir, "0002.md"), {
			chapter: 2,
			language: "zh",
			pov: "sara",
			sceneId: "b",
		})
		writeChapter(join(chaptersDir, "0003.md"), {
			chapter: 3,
			language: "zh",
			pov: "miguel",
			sceneId: "c",
		})

		const result = refreshCharacterBeliefs(tmpDir)

		expect(result.languageFilter).toBeNull()
		expect(result.approvedChapterCount).toBe(3)
		expect(result.chapterStats.matched).toBe(3)
		expect(result.chapterStats.skipped).toBe(0)
		expect([...result.derivedCharacters].sort()).toEqual(["miguel", "sara"])
		// Both sara's scenes are derived
		const beliefs = readFileSync(join(tmpDir, "state", "character-beliefs.yaml"), "utf8")
		expect(beliefs).toContain("a")
		expect(beliefs).toContain("b")
		expect(beliefs).toContain("c")
	})

	it("with language=en, includes only en chapters; zh ones are skipped", () => {
		const chaptersDir = join(tmpDir, "chapters")
		mkdirSync(chaptersDir, { recursive: true })
		writeChapter(join(chaptersDir, "0001.md"), {
			chapter: 1,
			language: "en",
			pov: "sara",
			sceneId: "en-a",
		})
		writeChapter(join(chaptersDir, "0002.md"), {
			chapter: 2,
			language: "zh",
			pov: "sara",
			sceneId: "zh-b",
		})
		writeChapter(join(chaptersDir, "0003.md"), {
			chapter: 3,
			language: "zh",
			pov: "miguel",
			sceneId: "zh-c",
		})

		const result = refreshCharacterBeliefs(tmpDir, { language: "en" })

		expect(result.languageFilter).toBe("en")
		expect(result.approvedChapterCount).toBe(3)
		expect(result.chapterStats.matched).toBe(1)
		expect(result.chapterStats.skipped).toBe(2)
		expect(result.derivedCharacters).toEqual(["sara"])

		// Verify only the en chapter's scene id was derived
		const beliefs = readFileSync(join(tmpDir, "state", "character-beliefs.yaml"), "utf8")
		expect(beliefs).toContain("en-a")
		expect(beliefs).not.toContain("zh-b")
		expect(beliefs).not.toContain("zh-c")

		// languageBreakdown reports the project's overall composition
		expect(result.languageBreakdown).toEqual({ en: 1, zh: 2 })
	})

	it("with language=zh, includes only zh chapters", () => {
		const chaptersDir = join(tmpDir, "chapters")
		mkdirSync(chaptersDir, { recursive: true })
		writeChapter(join(chaptersDir, "0001.md"), {
			chapter: 1,
			language: "en",
			pov: "sara",
			sceneId: "en-a",
		})
		writeChapter(join(chaptersDir, "0002.md"), {
			chapter: 2,
			language: "zh",
			pov: "sara",
			sceneId: "zh-b",
		})

		const result = refreshCharacterBeliefs(tmpDir, { language: "zh" })

		expect(result.languageFilter).toBe("zh")
		expect(result.chapterStats.matched).toBe(1)
		expect(result.chapterStats.skipped).toBe(1)
		expect(result.chapterStats.skippedChapters).toHaveLength(1)
		expect(result.derivedCharacters).toEqual(["sara"])

		const beliefs = readFileSync(join(tmpDir, "state", "character-beliefs.yaml"), "utf8")
		expect(beliefs).toContain("zh-b")
		expect(beliefs).not.toContain("en-a")
	})

	it("chapters without a language field are skipped under an explicit filter", () => {
		const chaptersDir = join(tmpDir, "chapters")
		mkdirSync(chaptersDir, { recursive: true })
		writeChapter(join(chaptersDir, "0001.md"), { chapter: 1, pov: "sara", sceneId: "unset-a" })
		writeChapter(join(chaptersDir, "0002.md"), {
			chapter: 2,
			language: "en",
			pov: "sara",
			sceneId: "en-b",
		})

		const result = refreshCharacterBeliefs(tmpDir, { language: "en" })

		// Unset chapter is skipped (strict match); only en chapter contributes
		expect(result.chapterStats.matched).toBe(1)
		expect(result.chapterStats.skipped).toBe(1)
		expect(result.derivedCharacters).toEqual(["sara"])

		const beliefs = readFileSync(join(tmpDir, "state", "character-beliefs.yaml"), "utf8")
		expect(beliefs).toContain("en-b")
		expect(beliefs).not.toContain("unset-a")
	})

	it("preserves authored_overrides regardless of the language filter", () => {
		const chaptersDir = join(tmpDir, "chapters")
		mkdirSync(chaptersDir, { recursive: true })
		writeChapter(join(chaptersDir, "0001.md"), {
			chapter: 1,
			language: "en",
			pov: "sara",
			sceneId: "a",
		})

		// Seed an existing beliefs file with authored overrides for sara
		const stateDir = join(tmpDir, "state")
		mkdirSync(stateDir, { recursive: true })
		writeFileSync(
			join(stateDir, "character-beliefs.yaml"),
			"characters:\n  sara:\n    derived:\n      believes: []\n    authored_overrides:\n      - sara_knows_secret_about_miguel\n",
			"utf8",
		)

		const result = refreshCharacterBeliefs(tmpDir, { language: "en" })

		expect(result.preservedOverrides).toContain("sara")
		const beliefs = readFileSync(join(tmpDir, "state", "character-beliefs.yaml"), "utf8")
		expect(beliefs).toContain("sara_knows_secret_about_miguel")
		expect(beliefs).toContain("a")
	})

	it("languageBreakdown reports zero counts when no chapters exist", () => {
		const result = refreshCharacterBeliefs(tmpDir)
		expect(result.languageBreakdown).toEqual({ en: 0, zh: 0 })
		expect(result.approvedChapterCount).toBe(0)
		expect(result.derivedCharacters).toEqual([])
	})

	it("writes character-beliefs.yaml even when no chapters match the filter", () => {
		const chaptersDir = join(tmpDir, "chapters")
		mkdirSync(chaptersDir, { recursive: true })
		writeChapter(join(chaptersDir, "0001.md"), {
			chapter: 1,
			language: "zh",
			pov: "sara",
			sceneId: "a",
		})

		const result = refreshCharacterBeliefs(tmpDir, { language: "en" })
		expect(result.chapterStats.matched).toBe(0)
		expect(result.derivedCharacters).toEqual([])
		expect(existsSync(join(tmpDir, "state", "character-beliefs.yaml"))).toBe(true)
		const beliefs = readFileSync(join(tmpDir, "state", "character-beliefs.yaml"), "utf8")
		expect(beliefs.trim()).toBe("characters: {}")
	})
})
