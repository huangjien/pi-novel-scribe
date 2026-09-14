import { describe, expect, it } from "vitest"
import { type ApprovalOutcome, decideOutcome, type GateResult } from "../extensions/editor/gate.ts"
import type { EditorResult } from "../extensions/editor/open.ts"

function editor(saved: boolean): EditorResult {
	return {
		saved,
		exitCode: 0,
		durationMs: 100,
		beforeMtimeMs: 0,
		afterMtimeMs: saved ? 1000 : 0,
	}
}

describe("decideOutcome", () => {
	it("returns rolled-back when editor.saved is false", () => {
		const outcome = decideOutcome("before", editor(false), "before")
		expect(outcome).toBe<ApprovalOutcome>("rolled-back")
	})

	it("returns rolled-back when saved=false even with content change", () => {
		// saved=false means the user quit without saving — content on disk
		// may or may not differ, but we honor the saved flag.
		const outcome = decideOutcome("before", editor(false), "after-with-changes")
		expect(outcome).toBe<ApprovalOutcome>("rolled-back")
	})

	it("returns approved-as-stated when saved but content unchanged", () => {
		const outcome = decideOutcome("before", editor(true), "before")
		expect(outcome).toBe<ApprovalOutcome>("approved-as-stated")
	})

	it("returns approved when saved and content changed", () => {
		const outcome = decideOutcome("before", editor(true), "after-with-changes")
		expect(outcome).toBe<ApprovalOutcome>("approved")
	})
})

// Type-level smoke test: ensure GateResult shape compiles.
const _shape: GateResult = {
	outcome: "approved",
	before: "",
	after: "",
	saved: true,
	exitCode: 0,
	durationMs: 1,
}
void _shape
