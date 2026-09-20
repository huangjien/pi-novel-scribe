/**
 * Tests for ADR-0008 wiki-first context: query derivation, the Q22
 * template_refs validator/gate, packet injection with the session
 * cache + budget, and the degradation rule (never block writing).
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ExtensionContext } from "@earendil-works/pi-coding-agent"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { registerCriticAgent } from "../extensions/agents/critic.ts"
import { checkRequiresState } from "../extensions/novel/requires-state.ts"
import { clearWikiCache, createRerankBudget } from "../extensions/wiki/cache.ts"
import {
	criticWikiQuery,
	injectWikiReferences,
	plannerWikiQuery,
	validateTemplateRefs,
	writerWikiQuery,
} from "../extensions/wiki/context.ts"
import { _resetWikiDbCache } from "../extensions/wiki/db.ts"
import { makeFakeCtx, makeFakePi } from "./_helpers/fakePi.ts"
import { seedWikiFixture } from "./_helpers/wikiFixture.ts"

let tmpDir = ""
let dbPath = ""

function writeWikiSettings(cwd: string, path: string): void {
	const dir = join(cwd, ".pi")
	mkdirSync(dir, { recursive: true })
	writeFileSync(join(dir, "settings.json"), JSON.stringify({ wikiDbPath: path }), "utf8")
}

function makeCtx(cwd: string, complete?: ReturnType<typeof vi.fn>): ExtensionContext {
	return {
		cwd,
		model: complete ? { id: "test-model" } : undefined,
		modelRegistry: complete ? { complete } : undefined,
		ui: { notify: () => {}, setWidget: () => {} },
	} as unknown as ExtensionContext
}

beforeEach(() => {
	_resetWikiDbCache()
	clearWikiCache()
	tmpDir = join(tmpdir(), `wiki-ctx-${Date.now()}-${Math.random().toString(36).slice(2)}`)
	mkdirSync(tmpDir, { recursive: true })
	dbPath = join(tmpDir, "fixture.db")
	seedWikiFixture(dbPath)
})

afterEach(() => {
	_resetWikiDbCache()
	clearWikiCache()
	rmSync(tmpDir, { recursive: true, force: true })
	vi.restoreAllMocks()
})

describe("query derivation (pure)", () => {
	it("writerWikiQuery joins plan intent + POV", () => {
		const q = writerWikiQuery({
			plan: { objective: "Sara confronts the watcher", conflict: "watcher reveals the truth" },
			pov: "sara",
		})
		expect(q).toBe("Sara confronts the watcher watcher reveals the truth POV sara")
	})

	it("writerWikiQuery caps length and drops non-strings", () => {
		const q = writerWikiQuery({ plan: { objective: "x".repeat(500), conflict: 42 }, pov: null })
		expect(q.length).toBeLessThanOrEqual(300)
	})

	it("plannerWikiQuery joins existing objective + story lines + roster", () => {
		const q = plannerWikiQuery({
			activeStoryLines: ["sara-investigation", "the-watcher"],
			characterProfiles: { sara: "...", john: "...", miguel: "..." },
			existingPlan: { objective: "find the lighthouse key" },
		})
		expect(q).toContain("find the lighthouse key")
		expect(q).toContain("sara-investigation, the-watcher")
		expect(q).toContain("characters: sara, john, miguel")
	})

	it("criticWikiQuery includes template citations with how_used", () => {
		const q = criticWikiQuery({
			plan: {
				objective: "confrontation",
				template_refs: [{ table: "scene_templates", id: "st-001", how_used: "beat skeleton" }],
			},
			pov: "sara",
		})
		expect(q).toContain("scene_templates st-001 beat skeleton")
		expect(q).toContain("confrontation")
	})
})

describe("validateTemplateRefs (Q22)", () => {
	it("rejects an empty plan body with no refs and no exemption", () => {
		const check = validateTemplateRefs({ objective: "x" })
		expect(check.valid).toBe(false)
		expect(check.reason).toMatch(/template_refs/i)
	})

	it("accepts plan-level refs", () => {
		const check = validateTemplateRefs({
			template_refs: [{ table: "scene_templates", id: "st-001", how_used: "skeleton" }],
		})
		expect(check.valid).toBe(true)
	})

	it("accepts scene-level refs", () => {
		const check = validateTemplateRefs({
			scenes: [
				{
					id: "s1",
					template_refs: [{ table: "story_lines", id: "sl-001", how_used: "arc shape" }],
				},
			],
		})
		expect(check.valid).toBe(true)
	})

	it("rejects malformed refs (bad table, empty id, missing how_used)", () => {
		expect(
			validateTemplateRefs({
				template_refs: [{ table: "not_a_table", id: "1", how_used: "x" }],
			}).valid,
		).toBe(false)
		expect(
			validateTemplateRefs({
				template_refs: [{ table: "scene_templates", id: "", how_used: "x" }],
			}).valid,
		).toBe(false)
		expect(
			validateTemplateRefs({
				template_refs: [{ table: "scene_templates", id: "st-001" }],
			}).valid,
		).toBe(false)
	})

	it("exemption requires a rationale", () => {
		expect(validateTemplateRefs({ template_refs_exempt: true }).valid).toBe(false)
		expect(
			validateTemplateRefs({
				template_refs_exempt: true,
				template_refs_exempt_rationale: "dream-sequence chapter, no corpus match",
			}).valid,
		).toBe(true)
	})
})

describe("injectWikiReferences (Q21 + Q23)", () => {
	it("returns null + null for an empty derived query", async () => {
		const cwd = join(tmpDir, "repo-a")
		writeWikiSettings(cwd, dbPath)
		const injection = await injectWikiReferences(makeCtx(cwd), "   ", {
			tables: ["scene_templates"],
		})
		expect(injection.wikiReferences).toBeNull()
		expect(injection.wikiWarning).toBeNull()
	})

	it("degrades to null + localized warning when the wiki DB is missing", async () => {
		const cwd = join(tmpDir, "repo-b")
		writeWikiSettings(cwd, join(tmpDir, "missing.db"))
		const injection = await injectWikiReferences(makeCtx(cwd), "confrontation scene", {
			tables: ["scene_templates"],
			language: "zh",
		})
		expect(injection.wikiReferences).toBeNull()
		expect(injection.wikiWarning).toContain("维基参考不可用")
	})

	it("injects reranked references and warns nothing on success", async () => {
		const cwd = join(tmpDir, "repo-c")
		writeWikiSettings(cwd, dbPath)
		const complete = vi.fn().mockResolvedValue({
			content: [
				{
					type: "text",
					text: JSON.stringify({
						picks: [
							{ table: "scene_templates", id: "st-001", rationale: "exact confrontation match" },
						],
					}),
				},
			],
		})
		const injection = await injectWikiReferences(makeCtx(cwd, complete), "confrontation", {
			tables: ["scene_templates"],
			topN: 1,
		})
		expect(injection.wikiWarning).toBeNull()
		expect(injection.wikiReferences?.reranked).toBe(true)
		expect(injection.wikiReferences?.picks[0]?.id).toBe("st-001")
		expect(complete).toHaveBeenCalledTimes(1)
	})

	it("serves the second identical lookup from the session cache (no second LLM call)", async () => {
		const cwd = join(tmpDir, "repo-d")
		writeWikiSettings(cwd, dbPath)
		const complete = vi.fn().mockResolvedValue({
			content: [
				{
					type: "text",
					text: JSON.stringify({
						picks: [{ table: "scene_templates", id: "st-001", rationale: "cached match" }],
					}),
				},
			],
		})
		const ctx = makeCtx(cwd, complete)
		const first = await injectWikiReferences(ctx, "confrontation", {
			tables: ["scene_templates"],
			topN: 1,
		})
		const second = await injectWikiReferences(ctx, "confrontation", {
			tables: ["scene_templates"],
			topN: 1,
		})
		expect(complete).toHaveBeenCalledTimes(1)
		expect(second.wikiReferences?.picks[0]?.id).toBe(first.wikiReferences?.picks[0]?.id)
	})

	it("never throws when searchWiki fails (e.g. no model bound for rerank)", async () => {
		const cwd = join(tmpDir, "repo-e")
		writeWikiSettings(cwd, dbPath)
		// model undefined + rerank needed → searchWiki throws inside → degraded
		const injection = await injectWikiReferences(makeCtx(cwd), "confrontation", {
			tables: ["scene_templates"],
			topN: 1,
		})
		expect(injection.wikiReferences).toBeNull()
		expect(injection.wikiWarning).toContain("wiki references unavailable")
	})
})

describe("rerank budget", () => {
	it("caps consumption at the assembly limit", () => {
		const budget = createRerankBudget(2)
		expect(budget.tryConsume()).toBe(true)
		expect(budget.tryConsume()).toBe(true)
		expect(budget.tryConsume()).toBe(false)
		expect(budget.remaining()).toBe(0)
	})
})

describe("requires_state: chapters.plan_template_refs (Q22 gate)", () => {
	function writeChapter(repo: string, file: string, frontmatter: string): void {
		const chapters = join(repo, "chapters")
		mkdirSync(chapters, { recursive: true })
		writeFileSync(join(chapters, file), `---\n${frontmatter}\n---\n\nBody.`, "utf8")
	}

	it("is satisfied when the writable chapter has no plan yet", () => {
		const repo = join(tmpDir, "novel-a")
		writeChapter(repo, "0001.md", "chapter: 1\nstatus: planned")
		const report = checkRequiresState(repo, ["chapters.plan_template_refs"])
		expect(report.satisfied).toBe(true)
	})

	it("fails when the plan cites no refs and no exemption", () => {
		const repo = join(tmpDir, "novel-b")
		writeChapter(
			repo,
			"0001.md",
			'chapter: 1\nstatus: planned\nplan: {"objective": "confrontation"}',
		)
		const report = checkRequiresState(repo, ["chapters.plan_template_refs"])
		expect(report.satisfied).toBe(false)
		expect(report.failed[0]?.reason).toMatch(/template_refs/)
	})

	it("passes when the plan cites refs or exempts explicitly", () => {
		const repo = join(tmpDir, "novel-c")
		writeChapter(
			repo,
			"0001.md",
			'chapter: 1\nstatus: planned\nplan: {"objective": "x", "template_refs": [{"table": "scene_templates", "id": "st-001", "how_used": "skeleton"}]}',
		)
		expect(checkRequiresState(repo, ["chapters.plan_template_refs"]).satisfied).toBe(true)

		const repoExempt = join(tmpDir, "novel-d")
		writeChapter(
			repoExempt,
			"0001.md",
			'chapter: 1\nstatus: planned\nplan: {"template_refs_exempt": true, "template_refs_exempt_rationale": "none fit"}',
		)
		expect(checkRequiresState(repoExempt, ["chapters.plan_template_refs"]).satisfied).toBe(true)
	})
})

describe("critic pattern_ref (ADR-0008 §4)", () => {
	it("keeps a well-formed pattern_ref and drops a malformed one", async () => {
		const pi = makeFakePi()
		registerCriticAgent(pi)
		const chapterPath = join(tmpDir, "0001.md")
		mkdirSync(tmpDir, { recursive: true })
		writeFileSync(
			chapterPath,
			`---\nchapter: 1\nstatus: drafted\n---\n\n@scene id=x pov=sara\n\nBody.`,
			"utf8",
		)
		writeWikiSettings(tmpDir, join(tmpDir, "no-wiki.db"))

		const reviewYaml = `
summary: mixed
issues:
  - category: pacing
    severity: medium
    evidence: turn lands too late
    impact: urgency leaks
    recommendation: move the turn earlier
    pattern_ref: { table: writing_patterns, id: wp-001 }
  - category: prose
    severity: low
    evidence: clunky sentence
    impact: minor
    recommendation: rewrite
    pattern_ref: { table: bogus_table, id: "9" }
`
		const complete = vi.fn().mockResolvedValue({
			content: [{ type: "text", text: `\`\`\`yaml\n${reviewYaml}\n\`\`\`` }],
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
			details: { review: { issues: Array<{ pattern_ref?: { table: string; id: string } }> } }
		}

		const issues = result.details.review.issues
		expect(issues).toHaveLength(2)
		expect(issues[0]?.pattern_ref).toEqual({ table: "writing_patterns", id: "wp-001" })
		expect(issues[1]?.pattern_ref).toBeUndefined()
	})
})
