/**
 * Tests for the `delegate_to_critic` pi-tool wrapper.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { registerCriticAgent } from "../extensions/agents/critic.ts"
import { makeFakeCtx, makeFakePi } from "./_helpers/fakePi.ts"

let tmpDir = ""

beforeEach(() => {
	tmpDir = join(tmpdir(), `critic-tool-${Date.now()}-${Math.random().toString(36).slice(2)}`)
	mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true })
	vi.restoreAllMocks()
})

const VALID_REVIEW_YAML = `
summary: solid chapter
issues:
  - category: pacing
    severity: medium
    evidence: paragraph 4 drags
    impact: reader loses interest
    recommendation: cut 200 words
  - category: character
    severity: low
    evidence: sara's motivation unclear
    impact: mild confusion
    recommendation: add 2 lines of inner monologue
`

describe("delegate_to_critic tool wrapper", () => {
	it("registers under name `delegate_to_critic`", () => {
		const pi = makeFakePi()
		registerCriticAgent(pi)
		expect(pi.has("delegate_to_critic")).toBe(true)
	})

	it("writes a review on valid yaml and reports issue count", async () => {
		const pi = makeFakePi()
		registerCriticAgent(pi)
		const chapterPath = join(tmpDir, "0001.md")
		writeFileSync(
			chapterPath,
			`---\nchapter: 1\nstatus: drafted\n---\n\n@scene id=x pov=sara\n\nBody.`,
			"utf8",
		)

		const complete = vi.fn().mockResolvedValue({
			content: [
				{
					type: "text",
					text: `Review:\n\`\`\`yaml\n${VALID_REVIEW_YAML}\n\`\`\`\nDone.`,
				},
			],
		})
		const ctx = makeFakeCtx({
			cwd: tmpDir,
			model: { id: "test-model" },
			modelRegistry: { complete },
		})
		const tool = pi.get("delegate_to_critic")
		const result = (await tool.execute(
			"c",
			{ chapter_id: chapterPath },
			undefined,
			undefined,
			ctx,
		)) as {
			content: Array<{ text: string }>
			details: { chapterPath: string; review: { issues: readonly unknown[] } }
		}

		expect(complete).toHaveBeenCalledTimes(1)
		expect(result.details.review.issues).toHaveLength(2)
		expect(result.content[0]?.text).toContain("2 issue(s)")
		const updated = readFileSync(chapterPath, "utf8")
		expect(updated).toContain("review:")
	})

	it("rejects a review block whose issues are missing required fields", async () => {
		const pi = makeFakePi()
		registerCriticAgent(pi)
		const chapterPath = join(tmpDir, "0002.md")
		writeFileSync(chapterPath, `---\nchapter: 2\nstatus: drafted\n---\n\nBody.`, "utf8")

		const BAD = `
summary: sloppy
issues:
  - category: pacing
    severity: medium
`
		const complete = vi.fn().mockResolvedValue({
			content: [{ type: "text", text: `\`\`\`yaml\n${BAD}\n\`\`\`` }],
		})
		const ctx = makeFakeCtx({
			cwd: tmpDir,
			model: { id: "test-model" },
			modelRegistry: { complete },
		})
		const tool = pi.get("delegate_to_critic")
		// With the bad YAML the tool will write a review with zero issues
		// (extractIssues filters out malformed entries), so no throw — but
		// the resulting review should still be written and contain zero
		// issues. Assert that.
		const result = (await tool.execute(
			"c",
			{ chapter_id: chapterPath },
			undefined,
			undefined,
			ctx,
		)) as { details: { review: { issues: readonly unknown[] } } }
		expect(result.details.review.issues).toHaveLength(0)
	})
})
