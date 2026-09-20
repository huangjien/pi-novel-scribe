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
	// Deliberately missing wiki DB → packet wiki injection takes the ADR-0008 degradation path (offline, hermetic).
	const piDir = join(tmpDir, ".pi")
	mkdirSync(piDir, { recursive: true })
	writeFileSync(
		join(piDir, "settings.json"),
		JSON.stringify({ wikiDbPath: join(tmpDir, "no-wiki.db") }),
		"utf8",
	)
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
					text: 'Here\'s the plan:\n```yaml\nid: opening\npov: sara\nbeats:\n  - setup\n  - escalation\ntemplate_refs:\n  - { table: scene_templates, id: "st-001", how_used: "opening beat skeleton" }\n```\nDone.',
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
			template_refs: [
				{ table: "scene_templates", id: "st-001", how_used: "opening beat skeleton" },
			],
		})
		expect(result.content[0]?.text).toContain("Planned")

		const updated = readFileSync(chapterPath, "utf8")
		expect(updated).toContain("plan:")
		expect(updated).toMatch(/status:\s*"?planned"?/)
	})

	it("rejects a plan that cites no template_refs and carries no exemption (Q22)", async () => {
		const pi = makeFakePi()
		registerPlannerAgent(pi)
		const chapterPath = join(tmpDir, "0003.md")
		writeFileSync(chapterPath, `---\nchapter: 3\nstatus: planned\n---\n\nBody.`, "utf8")

		const complete = vi.fn().mockResolvedValue({
			content: [
				{
					type: "text",
					text: "```yaml\nid: opening\npov: sara\nbeats:\n  - setup\n```",
				},
			],
		})
		const ctx = makeFakeCtx({
			cwd: tmpDir,
			model: { id: "test-model" },
			modelRegistry: { complete },
		})
		const tool = pi.get("delegate_to_planner")
		await expect(
			tool.execute("c", { chapter_id: chapterPath }, undefined, undefined, ctx),
		).rejects.toThrow(/template_refs/i)
	})

	it("accepts a plan with an explicit exemption plus rationale", async () => {
		const pi = makeFakePi()
		registerPlannerAgent(pi)
		const chapterPath = join(tmpDir, "0004.md")
		writeFileSync(chapterPath, `---\nchapter: 4\nstatus: planned\n---\n\nBody.`, "utf8")

		const complete = vi.fn().mockResolvedValue({
			content: [
				{
					type: "text",
					text: '```yaml\nid: opening\npov: sara\ntemplate_refs_exempt: true\ntemplate_refs_exempt_rationale: "corpus has no match for this dream-sequence chapter"\n```',
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
		)) as { details: { plan: Record<string, unknown> } }
		expect(result.details.plan.template_refs_exempt).toBe(true)
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
