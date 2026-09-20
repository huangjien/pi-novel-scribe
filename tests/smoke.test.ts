/**
 * End-to-end smoke for the v0.1+ vertical on the `examples/novel-scribe-demo/`
 * fixture. Drives planner → writer → critic on chapter 1, asserts:
 *
 *  - chapter frontmatter grows from `plan:` → `prose:` → `review:` blocks;
 *  - status walks planned → human_editing (after writer);
 *  - wiki packet carries `wikiReferences: null` + warning (no wikiDbPath in
 *    the sample → ADR-0008 degradation path);
 *  - template_refs Q22 gate is satisfied (the smoke's LLM mock returns valid
 *    template_refs for the plan block).
 *
 * No real LLM call (mocked), no editor spawn, no network. Fast (~50ms).
 */

import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { registerCriticAgent } from "../extensions/agents/critic.ts"
import { registerPlannerAgent } from "../extensions/agents/planner.ts"
import { registerWriterAgent } from "../extensions/agents/writer.ts"
import { makeFakeCtx, makeFakePi } from "./_helpers/fakePi.ts"

const SAMPLE_NOVEL_REPO = resolve(process.cwd(), "examples/novel-scribe-demo")

function parseUserMessagePayload(content: string): Record<string, unknown> {
	const fenceMatch = /```\n([\s\S]*?)\n```/.exec(content)
	if (!fenceMatch || fenceMatch[1] === undefined) {
		throw new Error(`expected fenced JSON block in user message: ${content.slice(0, 120)}`)
	}
	return JSON.parse(fenceMatch[1]) as Record<string, unknown>
}

function loadChapter(fileName: string): string {
	const path = join(SAMPLE_NOVEL_REPO, "chapters", fileName)
	if (!existsSync(path)) {
		throw new Error(`sample chapter missing: ${path} — fixture corrupt?`)
	}
	return readFileSync(path, "utf8")
}

const PLAN_YAML = `id: opening
pov: sara
objective: Sara opens John's letter and reads the first line.
conflict: John wrote the letter 11 days ago — what did he know then that he hadn't told her before?
beats:
  - envelope on the kitchen table
  - Sara's first read of the letter
template_refs:
  - { table: scene_templates, id: st-001, how_used: opening beat skeleton }
`

const PROSE_MARKDOWN = `@scene id=opening pov=sara\n\nSara Aoki sat at the kitchen table and turned the envelope over in her hands. The postmark was eleven days old. The ink of her brother's handwriting was unmistakable.`

const REVIEW_YAML = `summary: solid opening
issues:
  - category: prose
    severity: low
    evidence: the first paragraph is dense
    impact: minor pacing
    recommendation: trim 10 words
`

