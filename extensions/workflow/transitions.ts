/**
 * Workflow state machine. Per §18 + Q9, the chapter's `status` frontmatter
 * field walks a fixed graph with one optional loop:
 *
 *   planned
 *     → writing → drafted → human_editing → edited
 *     → continuity_check → reviewing → revision_required
 *                                       ↘ (back to writing via revise)
 *     → approved → canonized
 *
 *   Once `canonized`, the chapter is append-only (Q2).
 *
 * This module is pure (no I/O). Callers (Writer / Continuity / Runner)
 * persist transitions via `applyStatus()` from status.ts.
 */

import { WORKFLOW_STATUSES, type WorkflowStatus } from "./status.ts"

export interface TransitionRule {
	readonly from: WorkflowStatus
	readonly to: WorkflowStatus
	readonly rationale: string
}

/**
 * The directed graph. Listed explicitly so the rationale is auditable
 * and additions / loops are obvious.
 */
export const TRANSITIONS: readonly TransitionRule[] = [
	{ from: "planned", to: "writing", rationale: "Writer starts drafting." },
	{ from: "writing", to: "drafted", rationale: "Writer produces a draft." },
	{ from: "drafted", to: "human_editing", rationale: "Editor opens for author review." },
	{ from: "human_editing", to: "edited", rationale: "Author closes editor with edits." },
	{
		from: "human_editing",
		to: "drafted",
		rationale: "Author quit-no-save; treat as draft (no edits applied).",
	},
	{ from: "edited", to: "continuity_check", rationale: "Continuity validation begins." },
	{
		from: "continuity_check",
		to: "drafted",
		rationale: "Continuity surfaced issues; return to Writer.",
	},
	{
		from: "continuity_check",
		to: "reviewing",
		rationale: "Continuity passed; Critic takes over.",
	},
	{ from: "reviewing", to: "revision_required", rationale: "Critic found high-severity issues." },
	{
		from: "reviewing",
		to: "edited",
		rationale: "Critic approved with no high-severity blockers.",
	},
	{
		from: "revision_required",
		to: "writing",
		rationale: "Revise loop — Writer takes another pass.",
	},
	{ from: "edited", to: "approved", rationale: "Author approves (terminal before canonization)." },
	{ from: "approved", to: "canonized", rationale: "Canon committed. Append-only from here." },
]

export interface TransitionCheck {
	readonly ok: boolean
	readonly reason: string
}

/** Can this transition happen? Returns ok=true if it's in the graph. */
export function canTransition(from: WorkflowStatus, to: WorkflowStatus): TransitionCheck {
	if (from === "canonized") {
		return { ok: false, reason: "canonized is terminal (append-only per Q2)" }
	}
	const rule = TRANSITIONS.find((r) => r.from === from && r.to === to)
	if (!rule) {
		return { ok: false, reason: `no edge ${from} → ${to}` }
	}
	return { ok: true, reason: rule.rationale }
}

export interface NextStatusesOptions {
	readonly includeTerminal?: boolean
}

export function nextStatusesFrom(
	from: WorkflowStatus,
	options: NextStatusesOptions = {},
): WorkflowStatus[] {
	const includeTerminal = options.includeTerminal ?? false
	const set = new Set<WorkflowStatus>()
	for (const r of TRANSITIONS) {
		if (r.from !== from) continue
		if (!includeTerminal && isTerminal(r.to)) continue
		set.add(r.to)
	}
	return [...set]
}

export function isTerminal(status: WorkflowStatus): boolean {
	return status === "approved" || status === "canonized"
}

/**
 * Small helper used by workflows (revise loop) — find a status path from
 * `from` to `to` if one exists in the graph (BFS).
 *
 * Length is bounded by the §18 enum size (≤10), so a naive BFS is fine.
 */
export function findPath(from: WorkflowStatus, to: WorkflowStatus): WorkflowStatus[] | null {
	if (from === to) return [from]
	const queue: Array<{ node: WorkflowStatus; path: WorkflowStatus[] }> = [
		{ node: from, path: [from] },
	]
	const seen = new Set<WorkflowStatus>([from])
	while (queue.length > 0) {
		const current = queue.shift()
		if (!current) continue
		for (const r of TRANSITIONS) {
			if (r.from !== current.node) continue
			if (seen.has(r.to)) continue
			const nextPath = [...current.path, r.to]
			if (r.to === to) return nextPath
			seen.add(r.to)
			queue.push({ node: r.to, path: nextPath })
		}
	}
	return null
}

export { WORKFLOW_STATUSES }
