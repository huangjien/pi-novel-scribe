/**
 * Tests for the `run_director` pi-tool wrapper.
 * The Director reads config/route.yaml at registration time, so we
 * point it at the project's real `config/route.yaml`.
 */

import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { registerDirectorTool } from "../extensions/orchestrator/director.ts"
import { makeFakeCtx, makeFakePi } from "./_helpers/fakePi.ts"

const ROUTE_PATH = resolve(process.cwd(), "config/route.yaml")

describe("run_director tool wrapper", () => {
	it("registers under name `run_director`", () => {
		const pi = makeFakePi()
		registerDirectorTool(pi, ROUTE_PATH)
		expect(pi.has("run_director")).toBe(true)
	})

	it("returns a dispatch plan for a matching input", async () => {
		const pi = makeFakePi()
		registerDirectorTool(pi, ROUTE_PATH)
		const tool = pi.get("run_director")
		const result = (await tool.execute(
			"call-1",
			{ input: "write the next chapter" },
			undefined,
			undefined,
			makeFakeCtx(),
		)) as {
			content: Array<{ text: string }>
			details: {
				intent: string
				primary: string
				support: readonly string[]
				matched_via: string
			}
		}

		expect(result.details.intent).toBe("write_chapter")
		expect(result.details.primary).toBe("writer")
		expect(result.details.support).toContain("wiki_search")
		expect(result.details.support).toContain("planner")
		expect(["phrase", "keyword"]).toContain(result.details.matched_via)
		expect(result.content[0]?.text).toContain("Primary agent: writer")
	})

	it("plan_chapter dispatch plan surfaces wiki_search in support", async () => {
		const pi = makeFakePi()
		registerDirectorTool(pi, ROUTE_PATH)
		const tool = pi.get("run_director")
		const result = (await tool.execute(
			"call-1",
			{ input: "plan chapter 3" },
			undefined,
			undefined,
			makeFakeCtx(),
		)) as {
			details: { intent: string; support: readonly string[] }
		}

		expect(result.details.intent).toBe("plan_chapter")
		expect(result.details.support).toContain("wiki_search")
	})

	it("review_chapter dispatch plan surfaces wiki_search in support", async () => {
		const pi = makeFakePi()
		registerDirectorTool(pi, ROUTE_PATH)
		const tool = pi.get("run_director")
		const result = (await tool.execute(
			"call-1",
			{ input: "review the latest chapter" },
			undefined,
			undefined,
			makeFakeCtx(),
		)) as { details: { intent: string; support: readonly string[] } }

		expect(result.details.intent).toBe("review_chapter")
		expect(result.details.support).toContain("wiki_search")
	})

	it("throws when no route matches and LLM fallback is not wired", async () => {
		const pi = makeFakePi()
		registerDirectorTool(pi, ROUTE_PATH)
		const tool = pi.get("run_director")
		await expect(
			tool.execute(
				"call-1",
				{ input: "asdf totally unrelated xyzzy" },
				undefined,
				undefined,
				makeFakeCtx(),
			),
		).rejects.toThrow(/no route matched/i)
	})
})
