/**
 * Tests for the `delegate_to_continuity` pi-tool wrapper.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { registerContinuityAgent } from "../extensions/agents/continuity.ts"
import { makeFakeCtx, makeFakePi } from "./_helpers/fakePi.ts"

let tmpDir = ""

beforeEach(() => {
	tmpDir = join(tmpdir(), `cont-tool-${Date.now()}-${Math.random().toString(36).slice(2)}`)
	mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true })
	vi.restoreAllMocks()
})

function setupNovelRepo(): void {
	// chapters/0001.md + 0002.md with @scene markers; language=en so the
	// language-filter refresh path picks them up.
	const chaptersDir = join(tmpDir, "chapters")
	mkdirSync(chaptersDir, { recursive: true })
	writeFileSync(
		join(chaptersDir, "0001.md"),
		`---\nchapter: 1\nstatus: approved\nlanguage: en\n---\n\n@scene id=a pov=sara\n\nSara learns the truth.`,
		"utf8",
	)
	writeFileSync(
		join(chaptersDir, "0002.md"),
		`---\nchapter: 2\nstatus: approved\nlanguage: en\n---\n\n@scene id=b pov=sara\n\nSara acts on it.`,
		"utf8",
	)
}

describe("delegate_to_continuity tool wrapper", () => {
	it("registers under name `delegate_to_continuity`", () => {
		const pi = makeFakePi()
		registerContinuityAgent(pi)
		expect(pi.has("delegate_to_continuity")).toBe(true)
	})

	it("inspect mode returns reader/character knowledge for an explicit character id", async () => {
		setupNovelRepo()
		const pi = makeFakePi()
		registerContinuityAgent(pi)
		const tool = pi.get("delegate_to_continuity")
		const result = (await tool.execute(
			"c",
			{ query: "what does sara know", mode: "inspect", character: "sara" },
			undefined,
			undefined,
			makeFakeCtx({ cwd: tmpDir }),
		)) as { content: Array<{ text: string }> }

		expect(result.content[0]?.text.toLowerCase()).toContain("sara")
	})

	it("investigate mode surfaces divergences (or lack thereof) for approved chapters", async () => {
		setupNovelRepo()
		const pi = makeFakePi()
		registerContinuityAgent(pi)
		const tool = pi.get("delegate_to_continuity")
		const result = (await tool.execute(
			"c",
			{ query: "any contradictions?", mode: "investigate" },
			undefined,
			undefined,
			makeFakeCtx({ cwd: tmpDir }),
		)) as { content: Array<{ text: string }> }

		expect(result.content[0]?.text).toMatch(/divergence|consistent|no issues/i)
	})

	it("refresh mode writes state/character-beliefs.yaml and reports it", async () => {
		setupNovelRepo()
		const pi = makeFakePi()
		registerContinuityAgent(pi)
		const tool = pi.get("delegate_to_continuity")
		const result = (await tool.execute(
			"c",
			{ query: "refresh", mode: "refresh" },
			undefined,
			undefined,
			makeFakeCtx({ cwd: tmpDir }),
		)) as { content: Array<{ text: string }>; details: { mode: string } }

		expect(result.details.mode).toBe("refresh")
		expect(result.content[0]?.text).toContain("Refreshed character beliefs")
		const { existsSync, readFileSync } = await import("node:fs")
		const beliefsPath = join(tmpDir, "state", "character-beliefs.yaml")
		expect(existsSync(beliefsPath)).toBe(true)
		const parsed = readFileSync(beliefsPath, "utf8")
		expect(parsed).toContain("characters:")
		expect(parsed).toContain("sara")
	})

	it("infers mode from the query string when mode is omitted", async () => {
		setupNovelRepo()
		const pi = makeFakePi()
		registerContinuityAgent(pi)
		const tool = pi.get("delegate_to_continuity")
		const result = (await tool.execute(
			"c",
			{ query: "investigate any contradictions" },
			undefined,
			undefined,
			makeFakeCtx({ cwd: tmpDir }),
		)) as { details: { mode: string } }

		expect(result.details.mode).toBe("investigate")
	})
})

describe("delegate_to_continuity — message branches", () => {
	it("inspect reports missing approved chapters (en + zh)", async () => {
		const pi = makeFakePi()
		registerContinuityAgent(pi)
		const tool = pi.get("delegate_to_continuity")

		const en = (await tool.execute(
			"c",
			{ query: "reader knowledge", mode: "inspect" },
			undefined,
			undefined,
			makeFakeCtx({ cwd: tmpDir }),
		)) as { content: Array<{ text: string }> }
		expect(en.content[0]?.text).toContain("No approved chapters found")

		const zh = (await tool.execute(
			"c",
			{ query: "reader knowledge", mode: "inspect", language: "zh" },
			undefined,
			undefined,
			makeFakeCtx({ cwd: tmpDir }),
		)) as { content: Array<{ text: string }> }
		expect(zh.content[0]?.text).toContain("未找到已批准章节")
	})

	it("inspect with a character answers in Chinese when language=zh", async () => {
		setupNovelRepo()
		const pi = makeFakePi()
		registerContinuityAgent(pi)
		const tool = pi.get("delegate_to_continuity")
		const result = (await tool.execute(
			"c",
			{ query: "what does sara know", mode: "inspect", character: "sara", language: "zh" },
			undefined,
			undefined,
			makeFakeCtx({ cwd: tmpDir }),
		)) as { content: Array<{ text: string }> }
		expect(result.content[0]?.text).toContain("见证了")
		expect(result.content[0]?.text).toContain("sara")
	})

	it("inspect reader knowledge answers in Chinese when language=zh", async () => {
		setupNovelRepo()
		const pi = makeFakePi()
		registerContinuityAgent(pi)
		const tool = pi.get("delegate_to_continuity")
		const result = (await tool.execute(
			"c",
			{ query: "reader knowledge", mode: "inspect", language: "zh" },
			undefined,
			undefined,
			makeFakeCtx({ cwd: tmpDir }),
		)) as { content: Array<{ text: string }> }
		expect(result.content[0]?.text).toContain("读者")
	})

	it("extracts the character from the possessive query form and honors chapter_index", async () => {
		setupNovelRepo()
		const pi = makeFakePi()
		registerContinuityAgent(pi)
		const tool = pi.get("delegate_to_continuity")
		const result = (await tool.execute(
			"c",
			{ query: "what are sara's beliefs", mode: "inspect", chapter_index: 1 },
			undefined,
			undefined,
			makeFakeCtx({ cwd: tmpDir }),
		)) as { content: Array<{ text: string }>; details: Record<string, unknown> }
		expect(result.details.character).toBe("sara")
		expect(result.details.chapterIndex).toBe(1)
		expect(result.content[0]?.text).toContain("through chapter 1")
		// Chapter 2's scene fact is out of scope.
		expect(result.content[0]?.text).toContain("a")
		expect(result.content[0]?.text).not.toContain("b")
	})

	it("investigate reports divergences in English when authored overrides exceed derivation", async () => {
		setupNovelRepo()
		const stateDir = join(tmpDir, "state")
		mkdirSync(stateDir, { recursive: true })
		writeFileSync(
			join(stateDir, "character-beliefs.yaml"),
			"characters:\n  sara:\n    authored_overrides: [ghost-fact]\n",
			"utf8",
		)
		const pi = makeFakePi()
		registerContinuityAgent(pi)
		const tool = pi.get("delegate_to_continuity")
		const result = (await tool.execute(
			"c",
			{ query: "why did sara act oddly", mode: "investigate" },
			undefined,
			undefined,
			makeFakeCtx({ cwd: tmpDir }),
		)) as { content: Array<{ text: string }> }
		expect(result.content[0]?.text).toContain("Found 1 divergence(s)")
		expect(result.content[0]?.text).toContain("ghost-fact")
	})

	it("investigate reports divergences in Chinese", async () => {
		setupNovelRepo()
		const stateDir = join(tmpDir, "state")
		mkdirSync(stateDir, { recursive: true })
		writeFileSync(
			join(stateDir, "character-beliefs.yaml"),
			"characters:\n  sara:\n    authored_overrides: [ghost-fact]\n",
			"utf8",
		)
		const pi = makeFakePi()
		registerContinuityAgent(pi)
		const tool = pi.get("delegate_to_continuity")
		const result = (await tool.execute(
			"c",
			{ query: "consistency check", mode: "investigate", language: "zh" },
			undefined,
			undefined,
			makeFakeCtx({ cwd: tmpDir }),
		)) as { content: Array<{ text: string }> }
		expect(result.content[0]?.text).toContain("发现 1 处矛盾")
	})

	it("investigate with no divergences answers in Chinese", async () => {
		setupNovelRepo()
		const pi = makeFakePi()
		registerContinuityAgent(pi)
		const tool = pi.get("delegate_to_continuity")
		const result = (await tool.execute(
			"c",
			{ query: "consistent so far", mode: "investigate", language: "zh" },
			undefined,
			undefined,
			makeFakeCtx({ cwd: tmpDir }),
		)) as { content: Array<{ text: string }> }
		expect(result.content[0]?.text).toContain("未检测到矛盾")
	})

	it("refresh reports in Chinese, including the language-filter note", async () => {
		setupNovelRepo()
		const pi = makeFakePi()
		registerContinuityAgent(pi)
		const tool = pi.get("delegate_to_continuity")
		const result = (await tool.execute(
			"c",
			{ query: "refresh beliefs", mode: "refresh", language: "zh" },
			undefined,
			undefined,
			makeFakeCtx({ cwd: tmpDir }),
		)) as { content: Array<{ text: string }> }
		expect(result.content[0]?.text).toContain("已刷新人物信念")
		// The filter follows the requested language; the en fixture matches 0.
		expect(result.content[0]?.text).toContain("仅含 zh 章节：匹配 0 章，跳过 2 章")
	})
})
