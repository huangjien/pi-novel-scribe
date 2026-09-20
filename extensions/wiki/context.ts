/**
 * Wiki-first context injection. Per ADR-0008 (Q21, Q22, Q23).
 *
 * Three pure query-derivation functions (one per packet type), a pure
 * Q22 validator for `template_refs`, and one async injector that wraps
 * `searchWiki` with the session cache + rerank budget. The injector
 * NEVER throws: wiki failure degrades to `wikiReferences: null` plus a
 * localized warning so writing is never blocked (ADR-0008 §1).
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent"
import type { Language } from "../i18n/index.ts"
import { errorMessage } from "../i18n/index.ts"
import type { TemplateRef } from "../novel/schemas.ts"
import {
	createRerankBudget,
	dbMtimeMs,
	getCachedWikiResult,
	setCachedWikiResult,
	wikiCacheKey,
} from "./cache.ts"
import { resolveWikiDbPath } from "./db.ts"
import { searchWiki } from "./index.ts"
import { WIKI_TABLES, type WikiResult, type WikiTable } from "./schema.ts"

const WRITER_TABLES: readonly WikiTable[] = ["scene_templates", "character_templates"]
const PLANNER_TABLES: readonly WikiTable[] = ["scene_templates", "story_lines"]
const CRITIC_TABLES: readonly WikiTable[] = ["writing_patterns", "scene_templates"]

const MAX_QUERY_LENGTH = 300

function squash(parts: readonly unknown[]): string {
	const joined = parts
		.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
		.map((p) => p.trim())
		.join(" ")
		.replace(/\s+/g, " ")
		.trim()
	return joined.slice(0, MAX_QUERY_LENGTH)
}

/** Writer packet query: scene plan intent + POV. Pure (ADR-0008 §1). */
export function writerWikiQuery(input: {
	readonly plan: Record<string, unknown>
	readonly pov: string | null
}): string {
	return squash([
		input.plan.objective,
		input.plan.conflict,
		input.plan.emotional_turn,
		input.pov ? `POV ${input.pov}` : "",
	])
}

/** Planner packet query: active story lines + character roster + existing objective. Pure. */
export function plannerWikiQuery(input: {
	readonly activeStoryLines: readonly string[]
	readonly characterProfiles: Readonly<Record<string, string>>
	readonly existingPlan: Record<string, unknown> | null
}): string {
	const characters = Object.keys(input.characterProfiles).slice(0, 6).join(", ")
	return squash([
		input.existingPlan?.objective,
		input.activeStoryLines.join(", "),
		characters ? `characters: ${characters}` : "",
	])
}

/** Critic packet query: the plan's template citations + intent. Pure. */
export function criticWikiQuery(input: {
	readonly plan: Record<string, unknown> | null
	readonly pov: string | null
}): string {
	const refs = extractTemplateRefs(input.plan ?? {})
	const refText = refs.map((r) => `${r.table} ${r.id} ${r.how_used}`).join("; ")
	return squash([
		refText,
		input.plan?.objective,
		input.plan?.conflict,
		input.pov ? `POV ${input.pov}` : "",
	])
}

function isWikiTable(value: unknown): value is WikiTable {
	return typeof value === "string" && (WIKI_TABLES as readonly string[]).includes(value)
}

function coerceTemplateRef(raw: unknown): TemplateRef | null {
	if (typeof raw !== "object" || raw === null) return null
	const r = raw as { table?: unknown; id?: unknown; how_used?: unknown }
	if (!isWikiTable(r.table)) return null
	if (typeof r.id !== "string" || r.id.trim().length === 0) return null
	if (typeof r.how_used !== "string" || r.how_used.trim().length === 0) return null
	return { table: r.table, id: r.id, how_used: r.how_used }
}

