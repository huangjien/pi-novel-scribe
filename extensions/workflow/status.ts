/**
 * Chapter-frontmatter status machine. Per ADR-0002 / Q9, canonical
 * workflow `status` lives in the chapter's frontmatter, not in
 * session.jsonl.
 *
 * Status enum mirrors review §18:
 *   planned → writing → drafted → human_editing → edited →
 *   continuity_check → reviewing → revision_required → approved → canonized
 *
 * Phase 0.5 only writes `drafted`. Other transitions land in Phase 2/6.
 */

import { readFileSync, writeFileSync } from "node:fs"
import * as yaml from "js-yaml"

export const WORKFLOW_STATUSES = [
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
] as const

export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number]

export interface ChapterFrontmatter {
	readonly chapter?: number
	readonly status?: WorkflowStatus
	readonly title?: string
	readonly plan?: string
	/** Per-chapter language override (ADR-0007). */
	readonly language?: string
	readonly [key: string]: unknown
}

/** Matches `---<newline><yaml><newline>---<newline><body>`. */
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

export function parseFrontmatter(content: string): {
	frontmatter: ChapterFrontmatter
	body: string
} {
	const match = FRONTMATTER_RE.exec(content)
	if (!match || match[1] === undefined || match[2] === undefined) {
		return { frontmatter: {}, body: content }
	}
	let parsed: unknown
	try {
		parsed = yaml.load(match[1])
	} catch {
		return { frontmatter: {}, body: match[2] ?? "" }
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return { frontmatter: {}, body: match[2] ?? "" }
	}
	return { frontmatter: parsed as ChapterFrontmatter, body: match[2] ?? "" }
}

export function serializeFrontmatter(frontmatter: ChapterFrontmatter): string {
	const lines = ["---"]
	for (const [key, value] of Object.entries(frontmatter)) {
		if (value === undefined) continue
		const rendered =
			value === null
				? "null"
				: typeof value === "object"
					? yaml.dump(value, { lineWidth: -1, flowLevel: 0 }).trimEnd()
					: typeof value === "string"
						? JSON.stringify(value)
						: String(value)
		lines.push(`${key}: ${rendered}`)
	}
	lines.push("---")
	return lines.join("\n")
}

export function getStatus(frontmatter: ChapterFrontmatter): WorkflowStatus | undefined {
	const status = frontmatter.status
	if (typeof status === "string" && isWorkflowStatus(status)) {
		return status
	}
	return undefined
}

export function setStatus(
	frontmatter: ChapterFrontmatter,
	status: WorkflowStatus,
): ChapterFrontmatter {
	return { ...frontmatter, status }
}

export function applyStatus(
	filePath: string,
	newStatus: WorkflowStatus,
	fsAdapter: FsAdapter = defaultFsAdapter,
): void {
	const content = fsAdapter.readFileSync(filePath, "utf8")
	const { frontmatter, body } = parseFrontmatter(content)
	const updated = setStatus(frontmatter, newStatus)
	const rebuilt = `${serializeFrontmatter(updated)}\n\n${body}`
	fsAdapter.writeFileSync(filePath, rebuilt, "utf8")
}

// --- Internal helpers (out-of-line for complexity budget) ---

interface FsAdapter {
	readFileSync: (path: string, encoding: "utf8") => string
	writeFileSync: (path: string, data: string, encoding: "utf8") => void
}

const defaultFsAdapter: FsAdapter = { readFileSync, writeFileSync }

function isWorkflowStatus(value: string): value is WorkflowStatus {
	return (WORKFLOW_STATUSES as readonly string[]).includes(value)
}
