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

describe("checkRequiresState — chapters.plan_template_refs (Q22)", () => {
	it("satisfied when the chapter has no plan yet (Planner enforces at creation)", () => {
		makeChapter("0001.md", "drafted")
		const report = checkRequiresState(sandbox, ["chapters.plan_template_refs"])
		expect(report.satisfied).toBe(true)
		expect(report.checks[0]?.reason).toContain("no plan yet")
	})

	it("satisfied when the plan cites template_refs", () => {
		const dir = join(sandbox, "chapters")
		mkdirSync(dir, { recursive: true })
		writeFileSync(
			join(dir, "0001.md"),
			[
				"---",
				"chapter: 1",
				"status: drafted",
				"plan:",
				"  objective: reveal the letter",
				"  template_refs:",
				"    - table: scene_templates",
				'      id: "template-1"',
				"      how_used: paces the reveal",
				"---",
				"",
			].join("\n"),
			"utf8",
		)
		const report = checkRequiresState(sandbox, ["chapters.plan_template_refs"])
		expect(report.satisfied).toBe(true)
		expect(report.checks[0]?.reason).toContain("template ref")
	})

	it("unsatisfied when the plan has neither template_refs nor a reasoned exemption", () => {
		const dir = join(sandbox, "chapters")
		mkdirSync(dir, { recursive: true })
		writeFileSync(
			join(dir, "0001.md"),
			"---\nchapter: 1\nstatus: drafted\nplan:\n  objective: no citations here\n---\n\n",
			"utf8",
		)
		const report = checkRequiresState(sandbox, ["chapters.plan_template_refs"])
		expect(report.satisfied).toBe(false)
		expect(report.checks[0]?.reason).toContain("Q22")
	})

	it("satisfied when the plan declares template_refs_exempt with a rationale", () => {
		const dir = join(sandbox, "chapters")
		mkdirSync(dir, { recursive: true })
		writeFileSync(
			join(dir, "0001.md"),
			[
				"---",
				"chapter: 1",
				"status: drafted",
				"plan:",
				"  objective: interlude",
				"  template_refs_exempt: true",
				"  template_refs_exempt_rationale: vignette chapter, no corpus fit",
				"---",
				"",
			].join("\n"),
			"utf8",
		)
		expect(checkRequiresState(sandbox, ["chapters.plan_template_refs"]).satisfied).toBe(true)
	})

	it("unsatisfied when template_refs_exempt is true but the rationale is missing", () => {
		const dir = join(sandbox, "chapters")
		mkdirSync(dir, { recursive: true })
		writeFileSync(
			join(dir, "0001.md"),
			"---\nchapter: 1\nstatus: drafted\nplan:\n  template_refs_exempt: true\n---\n\n",
			"utf8",
		)
		const report = checkRequiresState(sandbox, ["chapters.plan_template_refs"])
		expect(report.satisfied).toBe(false)
		expect(report.checks[0]?.reason).toContain("rationale is missing")
	})

	it("skips approved chapters — only writable chapters are validated", () => {
		const dir = join(sandbox, "chapters")
		mkdirSync(dir, { recursive: true })
		writeFileSync(
			join(dir, "0001.md"),
			"---\nchapter: 1\nstatus: approved\nplan:\n  template_refs_exempt: true\n---\n\n",
			"utf8",
		)
		const report = checkRequiresState(sandbox, ["chapters.plan_template_refs"])
		expect(report.satisfied).toBe(true)
		expect(report.checks[0]?.reason).toContain("no writable chapter found")
	})

	it("satisfied when the chapters directory is missing", () => {
		const report = checkRequiresState(sandbox, ["chapters.plan_template_refs"])
		expect(report.satisfied).toBe(true)
		expect(report.checks[0]?.reason).toContain("nothing to validate")
	})

	it("skips chapters without frontmatter", () => {
		const dir = join(sandbox, "chapters")
		mkdirSync(dir, { recursive: true })
		writeFileSync(join(dir, "0001.md"), "plain prose, no frontmatter\n", "utf8")
		const report = checkRequiresState(sandbox, ["chapters.plan_template_refs"])
		expect(report.satisfied).toBe(true)
		expect(report.checks[0]?.reason).toContain("nothing to validate")
	})
})

