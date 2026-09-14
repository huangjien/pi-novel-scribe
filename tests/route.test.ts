import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { loadRouteTable, matchRoute } from "../extensions/orchestrator/route.ts"

const SAMPLE_ROUTE_YAML = `
version: 1

subagents:
  - id: director
    role: Orchestrator
    tier: expensive
  - id: writer
    role: Prose
    tier: balanced
  - id: planner
    role: Plan
    tier: balanced
  - id: critic
    role: Review
    tier: expensive
  - id: continuity
    role: Canon
    tier: expensive

routes:
  - intent: write_chapter
    description: "Write a chapter"
    triggers:
      keywords: [write, draft, generate, "next chapter"]
      phrases:
        - write the next chapter
        - draft chapter
    agents:
      primary: writer
      support: [planner, continuity]
    requires_state: ["chapters.next_unapproved"]
    transitions_status: [planned, writing, drafted]
    priority: 100

  - intent: plan_chapter
    description: "Plan a chapter"
    triggers:
      keywords: [plan, outline, scaffold]
      phrases:
        - plan chapter
        - outline chapter
    agents:
      primary: planner
      support: []
    requires_state: []
    transitions_status: []
    priority: 95

  - intent: review_chapter
    description: "Review a chapter"
    triggers:
      keywords: [review, critique, feedback]
      phrases:
        - review chapter
        - give me feedback
    agents:
      primary: critic
      support: [continuity]
    requires_state: ["chapters.drafted_or_approved"]
    transitions_status: []
    priority: 90

  - intent: approve_pending_change
    description: "Approve a pending change"
    triggers:
      keywords: [approve, yes, accept]
      phrases:
        - approve the change
        - looks good
    agents:
      primary: director
      support: []
    requires_state: ["workflow.pending_approval"]
    transitions_status: []
    priority: 200

fallback:
  intent: meta_novel_scribe
  description: "Fallback"
  triggers:
    keywords: []
    phrases: []
  agents:
    primary: director
    support: []
  requires_state: []
  transitions_status: []
  priority: 0

recursion_caps_default:
  max_agent_depth: 2
  max_subagents_per_task: 4
  max_iterations: 2
  max_tokens_per_call: 8000
  max_time_seconds: 120
`

let sandbox: string

beforeEach(() => {
	sandbox = mkdtempSync(join(tmpdir(), "pi-novel-scribe-route-test-"))
})

afterEach(() => {
	rmSync(sandbox, { recursive: true, force: true })
})

function writeSampleRouteTable(filename = "route.yaml"): string {
	const path = join(sandbox, filename)
	writeFileSync(path, SAMPLE_ROUTE_YAML, "utf8")
	return path
}

describe("loadRouteTable", () => {
	it("parses a well-formed route.yaml", () => {
		const path = writeSampleRouteTable()
		const table = loadRouteTable(path)
		expect(table.version).toBe(1)
		expect(table.routes.length).toBe(4)
		expect(table.fallback?.intent).toBe("meta_novel_scribe")
		expect(table.recursion_caps_default.max_agent_depth).toBe(2)
	})

	it("parses triggers with keywords and phrases", () => {
		const path = writeSampleRouteTable()
		const table = loadRouteTable(path)
		const write = table.routes.find((r) => r.intent === "write_chapter")
		expect(write?.triggers.keywords).toContain("draft")
		expect(write?.triggers.phrases).toContain("write the next chapter")
	})

	it("parses agents.primary and agents.support", () => {
		const path = writeSampleRouteTable()
		const table = loadRouteTable(path)
		const write = table.routes.find((r) => r.intent === "write_chapter")
		expect(write?.agents.primary).toBe("writer")
		expect(write?.agents.support).toEqual(["planner", "continuity"])
	})

	it("throws when the file is missing", () => {
		expect(() => loadRouteTable("/nonexistent/path/route.yaml")).toThrow(/not found/)
	})

	it("throws when the YAML is malformed", () => {
		const path = join(sandbox, "bad.yaml")
		writeFileSync(path, "version: [unclosed", "utf8")
		expect(() => loadRouteTable(path)).toThrow(/YAML parse error/)
	})

	it("throws when 'routes' is missing", () => {
		const path = join(sandbox, "no-routes.yaml")
		writeFileSync(path, "version: 1\n", "utf8")
		expect(() => loadRouteTable(path)).toThrow(/"routes" must be an array/)
	})
})

describe("matchRoute", () => {
	function table() {
		return loadRouteTable(writeSampleRouteTable())
	}

	it("matches a phrase trigger", () => {
		const m = matchRoute("please write the next chapter", table())
		expect(m?.intent).toBe("write_chapter")
		expect(m?.matched_via).toBe("phrase")
		expect(m?.matched_trigger).toBe("write the next chapter")
	})

	it("matches a keyword trigger", () => {
		const m = matchRoute("outline the next bit", table())
		expect(m?.intent).toBe("plan_chapter")
		expect(m?.matched_via).toBe("keyword")
	})

	it("case-insensitive matching", () => {
		const m = matchRoute("WRITE THE NEXT CHAPTER", table())
		expect(m?.intent).toBe("write_chapter")
	})

	it("phrase matches outrank keyword matches", () => {
		// "approve the change" matches the approve route via phrase,
		// even though "change" could conceivably match other routes.
		const m = matchRoute("I want to approve the change", table())
		expect(m?.intent).toBe("approve_pending_change")
	})

	it("higher priority wins on overlapping matches", () => {
		// "approve" keyword in the approve route (priority 200)
		// vs. "review" — but if "approve" appears anywhere, approve wins.
		// Crafted: input contains "approve" + "review" keywords;
		// approve's priority is 200, review's is 90.
		const m = matchRoute("please approve this and review later", table())
		expect(m?.intent).toBe("approve_pending_change")
	})

	it("returns null for unmatched input", () => {
		expect(matchRoute("hello world", table())).toBeNull()
	})

	it("returns null for empty input", () => {
		expect(matchRoute("", table())).toBeNull()
	})

	it("returns null for whitespace-only input", () => {
		expect(matchRoute("   ", table())).toBeNull()
	})
})
