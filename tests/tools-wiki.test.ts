/**
 * Tests for the `wiki_search` pi-tool wrapper (extensions/tools/wiki-search.ts).
 * No SQLite — we mock `searchWiki` to assert the tool body formats picks
 * + candidates correctly.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { registerWikiSearchTool } from "../extensions/tools/wiki-search.ts"
import { _resetWikiDbCache } from "../extensions/wiki/db.ts"
import * as wikiIndex from "../extensions/wiki/index.ts"
import { makeFakeCtx, makeFakePi } from "./_helpers/fakePi.ts"

beforeEach(() => {
	_resetWikiDbCache()
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe("wiki_search tool wrapper", () => {
	it("registers under name `wiki_search` with TypeBox params", () => {
		const pi = makeFakePi()
		registerWikiSearchTool(pi)
		expect(pi.has("wiki_search")).toBe(true)
		const spec = pi.get("wiki_search").spec as Record<string, unknown>
		expect(spec.label).toBe("Wiki Search")
		expect(Array.isArray(spec.promptGuidelines)).toBe(true)
		expect(spec.promptSnippet).toContain("reference templates")
	})

	it("returns formatted text + structured details for a hit", async () => {
		const pi = makeFakePi()
		registerWikiSearchTool(pi)

		vi.spyOn(wikiIndex, "searchWiki").mockResolvedValue({
			query: "crisis narrative",
			reranked: true,
			picks: [
				{ table: "story_lines", id: "sl-001", rationale: "Crisis arc fits" },
				{ table: "character_templates", id: "ct-002", rationale: "Revenger fits" },
			],
			candidates: [
				{
					table: "story_lines",
					id: "sl-001",
					title: "Fichtean",
					summary: "s",
					snippet: "n",
					language: "en",
					bm25: 1.5,
				},
				{
					table: "character_templates",
					id: "ct-002",
					title: "Monte Cristo",
					summary: "s",
					snippet: "n",
					language: "zh",
					bm25: 2.0,
				},
			],
		})

		const tool = pi.get("wiki_search")
		const result = (await tool.execute(
			"call-1",
			{ query: "crisis narrative" },
			undefined,
			undefined,
			makeFakeCtx(),
		)) as {
			content: Array<{ type: string; text: string }>
			details: { picks: readonly unknown[]; candidates: readonly unknown[]; reranked: boolean }
		}

		expect(result.content[0]?.text).toContain('wiki_search: 2 pick(s) for "crisis narrative"')
		expect(result.content[0]?.text).toContain("[story_lines] id=sl-001 — Crisis arc fits")
		expect(result.content[0]?.text).toContain("Top candidates:")
		expect(result.details.picks).toHaveLength(2)
		expect(result.details.reranked).toBe(true)
	})

	it("forwards tables + topN options to searchWiki", async () => {
		const pi = makeFakePi()
		registerWikiSearchTool(pi)
		const spy = vi.spyOn(wikiIndex, "searchWiki").mockResolvedValue({
			query: "x",
			reranked: true,
			picks: [],
			candidates: [],
		})

		const tool = pi.get("wiki_search")
		await tool.execute(
			"call-1",
			{ query: "x", tables: ["character_templates"], topN: 10, rerank: false },
			undefined,
			undefined,
			makeFakeCtx(),
		)

		expect(spy).toHaveBeenCalledWith(expect.anything(), "x", {
			tables: ["character_templates"],
			topN: 10,
			rerank: false,
		})
	})

	it("falls back to all 5 tables when none supplied", async () => {
		const pi = makeFakePi()
		registerWikiSearchTool(pi)
		const spy = vi.spyOn(wikiIndex, "searchWiki").mockResolvedValue({
			query: "x",
			reranked: false,
			picks: [],
			candidates: [],
		})

		const tool = pi.get("wiki_search")
		await tool.execute("call-1", { query: "x" }, undefined, undefined, makeFakeCtx())

		const call = spy.mock.calls[0]
		expect(call?.[2]).toEqual({ tables: wikiIndex.DEFAULT_TABLES, topN: 5, rerank: true })
	})

	it("renders (none) when there are no picks OR candidates", async () => {
		const pi = makeFakePi()
		registerWikiSearchTool(pi)
		vi.spyOn(wikiIndex, "searchWiki").mockResolvedValue({
			query: "absent",
			reranked: true,
			picks: [],
			candidates: [],
		})

		const tool = pi.get("wiki_search")
		const result = (await tool.execute(
			"call-1",
			{ query: "absent" },
			undefined,
			undefined,
			makeFakeCtx(),
		)) as { content: Array<{ text: string }> }

		expect(result.content[0]?.text).toContain("0 pick(s)")
		expect(result.content[0]?.text).toContain("Picks:\n(none)")
		expect(result.content[0]?.text).toContain("Top candidates:\n(none)")
	})
})
