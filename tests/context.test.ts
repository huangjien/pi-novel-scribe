import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { composeSceneContext, isDraftable } from "../extensions/novel/context.ts"

let sandbox: string
beforeEach(() => {
	sandbox = mkdtempSync(join(tmpdir(), "pi-novel-scribe-ctx-"))
})
afterEach(() => {
	rmSync(sandbox, { recursive: true, force: true })
})

function makeChapter(content: string, filename = "0005.md"): string {
	const chaptersDir = join(sandbox, "chapters")
	mkdirSync(chaptersDir, { recursive: true })
	const chapterPath = join(chaptersDir, filename)
	writeFileSync(chapterPath, content, "utf8")
	return chapterPath
}

function makeCharacterProfile(pov: string, content: string): void {
	const charDir = join(sandbox, "characters", pov)
	mkdirSync(charDir, { recursive: true })
	writeFileSync(join(charDir, "profile.yaml"), content, "utf8")
}

const SAMPLE_CHAPTER_FULL = `---
chapter: 5
title: "The Lighthouse"
status: planned
plan:
  objective: "Sara confronts Miguel"
  conflict: "Sara suspects Miguel of hiding John"
  turn: "Miguel reveals John is alive"
---

@scene id=lighthouse pov:sara location=lighthouse time=evening participants=sara,miguel
  purpose="Sara confronts Miguel" conflict="Suspects hiding" turn="Reveal alive"

Prose here. Sara walked to the lighthouse...
`

const SAMPLE_CHAPTER_NO_MARKERS = `---
chapter: 1
status: planned
---

Some prose, but no @scene markers.
`

const SAMPLE_PROFILE_SARA = `name: Sara
role: protagonist
voice:
  register: tight
  vocabulary: terse
psychology:
  current_goal: find john
`

describe("composeSceneContext", () => {
	it("extracts plan fields from frontmatter (excluding status/title/chapter)", () => {
		const chapterPath = makeChapter(SAMPLE_CHAPTER_FULL)
		const ctx = composeSceneContext({
			chapterPath,
			cwd: sandbox,
			novelRepo: sandbox,
		})
		expect(ctx.chapterNumber).toBe(5)
		expect(ctx.status).toBe("planned")
		expect(ctx.plan).not.toHaveProperty("status")
		expect(ctx.plan).not.toHaveProperty("title")
		expect(ctx.plan).not.toHaveProperty("chapter")
		expect(ctx.plan).toEqual({
			objective: "Sara confronts Miguel",
			conflict: "Sara suspects Miguel of hiding John",
			turn: "Miguel reveals John is alive",
		})
	})

	it("extracts POV from @scene marker", () => {
		const chapterPath = makeChapter(SAMPLE_CHAPTER_FULL)
		const ctx = composeSceneContext({
			chapterPath,
			cwd: sandbox,
			novelRepo: sandbox,
		})
		expect(ctx.pov).toBe("sara")
	})

	it("falls back to frontmatter pov when no @scene marker", () => {
		const content = `---
chapter: 1
status: planned
pov: john
---

Just prose.
`
		const chapterPath = makeChapter(content)
		const ctx = composeSceneContext({
			chapterPath,
			cwd: sandbox,
			novelRepo: sandbox,
		})
		expect(ctx.pov).toBe("john")
	})

	it("returns null pov when neither marker nor frontmatter has one", () => {
		const chapterPath = makeChapter(SAMPLE_CHAPTER_NO_MARKERS)
		const ctx = composeSceneContext({
			chapterPath,
			cwd: sandbox,
			novelRepo: sandbox,
		})
		expect(ctx.pov).toBeNull()
	})

	it("loads the POV character's profile.yaml when present", () => {
		const chapterPath = makeChapter(SAMPLE_CHAPTER_FULL)
		makeCharacterProfile("sara", SAMPLE_PROFILE_SARA)
		const ctx = composeSceneContext({
			chapterPath,
			cwd: sandbox,
			novelRepo: sandbox,
		})
		expect(ctx.characterProfile).toBe(SAMPLE_PROFILE_SARA)
	})

	it("returns null characterProfile when the profile is missing", () => {
		const chapterPath = makeChapter(SAMPLE_CHAPTER_FULL)
		// Don't create the profile — should be null
		const ctx = composeSceneContext({
			chapterPath,
			cwd: sandbox,
			novelRepo: sandbox,
		})
		expect(ctx.characterProfile).toBeNull()
	})

	it("counts words in the body before drafting", () => {
		const chapterPath = makeChapter(SAMPLE_CHAPTER_FULL)
		const ctx = composeSceneContext({
			chapterPath,
			cwd: sandbox,
			novelRepo: sandbox,
		})
		expect(ctx.wordCountBefore).toBeGreaterThan(0)
	})

	it("accepts absolute chapterPath", () => {
		const chapterPath = makeChapter(SAMPLE_CHAPTER_FULL)
		const ctx = composeSceneContext({
			chapterPath,
			cwd: "/tmp",
			novelRepo: sandbox,
		})
		expect(ctx.chapterPath).toBe(chapterPath)
		expect(ctx.novelRepo).toBe(sandbox)
	})

	it("resolves relative chapterPath against novelRepo/chapters/", () => {
		const chaptersDir = join(sandbox, "chapters")
		mkdirSync(chaptersDir, { recursive: true })
		const chapterPath = join(chaptersDir, "0007.md")
		writeFileSync(chapterPath, "---\nchapter: 7\nstatus: planned\n---\n\n", "utf8")

		const ctx = composeSceneContext({
			chapterPath: "0007.md",
			cwd: sandbox,
			novelRepo: sandbox,
		})
		expect(ctx.chapterPath).toBe(chapterPath)
	})

	it("throws when the chapter file does not exist", () => {
		expect(() =>
			composeSceneContext({
				chapterPath: "missing.md",
				cwd: sandbox,
				novelRepo: sandbox,
			}),
		).toThrow(/chapter file not found/)
	})
})

describe("isDraftable", () => {
	it("returns true for null status (new file)", () => {
		expect(isDraftable(null)).toBe(true)
	})

	it("returns true for planned status", () => {
		expect(isDraftable("planned")).toBe(true)
		expect(isDraftable("human_editing")).toBe(true)
		expect(isDraftable("drafted")).toBe(true)
	})

	it("returns false for approved status (cannot overwrite canon)", () => {
		expect(isDraftable("approved")).toBe(false)
		expect(isDraftable("canonized")).toBe(false)
	})
})
