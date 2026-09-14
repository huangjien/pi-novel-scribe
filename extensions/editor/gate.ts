/**
 * Approval gate primitive. Per Q8 + ADR-0002:
 *
 *   Open an authored artifact (e.g., state/character-beliefs.yaml,
 *   state/canon-changes/<id>.yaml.draft) in the user's $VISUAL/$EDITOR.
 *   On editor exit:
 *
 *     - Save & quit (file modified) → outcome: approved
 *     - Save & quit (no modification) → outcome: approved-as-stated
 *     - Quit without save → outcome: rolled-back
 *
 * The gate is a thin orchestration over `openInEditor()` (status of
 * the file's mtime tells us whether the author actually saved).
 */

import { readFileSync } from "node:fs"
import { type EditorResult, openInEditor, type SpawnFn, type StatFn } from "./open.ts"

export type ApprovalOutcome = "approved" | "approved-as-stated" | "rolled-back"

export interface GateResult {
	readonly outcome: ApprovalOutcome
	readonly before: string
	readonly after: string
	readonly saved: boolean
	readonly exitCode: number | null
	readonly durationMs: number
}

/**
 * Pure decision function. Given the editor's EditorResult and the
 * before/after file contents, decide the approval outcome.
 *
 * Extracted for testability — tests don't need a real subprocess.
 */
export interface EditorGateStatus {
	readonly saved: boolean
}
export function decideOutcome(
	before: string,
	editor: EditorGateStatus | EditorResult,
	after: string,
): ApprovalOutcome {
	if (!editor.saved) return "rolled-back"
	return after === before ? "approved-as-stated" : "approved"
}

export interface GateOptions {
	readonly filePath: string
	readonly injection?: { readonly spawn: SpawnFn; readonly stat: StatFn }
}

export interface GateFsAdapter {
	readFileSync: (path: string, encoding: "utf8") => string
}

const defaultFs: GateFsAdapter = { readFileSync }

export async function openApprovalGate(options: GateOptions): Promise<GateResult> {
	const fs: GateFsAdapter = options.injection ? defaultFs : defaultFs
	void fs
	const before = readFileSync(options.filePath, "utf8")
	const editorResult = await openInEditor(options.filePath, options.injection)
	const after = editorResult.saved ? readFileSync(options.filePath, "utf8") : before
	const outcome = decideOutcome(before, editorResult, after)
	return {
		outcome,
		before,
		after,
		saved: editorResult.saved,
		exitCode: editorResult.exitCode,
		durationMs: editorResult.durationMs,
	}
}
