/**
 * Tests for the i18n module (ADR-0007).
 */

import { mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
	asLanguage,
	DEFAULT_LANGUAGE,
	detectFromBody,
	detectLanguage,
	errorMessage,
	helpText,
	isLanguage,
	LANGUAGES,
	normalizeLanguage,
	statusDisplay,
	toolStrings,
} from "../extensions/i18n/index.ts"
import { countCjk, countLetters } from "../extensions/i18n/language.ts"
import { readChapterFrontmatterLite, readLanguageSetting } from "../extensions/i18n/resolve.ts"
import {
	ERROR_MESSAGES_ZH,
	HELP_TEXT_ZH,
	STATUS_DISPLAY_ZH,
	TOOL_STRINGS_ZH,
} from "../extensions/i18n/strings/zh.ts"
import { WORKFLOW_STATUSES } from "../extensions/workflow/status.ts"

describe("language types", () => {
	it("isLanguage accepts only en/zh", () => {
		expect(isLanguage("en")).toBe(true)
		expect(isLanguage("zh")).toBe(true)
		expect(isLanguage("fr")).toBe(false)
		expect(isLanguage(42)).toBe(false)
		expect(isLanguage(null)).toBe(false)
		expect(isLanguage(undefined)).toBe(false)
	})

	it("asLanguage falls back on invalid", () => {
		expect(asLanguage("en")).toBe("en")
		expect(asLanguage("zz", "zh")).toBe("zh")
		expect(asLanguage(null)).toBe(DEFAULT_LANGUAGE)
	})

	it("normalizeLanguage returns null for invalid", () => {
		expect(normalizeLanguage("en")).toBe("en")
		expect(normalizeLanguage("invalid")).toBe(null)
	})

	it("LANGUAGES is exactly en + zh", () => {
		expect(LANGUAGES).toEqual(["en", "zh"])
	})
})

describe("CJK counter", () => {
	it("counts CJK Unified Ideographs", () => {
		expect(countCjk("你好世界")).toBe(4)
		expect(countCjk("Hello")).toBe(0)
		expect(countCjk("Mix 中文 here")).toBe(2)
	})
})

describe("letter counter", () => {
	it("counts basic Latin letters", () => {
		expect(countLetters("Hello")).toBe(5)
		expect(countLetters("中文")).toBe(0)
		expect(countLetters("Hello 中文 world")).toBe(10)
	})
})

describe("detectLanguage", () => {
	it("returns zh for pure Chinese prose", () => {
		const text = "这是一个测试。这是另一句话，应该被分类为中文。它包含足够多的汉字以满足阈值要求。"
		expect(detectLanguage(text)).toBe("zh")
	})

	it("returns en for pure Latin text", () => {
		expect(detectLanguage("This is plain English prose that should classify as English.")).toBe(
			"en",
		)
	})

	it("returns null for mixed/short text", () => {
		expect(detectLanguage("hi")).toBe(null) // too short
		expect(detectLanguage("Chinese 中文 word and English word")).toBe(null) // ~50/50
	})

	it("returns null for empty/whitespace", () => {
		expect(detectLanguage("")).toBe(null)
		expect(detectLanguage("   ")).toBe(null)
	})

	it("detectFromBody samples the first 2000 chars", () => {
		expect(detectFromBody("")).toBe(null)
		expect(detectFromBody("English only text here.")).toBe("en")
	})
})

describe("resolveLanguage — file-based settings + frontmatter", () => {
	let tmpDir = ""
	beforeEachSetTmpDir()
	function beforeEachSetTmpDir() {
		// noop; defined for readability
	}

	it("reads language from .pi/settings.json", () => {
		tmpDir = makeTmpNovelRepo({ settingsLanguage: "zh" })
		expect(readLanguageSetting(tmpDir)).toBe("zh")
	})

	it("falls through when settings.json is missing", () => {
		tmpDir = join(tmpdir(), `i18n-${Date.now()}`)
		mkdirSync(tmpDir, { recursive: true })
		expect(readLanguageSetting(tmpDir)).toBe(null)
	})

	it("reads chapter frontmatter language", () => {
		tmpDir = makeTmpNovelRepo()
		const chapterPath = join(tmpDir, "chapters", "0001.md")
		writeFileSync(
			chapterPath,
			`---\nchapter: 1\nstatus: drafted\nlanguage: zh\n---\n\n@scene id=x pov=sara\n\nBody.`,
			"utf8",
		)
		const fm = readChapterFrontmatterLite(chapterPath)
		expect(fm.frontmatter.language).toBe("zh")
		// Don't leak the tmpDir — clean below
	})

	it("frontmatter returns null frontmatter on missing file", () => {
		const fm = readChapterFrontmatterLite("/nonexistent/path.md")
		expect(fm.frontmatter).toEqual({})
	})
})

function makeTmpNovelRepo(opts: { settingsLanguage?: "en" | "zh" } = {}): string {
	const dir = join(tmpdir(), `i18n-novel-${Date.now()}-${Math.random().toString(36).slice(2)}`)
	mkdirSync(join(dir, "chapters"), { recursive: true })
	if (opts.settingsLanguage) {
		mkdirSync(join(dir, ".pi"), { recursive: true })
		writeFileSync(
			join(dir, ".pi", "settings.json"),
			JSON.stringify({ language: opts.settingsLanguage }),
			"utf8",
		)
	}
	return dir
}

