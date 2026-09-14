/**
 * Canon Change approval flow. Per Q8 + ADR-0002, the editor is the
 * approval gate. Once a Canon Change is `validated` (Phase 5+ workflow),
 * we open the .yaml.draft in the user's editor. Save = approve;
 * no-change = approve-as-stated; quit-no-save = rollback.
 *
 * This file is the integration between `canon.ts` (file lifecycle) and
 * `editor/gate.ts` (editor-as-gate primitive). Pure orchestrator; the
 * actual editor spawn happens in gate.ts.
 */

import { existsSync, readFileSync, unlinkSync } from "node:fs"
import { type ApprovalOutcome, decideOutcome, type EditorGateStatus } from "../editor/gate.ts"
import { applyCanonChange, listDraftCanonChanges } from "./canon.ts"

export interface ApproveCanonInput {
	readonly novelRepo: string
	readonly changeId: string
	readonly approvedInChapter: number
	readonly editorResult: EditorGateStatus
}

export interface ApproveCanonResult {
	readonly outcome: ApprovalOutcome
	readonly changeId: string
	readonly applied: boolean
	readonly approvedPath: string | null
}

const CHANGE_DIR = "state/canon-changes"

/**
 * Pure decision function (testable): given the editor gate outcome and
 * whether the change is now applied, produce the canonical result.
 */
export function decideApproval(
	gateOutcome: ApprovalOutcome,
	draftPath: string,
	editorResult: EditorGateStatus,
	approvedPath: string | null,
): ApproveCanonResult {
	if (gateOutcome === "rolled-back") {
		return {
			outcome: "rolled-back",
			changeId: changeIdFromPath(draftPath),
			applied: false,
			approvedPath: null,
		}
	}
	if (approvedPath === null) {
		throw new Error("decideApproval: outcome is not rolled-back but approvedPath is null")
	}
	void editorResult
	return {
		outcome: gateOutcome,
		changeId: changeIdFromPath(draftPath),
		applied: true,
		approvedPath,
	}
}

/**
 * End-to-end helper. Reads the .yaml.draft, returns the result of the
 * editor-as-gate decision. Pure — does not actually spawn an editor.
 * The caller is responsible for invoking `openApprovalGate()` first
 * (because spawning belongs to the LLM context, not to a pure file
 * helper).
 */
export function applyApprovalFromGate(
	draftPath: string,
	approvedInChapter: number,
	editorResult: {
		readonly saved: boolean
		readonly exitCode: number | null
		readonly durationMs: number
	},
): ApproveCanonResult {
	if (!existsSync(draftPath)) {
		throw new Error(`No draft at ${draftPath}`)
	}
	const before = readFileSync(draftPath, "utf8")
	const after = editorResult.saved ? readFileSync(draftPath, "utf8") : before
	const outcome = decideOutcome(
		before,
		editorResult as unknown as Parameters<typeof decideOutcome>[1],
		after,
	)

	if (outcome === "rolled-back") {
		// Move the .draft aside so it's clear it was rolled back.
		try {
			unlinkSync(draftPath)
		} catch {
			// best-effort cleanup
		}
		return decideApproval(outcome, draftPath, editorResult, null)
	}

	const changeId = changeIdFromPath(draftPath)
	const novelRepo = novelRepoFromDraftPath(draftPath)
	const result = applyCanonChange(novelRepo, changeId, approvedInChapter)
	return decideApproval(outcome, draftPath, editorResult, result.applied_path)
}

function changeIdFromPath(draftPath: string): string {
	const base = draftPath.split("/").pop() ?? ""
	return base.replace(/\.yaml\.draft$/, "")
}

function novelRepoFromDraftPath(draftPath: string): string {
	// draftPath is `<novelRepo>/state/canon-changes/<id>.yaml.draft`
	// → strip the trailing `state/canon-changes/<id>.yaml.draft`.
	const idx = draftPath.indexOf(`/${CHANGE_DIR}/`)
	if (idx === -1) {
		throw new Error(`draftPath ${draftPath} does not contain ${CHANGE_DIR}`)
	}
	return draftPath.slice(0, idx)
}

// Re-export for tests that need to construct draft paths.
// Helper for symmetry with `applyCanonChange` — re-exported so
// callers can list all pending drafts from outside.
export { CHANGE_DIR, listDraftCanonChanges }
