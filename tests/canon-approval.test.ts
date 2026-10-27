/**
 * Tests for the Canon Change approval flow (extensions/novel/canon-approval.ts).
 *
 * Per Q8: save = approve, no-change = approve-as-stated, quit-no-save
 * = rollback. The end-to-end path (applyApprovalFromGate) integrates
 * canon.ts file lifecycle with gate.ts outcome semantics; the pure
 * decideApproval contract is tested separately.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as yaml from "js-yaml"
import { describe, expect, it } from "vitest"
import { proposeCanonChange } from "../extensions/novel/canon.ts"
import {
	applyApprovalFromGate,
	CHANGE_DIR,
	decideApproval,
	listDraftCanonChanges,
} from "../extensions/novel/canon-approval.ts"

const SAMPLE_INPUT = {
	id: "F-023-ch5",
	kind: "character_belief_added" as const,
	target: "sara",
	payload: { believes: ["john_is_alive"] },
	rationale: "Sara POV scene 5 directly states 'John is alive'.",
	proposed_in_chapter: 5,
	chapter_file: "chapters/0005.md",
}

function makeRepo(): string {
	const repo = mkdtempSync(join(tmpdir(), "canon-approval-"))
	return repo
}

function propose(repo: string): string {
	return proposeCanonChange(repo, SAMPLE_INPUT)
}

describe("decideApproval (pure)", () => {
	it("rolled-back outcome reports applied=false and no approved path", () => {
		const result = decideApproval(
			"rolled-back",
			"/novel/state/canon-changes/F-1.yaml.draft",
			{ saved: false },
			null,
		)
		expect(result.outcome).toBe("rolled-back")
		expect(result.changeId).toBe("F-1")
		expect(result.applied).toBe(false)
		expect(result.approvedPath).toBeNull()
	})

	it("approved-as-stated outcome reports applied=true with the approved path", () => {
		const result = decideApproval(
			"approved-as-stated",
			"/novel/state/canon-changes/F-2.yaml.draft",
			{ saved: true },
			"/novel/state/canon-changes/F-2.yaml",
		)
		expect(result.outcome).toBe("approved-as-stated")
		expect(result.changeId).toBe("F-2")
		expect(result.applied).toBe(true)
		expect(result.approvedPath).toBe("/novel/state/canon-changes/F-2.yaml")
	})

	it("edited outcome reports applied=true", () => {
		const result = decideApproval(
			"approved",
			"/novel/state/canon-changes/F-3.yaml.draft",
			{ saved: true },
			"/novel/state/canon-changes/F-3.yaml",
		)
		expect(result.outcome).toBe("approved")
		expect(result.applied).toBe(true)
	})

	it("throws when outcome is not rolled-back but approvedPath is null", () => {
		expect(() =>
			decideApproval(
				"approved",
				"/novel/state/canon-changes/F-4.yaml.draft",
				{ saved: true },
				null,
			),
		).toThrow(/approvedPath is null/)
	})
})

describe("applyApprovalFromGate (end-to-end)", () => {
	it("save-without-changes approves as stated, promotes the draft, and retires it", () => {
		const repo = makeRepo()
		try {
			const draftPath = propose(repo)
			const result = applyApprovalFromGate(draftPath, 7, {
				saved: true,
				exitCode: 0,
				durationMs: 50,
			})

			expect(result.outcome).toBe("approved-as-stated")
			expect(result.changeId).toBe("F-023-ch5")
			expect(result.applied).toBe(true)

			const approvedPath = join(repo, CHANGE_DIR, "F-023-ch5.yaml")
			expect(result.approvedPath).toBe(approvedPath)
			expect(existsSync(approvedPath)).toBe(true)

			const approved = yaml.load(readFileSync(approvedPath, "utf8")) as {
				status: string
				approved_in_chapter: number | null
			}
			expect(approved.status).toBe("approved")
			expect(approved.approved_in_chapter).toBe(7)

			// The draft is retired (renamed), so no pending drafts remain.
			expect(existsSync(draftPath)).toBe(false)
			expect(listDraftCanonChanges(repo)).toEqual([])
		} finally {
			rmSync(repo, { recursive: true, force: true })
		}
	})

	/**
	 * The helper reads before/after synchronously back-to-back, so a saved
	 * gate always lands as approved-as-stated here (the before→editor→after
	 * gap only exists in the async openApprovalGate flow). Whatever content
	 * is on disk at call time is what gets promoted.
	 */
	it("save promotes whatever draft content is on disk, as approved-as-stated", () => {
		const repo = makeRepo()
		try {
			const draftPath = propose(repo)
			const edited = (yaml.load(readFileSync(draftPath, "utf8")) as Record<string, unknown>) ?? {}
			edited.payload = { believes: ["john_is_alive", "lighthouse_was_abandoned_in_1987"] }
			writeFileSync(draftPath, yaml.dump(edited), "utf8")

			const result = applyApprovalFromGate(draftPath, 8, {
				saved: true,
				exitCode: 0,
				durationMs: 50,
			})

			expect(result.outcome).toBe("approved-as-stated")
			expect(result.applied).toBe(true)

			const approvedPath = join(repo, CHANGE_DIR, "F-023-ch5.yaml")
			const approved = yaml.load(readFileSync(approvedPath, "utf8")) as {
				payload: { believes: string[] }
			}
			expect(approved.payload.believes).toContain("lighthouse_was_abandoned_in_1987")
		} finally {
			rmSync(repo, { recursive: true, force: true })
		}
	})

	it("quit-without-save rolls back and deletes the draft", () => {
		const repo = makeRepo()
		try {
			const draftPath = propose(repo)
			const result = applyApprovalFromGate(draftPath, 7, {
				saved: false,
				exitCode: 0,
				durationMs: 50,
			})

			expect(result.outcome).toBe("rolled-back")
			expect(result.applied).toBe(false)
			expect(result.approvedPath).toBeNull()
			expect(existsSync(draftPath)).toBe(false)
			expect(existsSync(join(repo, CHANGE_DIR, "F-023-ch5.yaml"))).toBe(false)
		} finally {
			rmSync(repo, { recursive: true, force: true })
		}
	})

	it("throws when no draft exists at the path", () => {
		const repo = makeRepo()
		try {
			expect(() =>
				applyApprovalFromGate(join(repo, CHANGE_DIR, "missing.yaml.draft"), 7, {
					saved: true,
					exitCode: 0,
					durationMs: 50,
				}),
			).toThrow(/No draft at/)
		} finally {
			rmSync(repo, { recursive: true, force: true })
		}
	})

	it("throws when the draft path does not live under state/canon-changes", () => {
		const repo = makeRepo()
		try {
			const stray = join(repo, "stray.yaml.draft")
			writeFileSync(stray, yaml.dump({ id: "stray", status: "draft" }), "utf8")
			expect(() =>
				applyApprovalFromGate(stray, 7, { saved: true, exitCode: 0, durationMs: 50 }),
			).toThrow(new RegExp(`does not contain ${CHANGE_DIR}`))
		} finally {
			rmSync(repo, { recursive: true, force: true })
		}
	})
})

describe("re-exports", () => {
	it("exports CHANGE_DIR and listDraftCanonChanges for callers", () => {
		expect(CHANGE_DIR).toBe("state/canon-changes")
		const repo = makeRepo()
		try {
			propose(repo)
			expect(listDraftCanonChanges(repo).map((c) => c.id)).toEqual(["F-023-ch5"])
		} finally {
			rmSync(repo, { recursive: true, force: true })
		}
	})
})
