import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { composePlanRequest } from "../extensions/novel/plan-context.ts"

let sandbox: string
beforeEach(() => {
	sandbox = mkdtempSync(join(tmpdir(), "pi-novel-scribe-plan-ctx-"))
})
afterEach(() => {
	rmSync(sandbox, { recursive: true, force: true })
})

function makeChapter(content: string, filename = "0005.md"): string {
	const chaptersDir = join(sandbox, "chapters")
	mkdirSync(chaptersDir, { recursive: true })
	const p = join(chaptersDir, filename)
	writeFileSync(p, content, "utf8")
	return p
}

function makeCharacter(id: string, profileYaml: string): void {
	const dir = join(sandbox, "characters", id)
	mkdirSync(dir, { recursive: true })
	writeFileSync(join(dir, "profile.yaml"), profileYaml, "utf8")
}

function makeStoryLines(yamlContent: string): void {
	const dir = join(sandbox, "story")
	mkdirSync(dir, { recursive: true })
	writeFileSync(join(dir, "story-lines.yaml"), yamlContent, "utf8")
}

describe("composePlanRequest", () => {
	it("returns novelRepo, chapterPath, chapterNumber from the chapter file", () => {
		const path = makeChapter("---\nchapter: 7\nstatus: planned\n---\n\n")
		const req = composePlanRequest({ chapterPath: path, cwd: sandbox })
		expect(req.novelRepo).toBe(sandbox)
		expect(req.chapterPath).toBe(path)
		expect(req.chapterNumber).toBe(7)
	})

	it("returns existingPlan when the chapter has a plan block", () => {
		const content = `---
chapter: 5
status: planned
plan:
  objective: "Earlier plan"
  conflict: "Earlier conflict"
---

`
		const path = makeChapter(content)
		const req = composePlanRequest({ chapterPath: path, cwd: sandbox })
		expect(req.existingPlan).not.toBeNull()
		expect((req.existingPlan as Record<string, unknown>)?.objective).toBe("Earlier plan")
	})

	it("collects character profiles from characters/<id>/profile.yaml", () => {
		makeCharacter("sara", "name: Sara\nrole: protagonist\n")
		makeCharacter("miguel", "name: Miguel\nrole: ally\n")
		const path = makeChapter("---\nchapter: 1\nstatus: planned\n---\n\n")
		const req = composePlanRequest({ chapterPath: path, cwd: sandbox })
		expect(Object.keys(req.characterProfiles).sort()).toEqual(["miguel", "sara"])
		expect(req.characterProfiles.sara).toContain("Sara")
	})

	it("extracts active story line ids from story/story-lines.yaml", () => {
		makeStoryLines(`lines:
  - id: sara-investigation
    active: true
  - id: the-watcher
    active: true
  - id: abandoned-arc
    active: false
`)
		const path = makeChapter("---\nchapter: 1\nstatus: planned\n---\n\n")
		const req = composePlanRequest({ chapterPath: path, cwd: sandbox })
		expect(req.activeStoryLines).toEqual(["sara-investigation", "the-watcher"])
	})

	it("returns empty activeStoryLines when the file is missing", () => {
		const path = makeChapter("---\nchapter: 1\nstatus: planned\n---\n\n")
		const req = composePlanRequest({ chapterPath: path, cwd: sandbox })
		expect(req.activeStoryLines).toEqual([])
	})

	it("returns lastProseTail=null when no approved chapters exist", () => {
		const path = makeChapter("---\nchapter: 1\nstatus: planned\n---\n\n")
		const req = composePlanRequest({ chapterPath: path, cwd: sandbox })
		expect(req.lastProseTail).toBeNull()
	})

	it("returns approvedChapterCount=0 when no chapters are approved", () => {
		const path = makeChapter("---\nchapter: 1\nstatus: planned\n---\n\n")
		const req = composePlanRequest({ chapterPath: path, cwd: sandbox })
		expect(req.approvedChapterCount).toBe(0)
	})

	it("throws when the chapter file does not exist", () => {
		expect(() => composePlanRequest({ chapterPath: "missing.md", cwd: sandbox })).toThrow(
			/chapter file not found/,
		)
	})
})