/** Collect valid template refs from plan-level `template_refs` and each scene's. Pure. */
export function extractTemplateRefs(plan: Record<string, unknown>): readonly TemplateRef[] {
	const sources = collectRefSources(plan)
	const out: TemplateRef[] = []
	for (const source of sources) {
		for (const ref of Array.isArray(source) ? source : []) {
			const coerced = coerceTemplateRef(ref)
			if (coerced) out.push(coerced)
		}
	}
	return out
}

function collectRefSources(plan: Record<string, unknown>): readonly unknown[] {
	const sources: unknown[] = []
	if (Array.isArray(plan.template_refs)) sources.push(plan.template_refs)
	const scenes = Array.isArray(plan.scenes) ? plan.scenes : []
	for (const scene of scenes) {
		if (typeof scene === "object" && scene !== null) {
			sources.push((scene as Record<string, unknown>).template_refs)
		}
	}
	return sources
}

export interface TemplateRefCheck {
	readonly valid: boolean
	readonly reason: string
}

/**
 * Q22 gate: a plan cites at least one corpus template, or carries an
 * explicit exemption with a rationale. Silence is invalid.
 */
export function validateTemplateRefs(plan: Record<string, unknown>): TemplateRefCheck {
	if (plan.template_refs_exempt === true) {
		const rationale = plan.template_refs_exempt_rationale
		if (typeof rationale === "string" && rationale.trim().length > 0) {
			return { valid: true, reason: "template_refs exempt with rationale" }
		}
		return {
			valid: false,
			reason: "template_refs_exempt is true but template_refs_exempt_rationale is missing or empty",
		}
	}
	const refs = extractTemplateRefs(plan)
	if (refs.length > 0) {
		return { valid: true, reason: `${refs.length} template ref(s) cited` }
	}
	return {
		valid: false,
		reason:
			"no template_refs cited and no template_refs_exempt: true — cite corpus templates or exempt explicitly (Q22 / ADR-0008)",
	}
}

export interface WikiInjection {
	readonly wikiReferences: WikiResult | null
	readonly wikiWarning: string | null
}

export interface InjectWikiOptions {
	readonly tables?: readonly WikiTable[]
	readonly topN?: number
	readonly language?: Language
}

/**
 * Compose wiki references for a context packet (Q21). Deterministic
 * callers pass the derived query; this function resolves the DB, checks
 * the session cache, spends one rerank-budget ticket, and degrades to
 * `null + warning` on any failure. Never throws.
 */
export async function injectWikiReferences(
	ctx: ExtensionContext,
	query: string,
	options: InjectWikiOptions = {},
): Promise<WikiInjection> {
	const lang = options.language ?? "en"
	const trimmed = query.trim()
	if (trimmed.length === 0) {
		return { wikiReferences: null, wikiWarning: null }
	}
	const tables = options.tables ?? WRITER_TABLES
	const topN = options.topN ?? 5

	try {
		const dbPath = resolveWikiDbPath(ctx.cwd)
		const mtime = dbMtimeMs(dbPath)
		if (mtime === null) {
			return {
				wikiReferences: null,
				wikiWarning: errorMessage(lang, "wiki_packet_degraded", `wiki DB not found: ${dbPath}`),
			}
		}

		const key = wikiCacheKey(trimmed, tables, topN, dbPath)
		const cached = getCachedWikiResult(key, mtime)
		if (cached) {
			return { wikiReferences: cached, wikiWarning: null }
		}

		const budget = createRerankBudget()
		const rerank = budget.tryConsume()
		let warning: string | null = null
		if (!rerank) {
			warning = errorMessage(lang, "wiki_rerank_budget")
		}

		const result = await searchWiki(ctx, trimmed, { tables, topN, rerank })
		setCachedWikiResult(key, mtime, result)
		return { wikiReferences: result, wikiWarning: warning }
	} catch (err) {
		return {
			wikiReferences: null,
			wikiWarning: errorMessage(lang, "wiki_packet_degraded", (err as Error).message),
		}
	}
}

export { CRITIC_TABLES, PLANNER_TABLES, WRITER_TABLES }