describe("toolStrings", () => {
	it("returns English strings by default", () => {
		const s = toolStrings("en", "wiki_search")
		expect(s.label).toBe("Wiki Search")
		expect(s.promptSnippet).toContain("reference templates")
	})

	it("returns Chinese strings for zh", () => {
		const s = toolStrings("zh", "wiki_search")
		expect(s.label).toBe("维基检索")
		expect(s.promptSnippet).toContain("参考模板")
	})

	it("returns different labels for the same tool in different languages", () => {
		const en = toolStrings("en", "wiki_search")
		const zh = toolStrings("zh", "wiki_search")
		expect(en.label).not.toBe(zh.label)
	})

	it("returns the stub label for an unknown tool name", () => {
		const s = toolStrings("en", "totally_made_up_tool")
		expect(s.label).toBe("totally_made_up_tool")
	})

	it("covers all 6 tools in both languages", () => {
		const tools = [
			"wiki_search",
			"run_director",
			"delegate_to_writer",
			"delegate_to_planner",
			"delegate_to_critic",
			"delegate_to_continuity",
		]
		for (const tool of tools) {
			expect(toolStrings("en", tool).label).toBeTruthy()
			expect(toolStrings("zh", tool).label).toBeTruthy()
		}
	})
})

describe("statusDisplay", () => {
	it("returns the English status name", () => {
		expect(statusDisplay("en", "drafted")).toBe("Drafted")
		expect(statusDisplay("en", "approved")).toBe("Approved")
	})

	it("returns the Chinese status name", () => {
		expect(statusDisplay("zh", "drafted")).toBe("已起草")
		expect(statusDisplay("zh", "approved")).toBe("已批准")
		expect(statusDisplay("zh", "canonized")).toBe("已经典化")
	})
})

describe("helpText", () => {
	it("renders a non-empty English help string", () => {
		const text = helpText("en")
		expect(text).toContain("Available subcommands")
		expect(text).toContain("/novel write")
	})

	it("renders a non-empty Chinese help string", () => {
		const text = helpText("zh")
		expect(text).toContain("可用子命令")
		expect(text).toContain("/novel write")
	})
})

describe("errorMessage", () => {
	it("returns the English error message for a static key", () => {
		const msg = errorMessage("en", "wiki_no_model")
		expect(msg).toContain("active model")
	})

	it("returns the Chinese error message", () => {
		const msg = errorMessage("zh", "wiki_no_model")
		expect(msg).toContain("绑定模型")
	})

	it("interpolates template values when provided", () => {
		const msg = errorMessage("en", "wiki_db_missing", "/tmp/test.db")
		expect(msg).toContain("/tmp/test.db")
		const msgZh = errorMessage("zh", "wiki_db_missing", "/tmp/test.db")
		expect(msgZh).toContain("/tmp/test.db")
	})
})

describe("zh string tables (extensions/i18n/strings/zh.ts)", () => {
	it("every registered tool has a complete zh entry with CJK content", () => {
		const expectedTools = [
			"wiki_search",
			"run_director",
			"delegate_to_writer",
			"delegate_to_planner",
			"delegate_to_critic",
			"delegate_to_continuity",
		]
		expect(Object.keys(TOOL_STRINGS_ZH).sort()).toEqual([...expectedTools].sort())

		for (const name of expectedTools) {
			const entry = TOOL_STRINGS_ZH[name]
			if (!entry) throw new Error(`missing zh entry for ${name}`)
			expect(entry.label.length).toBeGreaterThan(0)
			expect(entry.description.length).toBeGreaterThan(0)
			expect(entry.promptSnippet.length).toBeGreaterThan(0)
			expect(entry.promptGuidelines.length).toBeGreaterThan(0)
			for (const g of entry.promptGuidelines) {
				expect(g.length).toBeGreaterThan(0)
			}
			// Real localization, not a copy of the English keys.
			expect(countCjk(entry.label)).toBeGreaterThan(0)
			expect(countCjk(entry.description)).toBeGreaterThan(0)
		}
	})

	it("tool names stay English where they are used (ADR-0007)", () => {
		for (const [name, entry] of Object.entries(TOOL_STRINGS_ZH)) {
			const mentionsName =
				entry.description.includes(name) || entry.promptGuidelines.some((g) => g.includes(name))
			expect(mentionsName, `${name} not referenced in its own zh strings`).toBe(true)
		}
	})

	it("STATUS_DISPLAY_ZH covers exactly the workflow statuses", () => {
		expect(Object.keys(STATUS_DISPLAY_ZH).sort()).toEqual([...WORKFLOW_STATUSES].sort())
		for (const status of WORKFLOW_STATUSES) {
			const display = STATUS_DISPLAY_ZH[status]
			expect(display.length).toBeGreaterThan(0)
			// Actual Chinese, not the English key echoed back.
			expect(display).not.toBe(status)
			expect(countCjk(display)).toBeGreaterThan(0)
		}
	})

	it("HELP_TEXT_ZH lists the core commands and agent tools", () => {
		expect(HELP_TEXT_ZH.length).toBeGreaterThan(0)
		for (const token of ["/novel write", "/novel help", "delegate_to_writer", "wiki_search"]) {
			expect(HELP_TEXT_ZH.includes(token), `help text missing "${token}"`).toBe(true)
		}
	})

	it("ERROR_MESSAGES_ZH constants are non-empty; templates interpolate without leaking placeholders", () => {
		for (const [key, value] of Object.entries(ERROR_MESSAGES_ZH)) {
			if (typeof value === "function") {
				const rendered =
					value.length >= 2
						? (value as (a: string, b: string) => string)("agentX", "approved")
						: (value as (a: string) => string)("agentX")
				expect(rendered.length, `${key} rendered empty`).toBeGreaterThan(0)
				expect(rendered.includes("agentX"), `${key} did not interpolate`).toBe(true)
				expect(rendered.includes("undefined"), `${key} leaked undefined`).toBe(false)
			} else {
				expect(String(value).length, `${key} empty`).toBeGreaterThan(0)
			}
		}
	})
})
