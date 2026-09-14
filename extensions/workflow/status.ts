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
	return {
		frontmatter: parseSimpleYaml(match[1]),
		body: match[2],
	}
}

export function serializeFrontmatter(frontmatter: ChapterFrontmatter): string {
	const lines = ["---"]
	for (const [key, value] of Object.entries(frontmatter)) {
		if (value === undefined) continue
		lines.push(`${key}: ${JSON.stringify(value)}`)
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

/**
 * Minimal YAML subset sufficient for chapter frontmatter: `key: value`
 * lines with numbers / booleans / null / strings. Nested structures
 * and lists are out of scope for Phase 0.5.
 */
function parseSimpleYaml(yaml: string): ChapterFrontmatter {
	const result: Record<string, unknown> = {}
	for (const rawLine of yaml.split("\n")) {
		const line = rawLine.replace(/\s+$/, "")
		if (shouldSkipLine(line)) continue
		const parsed = parseLine(line)
		if (parsed === null) continue
		result[parsed.key] = coerceValue(parsed.value)
	}
	return result as ChapterFrontmatter
}

function shouldSkipLine(line: string): boolean {
	return line.length === 0 || line.startsWith("#")
}

function parseLine(line: string): { key: string; value: string } | null {
	const colon = line.indexOf(":")
	if (colon === -1) return null
	const key = line.slice(0, colon).trim()
	if (key.length === 0) return null
	return { key, value: line.slice(colon + 1).trim() }
}

function coerceValue(raw: string): unknown {
	const stripped = stripWrappingQuotes(raw)
	if (/^-?\d+$/.test(stripped)) return Number(stripped)
	if (stripped === "true") return true
	if (stripped === "false") return false
	if (stripped === "null") return null
	return stripped
}

function stripWrappingQuotes(s: string): string {
	return s.replace(/^["'](.*)["']$/, "$1")
}
