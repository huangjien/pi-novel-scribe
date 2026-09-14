import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { listResumableChapters } from "../extensions/novel/resume-scan.ts"

let sandbox: string
beforeEach(() => {
	sandbox = mkdtempSync(join(tmpdir(), "pi-novel-scribe-resume-test-"))
})
afterEach(() => {
	rmSync(sandbox, { recursive: true, force: true })
})

function makeChapter(filename: string, status: string | null): void {
	mkdirSync(join(sandbox, "chapters"), { recursive: true })
	const fm = status ? `status: "${status}"\n` : ""
	writeFileSync(join(sandbox, "chapters", filename), `---\nchapter: 5\n${fm}---\n\n`, "utf8")
}

describe("listResumableChapters", () => {
	it("returns chapters with non-terminal status", () => {
		makeChapter("0001.md", "approved")
		makeChapter("0002.md", "human_editing")
		makeChapter("0003.md", "drafted")
		const result = listResumableChapters(sandbox)
		const paths = result.map((r) => r.chapterPath.split("/").pop())
		expect(paths).toEqual(["0002.md", "0003.md"])
	})

	it("ignores chapters in approved/c canonized", () => {
		makeChapter("0001.md", "approved")
		makeChapter("0002.md", "canonized")
		const result = listResumableChapters(sandbox)
		expect(result.length).toBe(0)
	})

	it("ignores chapters without frontmatter", () => {
		mkdirSync(join(sandbox, "chapters"), { recursive: true })
		writeFileSync(join(sandbox, "chapters", "0001.md"), "just prose\n")
		const result = listResumableChapters(sandbox)
		expect(result.length).toBe(0)
	})

	it("returns empty array when chapters directory doesn't exist", () => {
		expect(listResumableChapters(sandbox)).toEqual([])
	})

	it("returns chapter number from frontmatter", () => {
		makeChapter("0007.md", "writing")
		const result = listResumableChapters(sandbox)
		expect(result[0]?.chapterNumber).toBe(5)
	})
})
