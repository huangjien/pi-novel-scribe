/**
 * Tests for ADR-0009 multi-chapter planning: N=1 backward compat,
 * N>1 batch path, per-block validation isolation, wiki packet
 * computed once per batch.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { registerPlannerAgent } from "../extensions/agents/planner.ts"
import { makeFakeCtx, makeFakePi } from "./_helpers/fakePi.ts"

let tmpDir = ""

beforeEach(() => {
	tmpDir = join(tmpdir(), `multi-plan-${Date.now()}-${Math.random().toString(36).slice(2)}`)
	mkdirSync(tmpDir, { recursive: true })
	// Deliberately missing wiki DB → packet wiki injection takes the ADR-0008 degradation path (offline, hermetic).
	const piDir = join(tmpDir, ".pi")
	mkdirSync(piDir, { recursive: true })
	writeFileSync(
		join(piDir, "settings.json"),
		JSON.stringify({ wikiDbPath: join(tmpDir, "no-wiki.db") }),
		"utf8",
	)
	const chapters = join(tmpDir, "chapters")
	mkdirSync(chapters, { recursive: true })
})

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true })
	vi.restoreAllMocks()
})

function writeChapter(fileName: string, fm: string): void {
	writeFileSync(join(tmpDir, "chapters", fileName), `---\n${fm}\n---\n\nbody.\n`, "utf8")
}

const VALID_BLOCK = (id: string, _idx: number) =>
	`  - id: ${id}\n    pov: sara\n    template_refs:\n      - { table: scene_templates, id: "st-001", how_used: "beat skeleton" }`

const MISSING_REFS_BLOCK = (id: string, _idx: number) =>
	`  - id: ${id}\n    pov: sara\n    beats: ["setup"]`

describe("delegate_to_planner: chapters=N batching (ADR-0009)", () => {
	it("registers the chapters parameter on the tool", () => {
		const pi = makeFakePi()
		registerPlannerAgent(pi)
		const spec = pi.get("delegate_to_planner").spec as {
			parameters: { properties: Record<string, unknown> }
		}
		expect(spec.parameters.properties.chapters).toBeDefined()
	})

	it("N=1 with chapters param behaves like the single-chapter path (backward compat)", async () => {
		const pi = makeFakePi()
		registerPlannerAgent(pi)
		writeChapter("0001.md", "chapter: 1\nstatus: planned")

		const complete = vi.fn().mockResolvedValue({
			content: [
				{
					type: "text",
					text: "```yaml\nid: opening\npov: sara\nbeats: [setup]\ntemplate_refs:\n  - { table: scene_templates, id: st-001, how_used: beat }\n```",
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
			{ chapter_id: "0001.md", chapters: 1 },
			undefined,
			undefined,
			ctx,
		)) as { details: { plan: Record<string, unknown> } }
		expect(complete).toHaveBeenCalledTimes(1)
		expect(result.details.plan.id).toBe("opening")
	})

	it("N=3 success path: writes 3 plans, status → planned, LLM called once", async () => {
		const pi = makeFakePi()
		registerPlannerAgent(pi)
		writeChapter("0001.md", "chapter: 1\nstatus: planned")
		writeChapter("0002.md", "chapter: 2\nstatus: planned")
		writeChapter("0003.md", "chapter: 3\nstatus: planned")

		const complete = vi.fn().mockResolvedValue({
			content: [
				{
					type: "text",
					text:
						"```yaml\nchapters:\n" +
						VALID_BLOCK("opening", 0) +
						"\n" +
						VALID_BLOCK("rising", 1) +
						"\n" +
						VALID_BLOCK("climax", 2) +
						"\n```",
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
			{ chapter_id: "0001.md", chapters: 3 },
			undefined,
			undefined,
			ctx,
		)) as {
			content: Array<{ text: string }>
			details: { persisted: string[]; failed: unknown[]; warning?: string }
		}
		expect(complete).toHaveBeenCalledTimes(1)
		expect(result.details.persisted).toHaveLength(3)
		expect(result.details.failed).toEqual([])
		expect(result.details.warning).toBeUndefined()
		expect(result.content[0]?.text).toContain("Wrote 3 plan(s)")
		for (const ch of ["0001.md", "0002.md", "0003.md"]) {
			const updated = readFileSync(join(tmpDir, "chapters", ch), "utf8")
			expect(updated).toContain("plan:")
			expect(updated).toMatch(/status:\s*"?planned"?/)
		}
	})

	it("per-block failure isolation: chapter 2 fails Q22; chapters 1 + 3 are written", async () => {
		const pi = makeFakePi()
		registerPlannerAgent(pi)
		writeChapter("0001.md", "chapter: 1\nstatus: planned")
		writeChapter("0002.md", "chapter: 2\nstatus: planned")
		writeChapter("0003.md", "chapter: 3\nstatus: planned")

		const complete = vi.fn().mockResolvedValue({
			content: [
				{
					type: "text",
					text:
						"```yaml\nchapters:\n" +
						VALID_BLOCK("opening", 0) +
						"\n" +
						MISSING_REFS_BLOCK("rising", 1) +
						"\n" +
						VALID_BLOCK("climax", 2) +
						"\n```",
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
			{ chapter_id: "0001.md", chapters: 3 },
			undefined,
			undefined,
			ctx,
		)) as {
			details: {
				persisted: string[]
				failed: Array<{ chapterPath: string; reason: string }>
				warning?: string
			}
		}

		expect(complete).toHaveBeenCalledTimes(1)
		expect(result.details.persisted).toHaveLength(2)
		expect(result.details.failed).toHaveLength(1)
		expect(result.details.failed[0]?.chapterPath).toContain("0002.md")
		expect(result.details.failed[0]?.reason).toMatch(/template_refs/i)
		expect(result.details.warning).toMatch(/failed validation/i)

		const ch1 = readFileSync(join(tmpDir, "chapters", "0001.md"), "utf8")
		const ch2 = readFileSync(join(tmpDir, "chapters", "0002.md"), "utf8")
		const ch3 = readFileSync(join(tmpDir, "chapters", "0003.md"), "utf8")
		expect(ch1).toContain("plan:")
		expect(ch2).not.toContain("plan:") // untouched
		expect(ch3).toContain("plan:")
	})

	it("clamps chapters to 1..8 (oversized request → no overflow)", async () => {
		const pi = makeFakePi()
		registerPlannerAgent(pi)
		writeChapter("0001.md", "chapter: 1\nstatus: planned")
		writeChapter("0002.md", "chapter: 2\nstatus: planned")

		const complete = vi.fn().mockResolvedValue({
			content: [
				{
					type: "text",
					text: `\`\`\`yaml\nchapters:\n${VALID_BLOCK("a", 0)}\n\`\`\``,
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
			{ chapter_id: "0001.md", chapters: 999 },
			undefined,
			undefined,
			ctx,
		)) as { details: { chapterPaths: string[] } }
		expect(result.details.chapterPaths.length).toBeLessThanOrEqual(8)
		expect(result.details.chapterPaths.length).toBeLessThanOrEqual(2)
	})

	it("throws when no writable chapters exist after the anchor", async () => {
		const pi = makeFakePi()
		registerPlannerAgent(pi)
		writeChapter("0001.md", "chapter: 1\nstatus: approved")
		writeChapter("0002.md", "chapter: 2\nstatus: canonized")

		const complete = vi.fn()
		const ctx = makeFakeCtx({
			cwd: tmpDir,
			model: { id: "test-model" },
			modelRegistry: { complete },
		})
		const tool = pi.get("delegate_to_planner")
		await expect(
			tool.execute("c", { chapter_id: "0001.md", chapters: 3 }, undefined, undefined, ctx),
		).rejects.toThrow(/no writable chapters/i)
		expect(complete).not.toHaveBeenCalled()
	})

	it("wiki packet computed once for the batch (single LLM call regardless of N)", async () => {
		const pi = makeFakePi()
		registerPlannerAgent(pi)
		writeChapter("0001.md", "chapter: 1\nstatus: planned")
		writeChapter("0002.md", "chapter: 2\nstatus: planned")

		const complete = vi.fn().mockResolvedValue({
			content: [
				{
					type: "text",
					text: `\`\`\`yaml\nchapters:\n${VALID_BLOCK("a", 0)}\n${VALID_BLOCK("b", 1)}\n\`\`\``,
				},
			],
		})
		const ctx = makeFakeCtx({
			cwd: tmpDir,
			model: { id: "test-model" },
			modelRegistry: { complete },
		})
		const tool = pi.get("delegate_to_planner")
		await tool.execute("c", { chapter_id: "0001.md", chapters: 2 }, undefined, undefined, ctx)
		expect(complete).toHaveBeenCalledTimes(1)
	})
})
