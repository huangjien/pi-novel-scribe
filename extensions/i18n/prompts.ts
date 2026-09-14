/**
 * Multilingual support — per-language agent prompt loader. Per ADR-0007 §6.
 *
 * Layout:
 *   prompts/<agent>.md           # English (canonical fallback)
 *   prompts/zh/<agent>.md       # Simplified Chinese
 *
 * The loader reads `prompts/<lang>/<agent>.md` first; if missing, falls
 * back to the English file. Never silently returns empty content.
 */

import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { DEFAULT_LANGUAGE, type Language } from "./language.ts"

const PROMPTS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "prompts")

const AGENT_NAMES = ["director", "planner", "writer", "critic", "continuity"] as const
export type AgentName = (typeof AGENT_NAMES)[number]

/**
 * Load the prompt body for an agent in the requested language.
 * Falls back to English if the localized file is missing.
 */
export function loadAgentPrompt(agent: AgentName, lang: Language): string {
	const primary = join(PROMPTS_ROOT, langDir(lang), `${agent}.md`)
	if (existsSync(primary)) {
		return readFileSync(primary, "utf8")
	}
	if (lang !== DEFAULT_LANGUAGE) {
		const fallback = join(PROMPTS_ROOT, langDir(DEFAULT_LANGUAGE), `${agent}.md`)
		if (existsSync(fallback)) {
			return readFileSync(fallback, "utf8")
		}
	}
	throw new Error(
		`i18n: agent prompt not found: agent=${agent} lang=${lang} (root=${PROMPTS_ROOT})`,
	)
}

function langDir(lang: Language): string {
	return lang === "zh" ? "zh" : ""
}

/** Returns true if a localized prompt file exists for the given agent + lang. */
export function hasLocalizedPrompt(agent: AgentName, lang: Language): boolean {
	if (lang === DEFAULT_LANGUAGE) return true
	return existsSync(join(PROMPTS_ROOT, langDir(lang), `${agent}.md`))
}
