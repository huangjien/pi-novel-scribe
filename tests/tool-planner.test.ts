/**
 * Tests for the `delegate_to_planner` pi-tool wrapper.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { registerPlannerAgent } from "../extensions/agents/planner.ts"
import { makeFakeCtx, makeFakePi } from "./_helpers/fakePi.ts"

let tmpDir = ""

beforeEach(() => {
	tmpDir = join(tmpdir(), `planner-tool-${Date.now()}-${Math.random().toString(36).slice(2)}`)
	mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true })
	vi.restoreAllMocks()
})

describe("delegate_to_planner tool wrapper", () => {
	it("registers under name `delegate_to_planner`", () => {
		const pi = makeFakePi()
		registerPlannerAgent(pi)
		expect(pi.has("delegate_to_planner")).toBe(true)
	})

	it("writes a plan and transitions status to planned", async () => {
		const pi = makeFakePi()
		registerPlannerAgent(pi)
		const chapterPath = join(tmpDir, "0001.md")
		writeFileSync(chapterPath, `---\nchapter: 1\nstatus: planned\n---\n\nBody.`, "utf8")

		const complete = vi.fn().mockResolvedValue({
			content: [
				{
					type: "text",
					text: "Here's the plan:\n```yaml\nid: opening\npov: sara\nbeats:\n  - setup\n  - escalation\n```\nDone.",
				},
			],
		})
		const ctx = makeFakeCtx({
			cwd: tmpDir,
			model: { id: "test-model" },
			modelRegistry: { complete },
		})
		const tool = pi.get("delegate_to_planner")
		const result = (await tool.execute(
			"c",
			{ chapter_id: chapterPath },
			undefined,
			undefined,
			ctx,
		)) as { content: Array<{ text: string }>; details: { chapterPath: string; status: string } }

		expect(complete).toHaveBeenCalledTimes(1)
		const details = result.details as unknown as { chapterPath: string; plan: unknown }
		expect(details.chapterPath).toBe(chapterPath)
		expect(details.plan).toEqual({
			id: "opening",
			pov: "sara",
			beats: ["setup", "escalation"],
		})
		expect(result.content[0]?.text).toContain("Planned")

		const updated = readFileSync(chapterPath, "utf8")
		expect(updated).toContain("plan:")
		expect(updated).toMatch(/status:\s*"?planned"?/)
	})

	it("throws when the LLM produces no yaml block", async () => {
		const pi = makeFakePi()
		registerPlannerAgent(pi)
		const chapterPath = join(tmpDir, "0002.md")
		writeFileSync(chapterPath, `---\nchapter: 2\nstatus: planned\n---\n\nBody.`, "utf8")

		const complete = vi.fn().mockResolvedValue({
			content: [{ type: "text", text: "I can't plan right now." }],
		})
		const ctx = makeFakeCtx({
			cwd: tmpDir,
			model: { id: "test-model" },
			modelRegistry: { complete },
		})
		const tool = pi.get("delegate_to_planner")
		await expect(
			tool.execute("c", { chapter_id: chapterPath }, undefined, undefined, ctx),
		).rejects.toThrow(/yaml fenced plan block/i)
	})
})
