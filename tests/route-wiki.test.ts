/**
 * Tests for the wiki_search wiring through config/route.yaml.
 * Per ADR-0006 + the dispatch convention documented in the
 * run_director prompt: support list items are either agent IDs (mapped
 * to `delegate_to_<name>`) or bare tool names (called directly).
 */

import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { loadRouteTable } from "../extensions/orchestrator/route.ts"

const ROUTE_PATH = resolve(process.cwd(), "config/route.yaml")

describe("wiki_search routing — config/route.yaml", () => {
	it("loads the route table successfully", () => {
		const table = loadRouteTable(ROUTE_PATH)
		expect(table.routes.length).toBeGreaterThan(0)
	})

	it("lists wiki_search in the subagents registry", () => {
		const table = loadRouteTable(ROUTE_PATH)
		const wiki = table.routes.flatMap((r) => r.agents.support).includes("wiki_search")
		expect(wiki).toBe(true)
	})

	it("writes_chapter support includes wiki_search", () => {
		const table = loadRouteTable(ROUTE_PATH)
		const route = table.routes.find((r) => r.intent === "write_chapter")
		expect(route).toBeDefined()
		expect(route?.agents.support).toContain("wiki_search")
		expect(route?.agents.primary).toBe("writer")
	})

	it("plan_chapter support includes wiki_search", () => {
		const table = loadRouteTable(ROUTE_PATH)
		const route = table.routes.find((r) => r.intent === "plan_chapter")
		expect(route?.agents.support).toContain("wiki_search")
	})

	it("review_chapter support includes wiki_search", () => {
		const table = loadRouteTable(ROUTE_PATH)
		const route = table.routes.find((r) => r.intent === "review_chapter")
		expect(route?.agents.support).toContain("wiki_search")
	})

	it("revise_chapter support includes wiki_search", () => {
		const table = loadRouteTable(ROUTE_PATH)
		const route = table.routes.find((r) => r.intent === "revise_chapter")
		expect(route?.agents.support).toContain("wiki_search")
	})

	it("inspect/investigate routes do NOT include wiki_search (read-only minimal)", () => {
		const table = loadRouteTable(ROUTE_PATH)
		const inspect = table.routes.find((r) => r.intent === "inspect_novel_state")
		const investigate = table.routes.find((r) => r.intent === "investigate_continuity_break")
		expect(inspect?.agents.support).not.toContain("wiki_search")
		expect(investigate?.agents.support).not.toContain("wiki_search")
	})

	it("continue_novel is the only creative route without wiki_search (intentional — it's a resume, not a craft step)", () => {
		const table = loadRouteTable(ROUTE_PATH)
		const route = table.routes.find((r) => r.intent === "continue_novel")
		expect(route?.agents.support).not.toContain("wiki_search")
	})
})
