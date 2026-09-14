import { describe, expect, it } from "vitest"
import {
	applyStatus,
	type ChapterFrontmatter,
	getStatus,
	parseFrontmatter,
	serializeFrontmatter,
	setStatus,
	WORKFLOW_STATUSES,
} from "../extensions/workflow/status.ts"

describe("parseFrontmatter", () => {
	it("extracts key-value frontmatter and returns the body", () => {
		const content = `---
chapter: 5
title: "The Lighthouse"
status: drafted
---

# Chapter 5

Prose begins here.
`
		const { frontmatter, body } = parseFrontmatter(content)
		expect(frontmatter.chapter).toBe(5)
		expect(frontmatter.title).toBe("The Lighthouse")
		expect(frontmatter.status).toBe("drafted")
		expect(body.trim()).toBe("# Chapter 5\n\nProse begins here.")
	})

	it("returns empty frontmatter when no leading --- block", () => {
		const content = "# Just a title\n\nBody without frontmatter.\n"
		const { frontmatter, body } = parseFrontmatter(content)
		expect(frontmatter).toEqual({})
		expect(body).toBe(content)
	})

	it("parses boolean and null values", () => {
		const content = `---
flag_true: true
flag_false: false
empty: null
count: 0
---
body
`
		const { frontmatter } = parseFrontmatter(content)
		expect(frontmatter.flag_true).toBe(true)
		expect(frontmatter.flag_false).toBe(false)
		expect(frontmatter.empty).toBe(null)
		expect(frontmatter.count).toBe(0)
	})

	it("ignores comments and blank lines", () => {
		const content = `---
# this is a comment
chapter: 1

title: "Hello"
---
body
`
		const { frontmatter } = parseFrontmatter(content)
		expect(frontmatter.chapter).toBe(1)
		expect(frontmatter.title).toBe("Hello")
		expect(Object.keys(frontmatter)).toHaveLength(2)
	})
})

describe("serializeFrontmatter", () => {
	it("round-trips a parsed frontmatter", () => {
		const original = { chapter: 5, title: "Test", status: "drafted" as const }
		const serialized = serializeFrontmatter(original)
		const reparsed = parseFrontmatter(`${serialized}\n\nbody`)
		expect(reparsed.frontmatter).toEqual(original)
	})

	it("skips undefined values", () => {
		const result = serializeFrontmatter({ a: 1, b: undefined, c: "x" })
		expect(result).not.toContain("b")
		expect(result).toContain("a")
		expect(result).toContain("c")
	})

	it("uses JSON.stringify to escape nested strings", () => {
		const result = serializeFrontmatter({ title: 'has "quotes"' })
		expect(result).toContain('"has \\"quotes\\""')
	})
})

describe("getStatus / setStatus", () => {
	it("returns undefined when no status set", () => {
		expect(getStatus({})).toBeUndefined()
		expect(getStatus({ status: undefined })).toBeUndefined()
	})

	it("returns the status when set to a valid workflow value", () => {
		expect(getStatus({ status: "drafted" })).toBe("drafted")
		expect(getStatus({ status: "approved" })).toBe("approved")
	})

	it("returns undefined for an unknown status (catches typos)", () => {
		const bogus = { status: "draftted" } as unknown as ChapterFrontmatter
		expect(getStatus(bogus)).toBeUndefined()
	})

	it("setStatus returns a NEW frontmatter (immutable)", () => {
		const original: ChapterFrontmatter = { chapter: 1 }
		const updated = setStatus(original, "drafted")
		expect(original.status).toBeUndefined()
		expect(updated.status).toBe("drafted")
		expect(updated).not.toBe(original)
	})
})

describe("WORKFLOW_STATUSES", () => {
	it("lists all §18 enum values", () => {
		expect(WORKFLOW_STATUSES).toEqual([
			"planned",
			"writing",
			"drafted",
			"human_editing",
			"edited",
			"continuity_check",
			"reviewing",
			"revision_required",
			"approved",
			"canonized",
		])
	})
})

describe("applyStatus", () => {
	it("updates the frontmatter and writes back the file", () => {
		const fakeFs = {
			readFileSync: (path: string) => {
				expect(path).toBe("/chapters/0001.md")
				return `---
chapter: 1
status: planned
---
# Chapter 1
`
			},
			writeFileSync: (path: string, data: string) => {
				expect(path).toBe("/chapters/0001.md")
				expect(data).toMatch(/status: "drafted"/)
				expect(data).toContain("# Chapter 1")
			},
		}
		applyStatus("/chapters/0001.md", "drafted", fakeFs)
	})

	it("preserves all other frontmatter fields", () => {
		const written: { path: string; data: string } = { path: "", data: "" }
		const fakeFs = {
			readFileSync: () =>
				`---
chapter: 5
title: "Lighthouse"
status: planned
plan: "Sara confronts Miguel"
---
prose
`,
			writeFileSync: (path: string, data: string) => {
				written.path = path
				written.data = data
			},
		}
		applyStatus("/chapters/0005.md", "human_editing", fakeFs)
		expect(written.path).toBe("/chapters/0005.md")
		expect(written.data).toContain("chapter: 5")
		expect(written.data).toContain('title: "Lighthouse"')
		expect(written.data).toContain('status: "human_editing"')
		expect(written.data).toContain('plan: "Sara confronts Miguel"')
		expect(written.data).toContain("prose")
	})
})
