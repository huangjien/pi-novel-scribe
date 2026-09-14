import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { composeCriticContext } from "../extensions/novel/critic-context.ts"
import { extractYamlBlock } from "../extensions/novel/yaml-extract.ts"

let sandbox: string
beforeEach(() => {
	sandbox = mkdtempSync(join(tmpdir(), "pi-novel-scribe-critic-ctx-"))
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

const SAMPLE_CHAPTER = `---
chapter: 5
status: drafted
plan:
  objective: "Sara confronts Miguel"
  conflict: "Sara suspects Miguel of hiding John"
---

@scene id=lighthouse pov:sara location=lighthouse

Sara walked to the lighthouse alone. Miguel was nowhere. She felt the wind, the cold salt air.
`

describe("composeCriticContext", () => {
	it("returns novelRepo, chapterPath, chapterNumber, prose, wordCount", () => {
		const path = makeChapter(SAMPLE_CHAPTER)
		const c = composeCriticContext({ chapterPath: path, cwd: sandbox })
		expect(c.novelRepo).toBe(sandbox)
		expect(c.chapterPath).toBe(path)
		expect(c.chapterNumber).toBe(5)
		expect(c.prose).toContain("walked to the lighthouse")
		expect(c.wordCount).toBeGreaterThan(0)
	})

	it("parses nested plan: block via js-yaml", () => {
		const path = makeChapter(SAMPLE_CHAPTER)
		const c = composeCriticContext({ chapterPath: path, cwd: sandbox })
		expect(c.plan).not.toBeNull()
		expect((c.plan as Record<string, unknown>)?.objective).toBe("Sara confronts Miguel")
		expect((c.plan as Record<string, unknown>)?.conflict).toBe(
			"Sara suspects Miguel of hiding John",
		)
	})

	it("extracts POV from @scene marker", () => {
		const path = makeChapter(SAMPLE_CHAPTER)
		const c = composeCriticContext({ chapterPath: path, cwd: sandbox })
		expect(c.pov).toBe("sara")
	})

	it("loads the POV character's profile when present", () => {
		const path = makeChapter(SAMPLE_CHAPTER)
		makeCharacter("sara", "name: Sara\nrole: protagonist\n")
		const c = composeCriticContext({ chapterPath: path, cwd: sandbox })
		expect(c.characterProfile).toContain("protagonist")
	})

	it("returns activeStoryLines from story/story-lines.yaml", () => {
		const path = makeChapter(SAMPLE_CHAPTER)
		makeStoryLines(`lines:
  - id: sara-investigation
    active: true
    intent: "Sara finds John"
  - id: the-watcher
    active: false
    intent: "Stranger watches Sara"
`)
		const c = composeCriticContext({ chapterPath: path, cwd: sandbox })
		expect(c.activeStoryLines).toEqual(["sara-investigation"])
	})

	it("returns storyLineIndex as id:intent pairs", () => {
		const path = makeChapter(SAMPLE_CHAPTER)
		makeStoryLines(`lines:
  - id: sara-investigation
    active: true
    intent: "Sara finds John"
`)
		const c = composeCriticContext({ chapterPath: path, cwd: sandbox })
		expect(c.storyLineIndex).toContain("sara-investigation: Sara finds John")
	})

	it("throws when chapter file is missing", () => {
		expect(() => composeCriticContext({ chapterPath: "missing.md", cwd: sandbox })).toThrow(
			/chapter file not found/,
		)
	})

	it("handles chapter without @scene marker (pov=null)", () => {
		const content = `---
chapter: 7
status: drafted
---

Just prose. No markers.
`
		const path = makeChapter(content, "0007.md")
		const c = composeCriticContext({ chapterPath: path, cwd: sandbox })
		expect(c.pov).toBeNull()
		expect(c.characterProfile).toBeNull()
	})
})

describe("extractYamlBlock (shared helper)", () => {
	it("extracts a ```yaml block", () => {
		const out = extractYamlBlock("```yaml\nreview:\n  issues:\n    - a\n```")
		expect(out).not.toBeNull()
		expect(out).toContain("issues")
	})

	it("returns null on no fence", () => {
		expect(extractYamlBlock("no fence here")).toBeNull()
	})
})
