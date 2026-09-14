/**
 * LLM Wiki — LLM rerank. Per ADR-0006 §4 step 2.
 *
 * Takes FTS5 candidates and asks the LLM to pick the best `topN` for
 * the query. The LLM is doing **content judgment** (which template
 * thematically matches the query), which is approved under global rule
 * 5 (LLM is for language reasoning, not control flow).
 */

import type { Model } from "@earendil-works/pi-ai"
import type { ModelRegistry } from "@earendil-works/pi-coding-agent"
import type { RerankLLMResponse, WikiCandidate, WikiPick } from "./schema.ts"

const SYSTEM_PROMPT = `You are a curator selecting reference templates for a long-form novel writing assistant.

Given a query (a chapter plan, character concept, or scene intent) and a list of FTS5 candidates from a template library, pick the top N templates most thematically aligned with the query.

Output JSON only, with this exact shape:
{
  "picks": [
    { "table": "<story_lines|character_templates|scene_templates|writing_patterns|prompts>", "id": "<exact candidate id>", "rationale": "<one sentence>" }
  ]
}

Rules:
- Pick exactly the requested number of items (or fewer if there are not enough good candidates).
- Use only candidate ids from the input.
- Do not invent ids.
- Rationale must be one sentence in English; mention what makes the template a strong match.
- Output JSON only, no prose, no markdown fences.`

export interface RerankOptions {
	readonly topN: number
	readonly query: string
}

/**
 * Build the user-prompt payload. Pure; used by tests for snapshot
 * assertions.
 */
export function buildRerankPrompt(
	query: string,
	candidates: readonly WikiCandidate[],
	topN: number,
): string {
	const lines: string[] = []
	lines.push(`Query: ${query}`)
	lines.push(`Pick the top ${topN} most thematically aligned templates from these candidates:`)
	lines.push("")
	for (const c of candidates) {
		lines.push(
			`- [${c.table}] id=${c.id} title=${JSON.stringify(c.title)} language=${c.language || "?"}`,
		)
		lines.push(`    summary: ${c.summary.slice(0, 200)}`)
		lines.push(`    snippet: ${c.snippet.slice(0, 200)}`)
		lines.push(`    bm25: ${c.bm25.toFixed(3)}`)
	}
	return lines.join("\n")
}

/** Strip an optional ```json ... ``` fence around the LLM output. */
function stripFence(raw: string): string {
	const trimmed = raw.trim()
	const fenceMatch = /^```(?:json)?\s*([\s\S]*?)```\s*$/i.exec(trimmed)
	return fenceMatch?.[1]?.trim() ?? trimmed
}

/** Validate one parsed pick object; returns null if malformed. */
function coercePick(entry: unknown, candidateIds: ReadonlySet<string>): WikiPick | null {
	if (typeof entry !== "object" || entry === null) return null
	const e = entry as { table?: unknown; id?: unknown; rationale?: unknown }
	if (typeof e.table !== "string" || typeof e.id !== "string" || typeof e.rationale !== "string") {
		return null
	}
	if (!candidateIds.has(e.id)) return null
	return { table: e.table as WikiPick["table"], id: e.id, rationale: e.rationale }
}

/**
 * Parse the LLM's JSON response into `WikiPick[]`. Tolerant of the
 * LLM wrapping output in markdown fences; strict on the inner shape.
 */
export function parseRerankResponse(
	raw: string,
	candidateIds: ReadonlySet<string>,
	topN: number,
): readonly WikiPick[] {
	let parsed: unknown
	try {
		parsed = JSON.parse(stripFence(raw))
	} catch {
		return []
	}
	if (typeof parsed !== "object" || parsed === null) return []
	const obj = parsed as { picks?: unknown }
	if (!Array.isArray(obj.picks)) return []

	const out: WikiPick[] = []
	for (const entry of obj.picks) {
		const pick = coercePick(entry, candidateIds)
		if (!pick) continue
		out.push(pick)
		if (out.length >= topN) break
	}
	return out
}

/**
 * Call `ctx.model.complete()` and rerank candidates. Throws on
 * provider errors; returns `{ picks: [] }` if the LLM output is
 * unparseable.
 */
export async function rerankWithLLM(
	registry: ModelRegistry,
	model: Model<never>,
	query: string,
	candidates: readonly WikiCandidate[],
	topN: number,
): Promise<readonly WikiPick[]> {
	if (candidates.length === 0 || topN <= 0) return []
	if (topN > candidates.length) {
		// Not enough candidates; return them all without burning an LLM call.
		return candidates.slice(0, topN).map((c) => ({
			table: c.table,
			id: c.id,
			rationale: `bm25=${c.bm25.toFixed(3)} (only candidate available)`,
		}))
	}

	const userPrompt = buildRerankPrompt(query, candidates, topN)
	const response = await registry.complete(model, {
		systemPrompt: SYSTEM_PROMPT,
		messages: [{ role: "user", content: userPrompt, timestamp: Date.now() }],
	})

	const candidateIds = new Set(candidates.map((c) => c.id))
	const text = response.content
		.filter((block: { type: string }) => block.type === "text")
		.map((block: { type: string; text?: string }) => block.text ?? "")
		.join("")
	return parseRerankResponse(text, candidateIds, topN)
}

/** Re-export for tests. */
export type { RerankLLMResponse }
