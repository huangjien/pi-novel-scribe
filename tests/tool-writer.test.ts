/**
 * Tests for the `delegate_to_writer` pi-tool wrapper.
 * Mocks `ctx.modelRegistry.complete()` and the chapter file I/O so we
 * can assert the Writer's tool body without a real LLM or editor.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { registerWriterAgent } from "../extensions/agents/writer.ts"
import { makeFakeCtx, makeFakePi } from "./_helpers/fakePi.ts"

let tmpDir = ""

beforeEach(() => {
	tmpDir = join(tmpdir(), `writer-tool-${Date.now()}-${Math.random().toString(36).slice(2)}`)
	mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true })
	vi.restoreAllMocks()
})

function writeChapter(path: string, body: string): void {
	const fullBody = body.includes("@scene") ? body : `@scene id=opening pov=sara\n\n${body}`
	writeFileSync(path, `---\nchapter: 1\nstatus: planned\n---\n\n${fullBody}`, "utf8")
}

describe("delegate_to_writer tool wrapper", () => {
	it("registers under name `delegate_to_writer`", () => {
		const pi = makeFakePi()
		registerWriterAgent(pi)
		expect(pi.has("delegate_to_writer")).toBe(true)
		const spec = pi.get("delegate_to_writer").spec as Record<string, unknown>
		expect(spec.label).toBe("Writer")
		expect(Array.isArray(spec.promptGuidelines)).toBe(true)
	})

	it("throws when no model is bound to the session", async () => {
		const pi = makeFakePi()
		registerWriterAgent(pi)
		const chapterPath = join(tmpDir, "0001.md")
		writeChapter(chapterPath, "Body.")
		const ctx = makeFakeCtx({ cwd: tmpDir, model: undefined })
		const tool = pi.get("delegate_to_writer")
		await expect(
			tool.execute("c", { chapter_id: chapterPath }, undefined, undefined, ctx),
		).rejects.toThrow(/no active model/i)
	})

	it("refuses to overwrite an approved chapter", async () => {
		const pi = makeFakePi()
		registerWriterAgent(pi)
		const chapterPath = join(tmpDir, "0002.md")
		writeChapter(chapterPath, "Body.")
		// rewrite to status: approved
		writeFileSync(chapterPath, `---\nchapter: 2\nstatus: approved\n---\n\nFinal.`, "utf8")
		const ctx = makeFakeCtx({
			cwd: tmpDir,
			model: { id: "x" },
			modelRegistry: { complete: vi.fn() },
		})
		const tool = pi.get("delegate_to_writer")
		await expect(
			tool.execute("c", { chapter_id: chapterPath }, undefined, undefined, ctx),
		).rejects.toThrow(/refusing to overwrite approved/i)
	})

	it("writes prose and transitions status to human_editing on success", async () => {
		const pi = makeFakePi()
		registerWriterAgent(pi)
		const chapterPath = join(tmpDir, "0003.md")
		writeChapter(chapterPath, "old body")

		const complete = vi.fn().mockResolvedValue({
			content: [
				{
					type: "text",
					text: "@scene id=opening pov=sara\n\nSara walked the dark corridor. The floorboards creaked.",
				},
			],
		})
		const ctx = makeFakeCtx({
			cwd: tmpDir,
			model: { id: "test-model" },
			modelRegistry: { complete },
		})
		const tool = pi.get("delegate_to_writer")
		const result = (await tool.execute(
			"c",
			{ chapter_id: chapterPath },
			undefined,
			undefined,
			ctx,
		)) as { content: Array<{ text: string }>; details: { wordCount: number; pov: string } }

		expect(complete).toHaveBeenCalledTimes(1)
		expect(result.details.pov).toBe("sara")
		expect(result.details.wordCount).toBeGreaterThan(0)
		expect(result.content[0]?.text).toContain("Drafted")
		expect(result.content[0]?.text).toContain("human_editing")

		// Status was transitioned
		const { readFileSync } = await import("node:fs")
		const updated = readFileSync(chapterPath, "utf8")
		expect(updated).toMatch(/status:\s*"?human_editing"?/)
	})

	it("throws when the LLM produces no prose", async () => {
		const pi = makeFakePi()
		registerWriterAgent(pi)
		const chapterPath = join(tmpDir, "0004.md")
		writeChapter(chapterPath, "old body")

		const complete = vi.fn().mockResolvedValue({
			content: [{ type: "text", text: "   \n  " }],
		})
		const ctx = makeFakeCtx({
			cwd: tmpDir,
			model: { id: "test-model" },
			modelRegistry: { complete },
		})
		const tool = pi.get("delegate_to_writer")
		await expect(
			tool.execute("c", { chapter_id: chapterPath }, undefined, undefined, ctx),
		).rejects.toThrow(/LLM produced no prose/i)
	})
})
