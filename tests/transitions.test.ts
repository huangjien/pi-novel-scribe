import { describe, expect, it } from "vitest"
import {
	canTransition,
	findPath,
	isTerminal,
	nextStatusesFrom,
	TRANSITIONS,
	WORKFLOW_STATUSES,
} from "../extensions/workflow/transitions.ts"

describe("canTransition", () => {
	it("approves every edge in the published TRANSITIONS list", () => {
		for (const r of TRANSITIONS) {
			expect(canTransition(r.from, r.to)).toEqual({ ok: true, reason: r.rationale })
		}
	})

	it("rejects edges that aren't in the graph", () => {
		const c = canTransition("planned", "approved")
		expect(c.ok).toBe(false)
		expect(c.reason).toMatch(/no edge/)
	})

	it("rejects any transition out of canonized (append-only)", () => {
		for (const to of WORKFLOW_STATUSES) {
			if (to === "canonized") continue
			expect(canTransition("canonized", to).ok).toBe(false)
		}
	})
})

describe("isTerminal", () => {
	it("returns true only for approved and canonized", () => {
		expect(isTerminal("approved")).toBe(true)
		expect(isTerminal("canonized")).toBe(true)
		expect(isTerminal("drafted")).toBe(false)
		expect(isTerminal("human_editing")).toBe(false)
		expect(isTerminal("writing")).toBe(false)
		expect(isTerminal("planned")).toBe(false)
		expect(isTerminal("edited")).toBe(false)
		expect(isTerminal("continuity_check")).toBe(false)
		expect(isTerminal("reviewing")).toBe(false)
		expect(isTerminal("revision_required")).toBe(false)
	})
})

describe("nextStatusesFrom", () => {
	it("returns the unique outgoing edges", () => {
		const next = nextStatusesFrom("human_editing")
		// human_editing → {edited, drafted}
		expect(next.sort()).toEqual(["drafted", "edited"])
	})

	it("includes terminal successors when explicitly asked", () => {
		const withTerminal = nextStatusesFrom("approved", { includeTerminal: true })
		expect(withTerminal).toContain("canonized")
	})

	it("omits terminal successors by default", () => {
		const without = nextStatusesFrom("approved")
		expect(without).not.toContain("canonized")
	})

	it("returns empty array for canonized (no outgoing edges)", () => {
		expect(nextStatusesFrom("canonized")).toEqual([])
	})
})

describe("findPath", () => {
	it("returns single-node path when from === to", () => {
		expect(findPath("planned", "planned")).toEqual(["planned"])
	})

	it("returns the direct path planned → writing → drafted", () => {
		const path = findPath("planned", "drafted")
		expect(path).toEqual(["planned", "writing", "drafted"])
	})

	it("returns the full happy-path planned → canonized", () => {
		const path = findPath("planned", "canonized")
		expect(path).not.toBeNull()
		// Sanity: first and last
		expect(path?.[0]).toBe("planned")
		expect(path?.[path.length - 1]).toBe("canonized")
	})

	it("returns null when no path exists", () => {
		// canonized is terminal — nothing exits it.
		expect(findPath("canonized", "drafted")).toBeNull()
	})
})
