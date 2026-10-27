/**
 * Structural invariants for agent prompt files (ADR-0013 / Phase 15).
 *
 * The wst corpus template (identity → critical constraints → core
 * objective → procedure → output schema) is enforced here: every prompt
 * file — 5 agents × {en, zh} — must carry the four load-bearing
 * sections and stay within token-bounded lengths. If a future edit
 * drops a section, this test fails.
 */

import { readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it, vi } from "vitest"
import { hasLocalizedPrompt, loadAgentPrompt } from "../extensions/i18n/prompts.ts"

/** Mirrors AGENT_NAMES in extensions/i18n/prompts.ts (not exported there). */
const AGENTS = ["director", "planner", "writer", "critic", "continuity"] as const

/**
 * Gate flags for the fs mock below — let tests hide the zh (or non-zh)
 * prompt files from `existsSync` to exercise the loader's English
 * fallback and its not-found error path.
 */
const fsGate = vi.hoisted(() => ({ hideZh: false, hideEn: false }))

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>()
	return {
		...actual,
		existsSync(p: Parameters<typeof actual.existsSync>[0]) {
			if (typeof p === "string" && p.endsWith(".md")) {
				const inZh = p.includes("/zh/") || p.includes("\\zh\\")
				if (fsGate.hideZh && inZh) return false
				if (fsGate.hideEn && !inZh) return false
			}
			return actual.existsSync(p)
		},
	}
})

const PROMPTS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "prompts")

/** Per-language required `##` section headings (ADR-0013 §5 step 5). */
const REQUIRED_SECTIONS = {
	en: ["## Identity", "## Critical Constraints", "## Procedure", "## Output Schema"],
	zh: ["## 身份", "## 硬约束", "## 流程", "## 输出模式"],
} as const

/** Length bounds: non-trivial content, bounded token cost. */
const MIN_CHARS = 800
const MAX_CHARS = 12000

describe("prompt structural invariants (ADR-0013)", () => {
	it("all 10 prompt files carry the required sections within length bounds", () => {
		for (const agent of AGENTS) {
			for (const lang of ["en", "zh"] as const) {
				const rel = lang === "zh" ? join("zh", `${agent}.md`) : join(`${agent}.md`)
				const raw = readFileSync(join(PROMPTS_ROOT, rel), "utf8")

				// Frontmatter intact: the loader returns the whole file, so the
				// agent header must survive edits.
				expect(raw.startsWith("---\n"), `${rel}: frontmatter`).toBe(true)
				expect(raw.startsWith(`---\nagent: ${agent}\n`), `${rel}: agent field`).toBe(true)

				const loaded = loadAgentPrompt(agent, lang)
				expect(loaded, `${rel}: loader round-trip`).toBe(raw)

				for (const section of REQUIRED_SECTIONS[lang]) {
					expect(loaded.includes(section), `${rel}: missing section "${section}"`).toBe(true)
				}

				expect(
					loaded.length,
					`${rel}: length ${loaded.length} outside [${MIN_CHARS}, ${MAX_CHARS}]`,
				).toBeGreaterThanOrEqual(MIN_CHARS)
				expect(loaded.length).toBeLessThanOrEqual(MAX_CHARS)
			}
		}
	})
})

describe("loadAgentPrompt contract (ADR-0007 override chain)", () => {
	afterEach(() => {
		fsGate.hideZh = false
		fsGate.hideEn = false
	})

	it("returns the zh file bytes when the localized file exists", () => {
		const zh = readFileSync(join(PROMPTS_ROOT, "zh", "writer.md"), "utf8")
		expect(loadAgentPrompt("writer", "zh")).toBe(zh)
		expect(zh).not.toBe(readFileSync(join(PROMPTS_ROOT, "writer.md"), "utf8"))
	})

	it("hasLocalizedPrompt is true for every agent in both languages", () => {
		for (const agent of AGENTS) {
			expect(hasLocalizedPrompt(agent, "en")).toBe(true)
			expect(hasLocalizedPrompt(agent, "zh")).toBe(true)
		}
	})

	it("falls back to the English file when the zh file is missing", () => {
		fsGate.hideZh = true
		const en = readFileSync(join(PROMPTS_ROOT, "writer.md"), "utf8")
		expect(loadAgentPrompt("writer", "zh")).toBe(en)
	})

	it("throws when neither the localized nor the English file exists", () => {
		fsGate.hideZh = true
		fsGate.hideEn = true
		expect(() => loadAgentPrompt("writer", "zh")).toThrow(/agent prompt not found/)
	})
})
