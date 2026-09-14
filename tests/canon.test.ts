import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	applyCanonChange,
	deprecateCanonChange,
	listDraftCanonChanges,
	proposeCanonChange,
} from "../extensions/novel/canon.ts"

let sandbox: string
beforeEach(() => {
	sandbox = mkdtempSync(join(tmpdir(), "pi-novel-scribe-canon-"))
})
afterEach(() => {
	rmSync(sandbox, { recursive: true, force: true })
})

const SAMPLE_INPUT = {
	id: "F-023-ch5",
	kind: "character_belief_added" as const,
	target: "sara",
	payload: { believes: ["john_is_alive"] },
	rationale: "Sara POV scene 5 directly states 'John is alive'.",
	proposed_in_chapter: 5,
	chapter_file: "chapters/0005.md",
}

describe("proposeCanonChange", () => {
	it("writes a draft file under state/canon-changes/", () => {
		const draftPath = proposeCanonChange(sandbox, SAMPLE_INPUT)
		expect(draftPath).toContain("state/canon-changes/F-023-ch5.yaml.draft")

		const canonicalDraftDir = join(sandbox, "state", "canon-changes")
		expect(() => mkdirSync(canonicalDraftDir, { recursive: true })).not.toThrow()
	})

	it("stores the change with status=draft and proposed_in_chapter=N", () => {
		proposeCanonChange(sandbox, SAMPLE_INPUT)
		const drafts = listDraftCanonChanges(sandbox)
		expect(drafts.length).toBe(1)
		expect(drafts[0]?.id).toBe("F-023-ch5")
		expect(drafts[0]?.status).toBe("draft")
		expect(drafts[0]?.proposed_in_chapter).toBe(5)
		expect(drafts[0]?.target).toBe("sara")
		expect(drafts[0]?.payload).toEqual({ believes: ["john_is_alive"] })
	})

	it("stamps proposed_by default to writer", () => {
		proposeCanonChange(sandbox, SAMPLE_INPUT)
		const drafts = listDraftCanonChanges(sandbox)
		expect(drafts[0]?.proposed_by).toBe("writer")
	})

	it("respects proposed_by override", () => {
		proposeCanonChange(sandbox, { ...SAMPLE_INPUT, proposed_by: "author" })
		const drafts = listDraftCanonChanges(sandbox)
		expect(drafts[0]?.proposed_by).toBe("author")
	})

	it("throws on invalid kind", () => {
		expect(() =>
			proposeCanonChange(sandbox, {
				...SAMPLE_INPUT,
				kind: "not_a_real_kind" as typeof SAMPLE_INPUT.kind,
			}),
		).toThrow(/kind/)
	})

	it("throws on empty target", () => {
		expect(() => proposeCanonChange(sandbox, { ...SAMPLE_INPUT, target: "" })).toThrow(/target/)
	})
})

describe("applyCanonChange", () => {
	it("promotes a draft to a durable .yaml", () => {
		proposeCanonChange(sandbox, SAMPLE_INPUT)
		const result = applyCanonChange(sandbox, "F-023-ch5", 7)
		expect(result.change.status).toBe("approved")
		expect(result.change.approved_in_chapter).toBe(7)
		expect(result.applied_path).toContain("state/canon-changes/F-023-ch5.yaml")

		const draftsAfter = listDraftCanonChanges(sandbox)
		expect(draftsAfter.length).toBe(0)
	})

	it("throws when no draft exists", () => {
		expect(() => applyCanonChange(sandbox, "missing-change", 1)).toThrow(/No draft/)
	})
})

describe("deprecateCanonChange", () => {
	it("marks an applied change as deprecated with a reason", () => {
		proposeCanonChange(sandbox, SAMPLE_INPUT)
		applyCanonChange(sandbox, "F-023-ch5", 7)
		deprecateCanonChange(sandbox, "F-023-ch5", "Superseded by F-024")

		const yamlPath = join(sandbox, "state", "canon-changes", "F-023-ch5.yaml")
		const raw = require("node:fs").readFileSync(yamlPath, "utf8")
		expect(raw).toContain("deprecated")
		expect(raw).toContain("Superseded by F-024")
	})

	it("is a no-op when the change doesn't exist", () => {
		expect(() => deprecateCanonChange(sandbox, "ghost", "reason")).not.toThrow()
	})
})

describe("listDraftCanonChanges", () => {
	it("returns empty array when no drafts exist", () => {
		expect(listDraftCanonChanges(sandbox)).toEqual([])
	})

	it("returns only *.draft files (not approved *.yaml)", () => {
		proposeCanonChange(sandbox, SAMPLE_INPUT)
		applyCanonChange(sandbox, "F-023-ch5", 7)
		expect(listDraftCanonChanges(sandbox)).toEqual([])
	})
})
