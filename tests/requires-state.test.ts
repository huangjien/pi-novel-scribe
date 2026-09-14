import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { checkRequiresState } from "../extensions/novel/requires-state.ts"

let sandbox: string
beforeEach(() => {
	sandbox = mkdtempSync(join(tmpdir(), "pi-novel-scribe-rs-test-"))
})
afterEach(() => {
	rmSync(sandbox, { recursive: true, force: true })
})

function makeChapter(filename: string, status: string | null): void {
	mkdirSync(join(sandbox, "chapters"), { recursive: true })
	const fm = status ? `status: ${status}\n` : ""
	writeFileSync(join(sandbox, "chapters", filename), `---\nchapter: 1\n${fm}---\n\n`, "utf8")
}

function makeCanonChange(id: string, status: "draft" | "validated"): void {
	const dir = join(sandbox, "state", "canon-changes")
	mkdirSync(dir, { recursive: true })
	writeFileSync(
		join(dir, `${id}.yaml.draft`),
		`id: ${id}\nstatus: ${status}\nproposed_in_chapter: 1\ntarget: sara\n`,
		"utf8",
	)
}

describe("checkRequiresState — chapters.next_unapproved", () => {
	it("returns satisfied when a chapter has no status set", () => {
		makeChapter("0001.md", null)
		const r = checkRequiresState(sandbox, ["chapters.next_unapproved"])
		expect(r.satisfied).toBe(true)
	})

	it("returns satisfied when a chapter is in a non-terminal status", () => {
		makeChapter("0001.md", "drafted")
		const r = checkRequiresState(sandbox, ["chapters.next_unapproved"])
		expect(r.satisfied).toBe(true)
	})

	it("returns not-satisfied when all chapters are approved", () => {
		makeChapter("0001.md", "approved")
		makeChapter("0002.md", "approved")
		const r = checkRequiresState(sandbox, ["chapters.next_unapproved"])
		expect(r.satisfied).toBe(false)
	})
})

describe("checkRequiresState — chapters.drafted_or_approved", () => {
	it("satisfied when one chapter is drafted", () => {
		makeChapter("0001.md", "drafted")
		const r = checkRequiresState(sandbox, ["chapters.drafted_or_approved"])
		expect(r.satisfied).toBe(true)
	})

	it("satisfied when one chapter is approved", () => {
		makeChapter("0001.md", "approved")
		const r = checkRequiresState(sandbox, ["chapters.drafted_or_approved"])
		expect(r.satisfied).toBe(true)
	})

	it("not-satisfied when chapters are only planned", () => {
		makeChapter("0001.md", "planned")
		const r = checkRequiresState(sandbox, ["chapters.drafted_or_approved"])
		expect(r.satisfied).toBe(false)
	})
})

describe("checkRequiresState — workflow.pending_approval", () => {
	it("satisfied when a draft exists with status=draft", () => {
		makeCanonChange("F-1", "draft")
		const r = checkRequiresState(sandbox, ["workflow.pending_approval"])
		expect(r.satisfied).toBe(true)
	})

	it("satisfied when a draft exists with status=validated", () => {
		makeCanonChange("F-1", "validated")
		const r = checkRequiresState(sandbox, ["workflow.pending_approval"])
		expect(r.satisfied).toBe(true)
	})

	it("not-satisfied when no canon-changes directory exists", () => {
		const r = checkRequiresState(sandbox, ["workflow.pending_approval"])
		expect(r.satisfied).toBe(false)
	})
})

describe("checkRequiresState — unknown requirements", () => {
	it("reports unknown requirements as failed", () => {
		const r = checkRequiresState(sandbox, ["unmapped.requirement"])
		expect(r.satisfied).toBe(false)
		expect(r.failed[0]?.reason).toContain("unknown requirement")
	})
})

describe("checkRequiresState — multi-requirement aggregation", () => {
	it("requires all checks to pass", () => {
		makeChapter("0001.md", "approved")
		const r = checkRequiresState(sandbox, [
			"chapters.drafted_or_approved",
			"workflow.pending_approval", // not satisfied
		])
		expect(r.satisfied).toBe(false)
		expect(r.checks.length).toBe(2)
		expect(r.failed.length).toBe(1)
	})
})