describe("checkRequiresState — chapters.reviewed", () => {
	it("unsatisfied when there is no chapters directory", () => {
		const report = checkRequiresState(sandbox, ["chapters.reviewed"])
		expect(report.satisfied).toBe(false)
		expect(report.checks[0]?.reason).toBe("no chapters directory")
	})

	it("satisfied when a chapter carries review frontmatter with reviewedAt", () => {
		const dir = join(sandbox, "chapters")
		mkdirSync(dir, { recursive: true })
		writeFileSync(
			join(dir, "0001.md"),
			"---\nchapter: 1\nreview:\n  reviewedAt: 2026-09-20\n---\n\n",
			"utf8",
		)
		const report = checkRequiresState(sandbox, ["chapters.reviewed"])
		expect(report.satisfied).toBe(true)
		expect(report.checks[0]?.reason).toContain("review:")
	})

	it("unsatisfied when a review block exists but has no reviewedAt", () => {
		const dir = join(sandbox, "chapters")
		mkdirSync(dir, { recursive: true })
		writeFileSync(join(dir, "0001.md"), "---\nchapter: 1\nreview:\n  issues: []\n---\n\n", "utf8")
		const report = checkRequiresState(sandbox, ["chapters.reviewed"])
		expect(report.satisfied).toBe(false)
		expect(report.checks[0]?.reason).toContain("no chapter has a review")
	})
})

describe("checkRequiresState — workflow.pending_approval edge cases", () => {
	it("ignores drafts whose status is neither draft nor validated", () => {
		const dir = join(sandbox, "state", "canon-changes")
		mkdirSync(dir, { recursive: true })
		writeFileSync(join(dir, "F-1.yaml.draft"), "id: F-1\nstatus: deprecated\n", "utf8")
		const report = checkRequiresState(sandbox, ["workflow.pending_approval"])
		expect(report.satisfied).toBe(false)
		expect(report.checks[0]?.reason).toContain("no pending canon-changes drafts")
	})

	it("skips malformed draft files instead of throwing", () => {
		const dir = join(sandbox, "state", "canon-changes")
		mkdirSync(dir, { recursive: true })
		writeFileSync(join(dir, "broken.yaml.draft"), "\t- [unclosed", "utf8")
		const report = checkRequiresState(sandbox, ["workflow.pending_approval"])
		expect(report.satisfied).toBe(false)
	})

	it("ignores non-draft files in the canon-changes directory", () => {
		const dir = join(sandbox, "state", "canon-changes")
		mkdirSync(dir, { recursive: true })
		writeFileSync(join(dir, "F-1.yaml"), "id: F-1\nstatus: approved\n", "utf8")
		const report = checkRequiresState(sandbox, ["workflow.pending_approval"])
		expect(report.satisfied).toBe(false)
	})
})

describe("checkRequiresState — unrecognized chapter statuses", () => {
	it("treats an unrecognized status value as no-status for next_unapproved", () => {
		const dir = join(sandbox, "chapters")
		mkdirSync(dir, { recursive: true })
		writeFileSync(join(dir, "0001.md"), "---\nchapter: 1\nstatus: planning\n---\n\n", "utf8")
		const report = checkRequiresState(sandbox, ["chapters.next_unapproved"])
		expect(report.satisfied).toBe(true)
		expect(report.checks[0]?.reason).toContain("no status set yet")
	})

	it("chapters.drafted_or_approved is unsatisfied when no chapter qualifies", () => {
		makeChapter("0001.md", "canonized")
		makeChapter("0002.md", "human_editing")
		const report = checkRequiresState(sandbox, ["chapters.drafted_or_approved"])
		expect(report.satisfied).toBe(false)
		expect(report.checks[0]?.reason).toContain("no chapter in status=drafted")
	})

	it("chapters.drafted_or_approved is satisfied by a drafted chapter", () => {
		makeChapter("0001.md", "drafted")
		const report = checkRequiresState(sandbox, ["chapters.drafted_or_approved"])
		expect(report.satisfied).toBe(true)
		expect(report.checks[0]?.reason).toContain("status=drafted")
	})
})
