/**
 * P0 schemas for pi-novel-scribe. Per review §25 Finding A and the
 * §29 priority list. All schemas are TypeScript interfaces + a
 * lightweight `validate()` runtime check. We deliberately avoid zod /
 * typebox / js-yaml-validation libraries here — these schemas are
 * narrow, hand-written, and need to round-trip through YAML, so a
 * small bespoke validator beats a heavyweight schema library.
 *
 * Authored vs derived split (Q12): the runtime data files
 * (`state/*.yaml`) are the canonical source. Schemas here describe
 * those files; canonical canon facts flow through `canon.ts` (not
 * arbitrary LLM output).
 */

import type { WikiTable } from "../wiki/schema.ts"

// ============================================================================
// TEMPLATE REF (Q22 / ADR-0008 — plans must cite corpus templates)
// ============================================================================

export interface TemplateRef {
	readonly table: WikiTable
	readonly id: string
	readonly how_used: string
}

// ============================================================================
// CHARACTER
// ============================================================================

export interface Character {
	readonly id: string
	readonly name: string
	readonly aliases: readonly string[]
	readonly pronouns: string | null
	readonly role: "protagonist" | "antagonist" | "supporting" | "narrator" | "other"
}

// ============================================================================
// CHARACTER KNOWLEDGE (Q3 worldview)
// ============================================================================

export interface CharacterKnowledge {
	readonly character_id: string
	readonly believes: readonly string[]
	readonly authored_overrides: readonly string[]
	readonly derived_at_chapter: number | null
}

// ============================================================================
// SCENE (Q5 + Q12 — extends the @scene marker)
// ============================================================================

export type SceneKind = "plan" | "drafted" | "approved" | "canonized"

export interface Scene {
	readonly id: string
	readonly kind: SceneKind
	readonly chapter: number
	readonly pov: string
	readonly location: string | null
	readonly time: string | null
	readonly participants: readonly string[]
	readonly purpose: string | null
	readonly conflict: string | null
	readonly turn: string | null
	readonly advances_lines: readonly string[]
	readonly template_refs?: readonly TemplateRef[]
	readonly template_refs_exempt?: boolean
}

// ============================================================================
// STORY LINE (Q4)
// ============================================================================

export type StoryLineKind = "bright" | "dark" | "subplot" | "red-herring"

export interface StoryLine {
	readonly id: string
	readonly kind: StoryLineKind
	readonly objective: string
	readonly current_state: string
	readonly next_milestone: string | null
	readonly hidden_information: string | null
	readonly planned_reveal: number | null
	readonly active: boolean
}

// ============================================================================
// FORESHADOWING (review §C)
// ============================================================================

export type ForeshadowState = "planted" | "partial" | "revealed" | "subverted"

export interface Foreshadowing {
	readonly id: string
	readonly summary: string
	readonly planted_in_chapter: number
	readonly state: ForeshadowState
	readonly revealed_in_chapter: number | null
	readonly owner_line: string | null
}

// ============================================================================
// UNRESOLVED THREAD
// ============================================================================

export type ThreadState = "open" | "in_progress" | "resolved" | "abandoned"

export interface UnresolvedThread {
	readonly id: string
	readonly summary: string
	readonly state: ThreadState
	readonly opened_in_chapter: number
	readonly resolved_in_chapter: number | null
	readonly owner_line: string | null
}

// ============================================================================
// TIMELINE EVENT
// ============================================================================

export interface TimelineEvent {
	readonly id: string
	readonly at_chapter: number
	readonly t_offset: string | null
	readonly summary: string
	readonly characters: readonly string[]
	readonly line: string | null
}

// ============================================================================
// CANON CHANGE (Q8 / ADR-0002)
// ============================================================================

export type CanonChangeStatus = "draft" | "validated" | "approved" | "deprecated" | "contradicted"

export type CanonChangeKind =
	| "character_belief_added"
	| "character_belief_revised"
	| "world_fact_added"
	| "foreshadowing_planted"
	| "foreshadowing_revealed"
	| "thread_opened"
	| "thread_resolved"
	| "timeline_event"

export interface CanonChange {
	readonly id: string
	readonly kind: CanonChangeKind
	readonly status: CanonChangeStatus
	readonly proposed_in_chapter: number
	readonly approved_in_chapter: number | null
	readonly proposed_by: "writer" | "author"
	readonly target: string
	readonly payload: Record<string, unknown>
	readonly rationale: string
	readonly provenance: {
		readonly proposal_file: string
		readonly chapter_file: string
	}
}

// ============================================================================
// GENERIC VALIDATION
// ============================================================================

export class SchemaValidationError extends Error {
	constructor(
		message: string,
		readonly path: string,
	) {
		super(`${path}: ${message}`)
	}
}

export function validateNonEmpty(value: unknown, path: string): string {
	if (typeof value !== "string") {
		throw new SchemaValidationError("expected string", path)
	}
	if (value.length === 0) {
		throw new SchemaValidationError("must not be empty", path)
	}
	return value
}

export function validateEnum<T extends string>(
	value: unknown,
	allowed: readonly T[],
	path: string,
): T {
	if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
		throw new SchemaValidationError(`must be one of ${allowed.join(", ")}`, path)
	}
	return value as T
}

export function validateStringArray(value: unknown, path: string): readonly string[] {
	if (!Array.isArray(value) || !value.every((x) => typeof x === "string")) {
		throw new SchemaValidationError("expected string[]", path)
	}
	return value as string[]
}

export function validateRecord(value: unknown, path: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new SchemaValidationError("expected object", path)
	}
	return value as Record<string, unknown>
}
