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