describe("end-to-end smoke: examples/novel-scribe-demo (ADR-0010)", () => {
	it("drives planner → writer → critic on chapter 1 with mocked LLM", async () => {
		expect(existsSync(join(SAMPLE_NOVEL_REPO, ".pi", "settings.json"))).toBe(true)
		expect(existsSync(join(SAMPLE_NOVEL_REPO, "chapters", "0001.md"))).toBe(true)

		const complete = vi
			.fn()
			.mockResolvedValueOnce({
				content: [{ type: "text", text: `\`\`\`yaml\n${PLAN_YAML}\n\`\`\`` }],
			})
			.mockResolvedValueOnce({ content: [{ type: "text", text: PROSE_MARKDOWN }] })
			.mockResolvedValueOnce({
				content: [{ type: "text", text: `\`\`\`yaml\n${REVIEW_YAML}\n\`\`\`` }],
			})

		const ctx = makeFakeCtx({
			cwd: SAMPLE_NOVEL_REPO,
			model: { id: "smoke-model" },
			modelRegistry: { complete },
		})

		const pi = makeFakePi()
		registerPlannerAgent(pi)
		registerWriterAgent(pi)
		registerCriticAgent(pi)

		const plannerTool = pi.get("delegate_to_planner")
		const writerTool = pi.get("delegate_to_writer")
		const criticTool = pi.get("delegate_to_critic")

		// 1. Plan chapter 1
		const planResult = (await plannerTool.execute(
			"c",
			{ chapter_id: "0001.md" },
			undefined,
			undefined,
			ctx,
		)) as { content: Array<{ text: string }> }
		expect(planResult.content[0]?.text).toMatch(/Planned/)
		expect(complete).toHaveBeenCalledTimes(1)

		// Planner user message: payload has wikiReferences: null (no wikiDbPath → degradation)
		const plannerPayload = parseUserMessagePayload(
			complete.mock.calls[0]?.[1].messages[0].content as string,
		)
		expect(plannerPayload.wikiReferences).toBeNull()
		expect(plannerPayload.activeStoryLines).toEqual(["sara-investigation", "the-watcher"])

		// Chapter 1 now has plan: block, status still planned
		const afterPlan = loadChapter("0001.md")
		expect(afterPlan).toContain("plan:")
		expect(afterPlan).toContain("template_refs")
		expect(afterPlan).toMatch(/status:\s*"?planned"?/)

		// 2. Write chapter 1 → prose + status → human_editing
		const writeResult = (await writerTool.execute(
			"c",
			{ chapter_id: "0001.md" },
			undefined,
			undefined,
			ctx,
		)) as { details: { wordCount: number } }
		expect(writeResult.details.wordCount).toBeGreaterThan(0)
		expect(complete).toHaveBeenCalledTimes(2)

		// Writer payload: wiki degradation warning present
		const writerPayload = parseUserMessagePayload(
			complete.mock.calls[1]?.[1].messages[0].content as string,
		)
		expect(writerPayload.wikiReferences).toBeNull()
		expect(complete.mock.calls[1]?.[1].messages[0].content).toMatch(/wiki references unavailable/i)

		const afterWrite = loadChapter("0001.md")
		expect(afterWrite).toContain("Sara Aoki sat at the kitchen table")
		expect(afterWrite).toMatch(/status:\s*"?human_editing"?/)

		// 3. Review chapter 1 → review: block
		const reviewResult = (await criticTool.execute(
			"c",
			{ chapter_id: "0001.md" },
			undefined,
			undefined,
			ctx,
		)) as { details: { review: { issues: readonly unknown[]; summary: string } } }
		expect(reviewResult.details.review.issues).toHaveLength(1)
		expect(reviewResult.details.review.summary).toContain("solid opening")
		expect(complete).toHaveBeenCalledTimes(3)

		const afterReview = loadChapter("0001.md")
		expect(afterReview).toContain("review:")
		expect(afterReview).toContain("trim 10 words")
	})

	it("wiki packet degradation: sample pins nonexistent wikiDbPath to force ADR-0008 degradation", () => {
		// The sample pins `wikiDbPath` to a path that does not exist on disk.
		// This makes the ADR-0008 degradation path deterministic on every
		// machine (including dev machines where the wst snapshot default
		// would otherwise resolve successfully).
		const settings = JSON.parse(
			readFileSync(join(SAMPLE_NOVEL_REPO, ".pi", "settings.json"), "utf8"),
		)
		const wikiDbPath = settings.wikiDbPath
		expect(typeof wikiDbPath).toBe("string")
		expect(existsSync(wikiDbPath)).toBe(false)
	})

	it("sample novel repo carries the expected fixtures (representation invariant)", () => {
		expect(existsSync(join(SAMPLE_NOVEL_REPO, "characters", "sara", "profile.yaml"))).toBe(true)
		expect(existsSync(join(SAMPLE_NOVEL_REPO, "characters", "john", "profile.yaml"))).toBe(true)
		expect(existsSync(join(SAMPLE_NOVEL_REPO, "story", "story-lines.yaml"))).toBe(true)
		expect(existsSync(join(SAMPLE_NOVEL_REPO, "story", "foreshadowing.yaml"))).toBe(true)
		expect(existsSync(join(SAMPLE_NOVEL_REPO, "story", "unresolved-threads.yaml"))).toBe(true)
		expect(existsSync(join(SAMPLE_NOVEL_REPO, "story", "timeline.yaml"))).toBe(true)
		for (let i = 1; i <= 5; i++) {
			const fileName = `000${i}.md`
			expect(existsSync(join(SAMPLE_NOVEL_REPO, "chapters", fileName))).toBe(true)
		}
	})
})
