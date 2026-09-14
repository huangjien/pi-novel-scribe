/**
 * Canon Change lifecycle. Per Q8 + ADR-0002:
 *
 *   Writer
 *     → proposed Canon Change (kind, target, payload, rationale)
 *     → Continuity validation
 *     → Author approval (editor-as-gate; save=approve, no-diff=approve-as-stated)
 *     → Applied to canonical state files
 *
 *   stale → superseded when a newer change overrides it
 *
 * Files:
 *   state/canon-changes/<id>.yaml          — durable, applied
 *   state/canon-changes/<id>.yaml.draft   — pending proposal / pre-validation
 */

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs"
import { join } from "node:path"
import * as yaml from "js-yaml"
import {
	type CanonChange,
	type CanonChangeKind,
	SchemaValidationError,
	validateEnum,
	validateNonEmpty,
	validateRecord,
} from "./schemas.ts"

export interface ProposeCanonChangeInput {
	readonly id: string
	readonly kind: CanonChangeKind
	readonly target: string
	readonly payload: Record<string, unknown>
	readonly rationale: string
	readonly proposed_in_chapter: number
	readonly chapter_file: string
	readonly proposed_by?: "writer" | "author"
}

export interface ApplyCanonChangeResult {
	readonly change: CanonChange
	readonly applied_path: string
}

const CHANGE_DIR = "state/canon-changes"

export function proposeCanonChange(novelRepo: string, input: ProposeCanonChangeInput): string {
	validateNonEmpty(input.id, "id")
	validateEnum(input.kind, PROPOSED_KINDS, "kind")
	validateNonEmpty(input.target, "target")
	validateNonEmpty(input.rationale, "rationale")
	validateRecord(input.payload, "payload")

	const draft: CanonChange = {
		id: input.id,
		kind: input.kind,
		status: "draft",
		proposed_in_chapter: input.proposed_in_chapter,
		approved_in_chapter: null,
		proposed_by: input.proposed_by ?? "writer",
		target: input.target,
		payload: input.payload,
		rationale: input.rationale,
		provenance: {
			proposal_file: `${input.id}.yaml.draft`,
			chapter_file: input.chapter_file,
		},
	}
	const dir = join(novelRepo, CHANGE_DIR)
	mkdirSync(dir, { recursive: true })
	const draftPath = join(dir, `${input.id}.yaml.draft`)
	writeFileSync(draftPath, serialize(draft), "utf8")
	return draftPath
}

export function listDraftCanonChanges(novelRepo: string): CanonChange[] {
	const dir = join(novelRepo, CHANGE_DIR)
	if (!existsSync(dir)) return []
	const out: CanonChange[] = []
	for (const name of readdirSync(dir)) {
		if (!name.endsWith(".draft")) continue
		const raw = readFileSync(join(dir, name), "utf8")
		const parsed = yaml.load(raw)
		if (isCanonChangeShape(parsed)) out.push(parsed)
	}
	return out
}

export function applyCanonChange(
	novelRepo: string,
	changeId: string,
	approved_in_chapter: number,
): ApplyCanonChangeResult {
	const dir = join(novelRepo, CHANGE_DIR)
	const draftPath = join(dir, `${changeId}.yaml.draft`)
	if (!existsSync(draftPath)) {
		throw new Error(`No draft proposal for ${changeId}`)
	}
	const raw = readFileSync(draftPath, "utf8")
	const parsed = yaml.load(raw)
	if (!isCanonChangeShape(parsed)) {
		throw new SchemaValidationError(
			"draft is malformed",
			`state/canon-changes/${changeId}.yaml.draft`,
		)
	}
	if (parsed.status !== "validated" && parsed.status !== "draft") {
		throw new Error(`Canon change ${changeId} cannot move from ${parsed.status} to approved`)
	}
	const approved: CanonChange = {
		...parsed,
		status: "approved",
		approved_in_chapter,
	}
	const finalPath = join(dir, `${changeId}.yaml`)
	writeFileSync(finalPath, serialize(approved), "utf8")
	const finalDraftPath = join(dir, `${changeId}.yaml.draft`)
	// Drop the .draft suffix once approved — durable state is the .yaml file.
	if (existsSync(finalDraftPath)) {
		// Atomic on POSIX; on Windows we'd need fs.rmSync.
		renameSync(finalDraftPath, join(dir, `${changeId}.yaml.applied.bak`))
	}
	return { change: approved, applied_path: finalPath }
}

export function deprecateCanonChange(novelRepo: string, changeId: string, reason: string): void {
	const dir = join(novelRepo, CHANGE_DIR)
	const path = join(dir, `${changeId}.yaml`)
	if (!existsSync(path)) return
	const raw = readFileSync(path, "utf8")
	const parsed = yaml.load(raw)
	if (!isCanonChangeShape(parsed)) return
	const updated: CanonChange = { ...parsed, status: "deprecated" }
	const enriched = { ...updated, _deprecation_reason: reason }
	writeFileSync(path, serialize(enriched as unknown as CanonChange), "utf8")
}

// --- Internal helpers ---

const PROPOSED_KINDS = [
	"character_belief_added",
	"character_belief_revised",
	"world_fact_added",
	"foreshadowing_planted",
	"foreshadowing_revealed",
	"thread_opened",
	"thread_resolved",
	"timeline_event",
] as const

type CanonChangeWithDeprecation = CanonChange & { _deprecation_reason?: string }

function serialize(change: CanonChange | CanonChangeWithDeprecation): string {
	return yaml.dump(change, { lineWidth: 100, noRefs: true })
}

function isCanonChangeShape(value: unknown): value is CanonChange {
	if (typeof value !== "object" || value === null) return false
	const v = value as Record<string, unknown>
	return (
		typeof v.id === "string" &&
		typeof v.kind === "string" &&
		typeof v.status === "string" &&
		typeof v.target === "string" &&
		typeof v.proposed_in_chapter === "number"
	)
}
