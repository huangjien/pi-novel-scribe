/**
 * Multilingual support — public surface. Per ADR-0007 §5.
 *
 * Single entry point for the rest of the extension. Tool wrappers,
 * agents, and commands call `toolStrings(lang, name)` etc. instead of
 * inlining English text.
 */

import type { WorkflowStatus } from "../workflow/status.ts"
import type { Language } from "./language.ts"
import {
	ERROR_MESSAGES_EN,
	ERROR_MESSAGES_ZH,
	HELP_TEXT_EN,
	HELP_TEXT_ZH,
	STATUS_DISPLAY_EN,
	STATUS_DISPLAY_ZH,
	TOOL_STRINGS_EN,
	TOOL_STRINGS_ZH,
	type ToolStrings,
} from "./strings/index.ts"

export { detectFromBody, detectLanguage } from "./detect.ts"
export type { Language, ToolStrings } from "./language.ts"
export {
	asLanguage,
	DEFAULT_LANGUAGE,
	displayName,
	isLanguage,
	LANGUAGES,
	normalizeLanguage,
} from "./language.ts"
export { readChapterFrontmatterLite, readLanguageSetting, resolveLanguage } from "./resolve.ts"

interface ErrorKeyTable {
	wiki_no_model: string
	wiki_db_missing: (path: string) => string
	editor_no_model: (agent: string) => string
	editor_chapter_approved: (agent: string, status: string) => string
	editor_no_prose: (agent: string) => string
	editor_no_yaml_plan: (agent: string) => string
	editor_no_yaml_review: (agent: string) => string
	route_no_match: (input: string) => string
}

interface StringTables {
	readonly strings: Readonly<Record<string, ToolStrings>>
	readonly statusDisplay: Readonly<Record<WorkflowStatus, string>>
	readonly helpText: string
	readonly errors: ErrorKeyTable
}

const EN: StringTables = {
	strings: TOOL_STRINGS_EN,
	statusDisplay: STATUS_DISPLAY_EN,
	helpText: HELP_TEXT_EN,
	errors: ERROR_MESSAGES_EN,
}

const ZH: StringTables = {
	strings: TOOL_STRINGS_ZH,
	statusDisplay: STATUS_DISPLAY_ZH,
	helpText: HELP_TEXT_ZH,
	errors: ERROR_MESSAGES_ZH,
}

const TABLES: Readonly<Record<Language, StringTables>> = { en: EN, zh: ZH }

/**
 * Author-facing strings for a tool, in the resolved language.
 * Falls back to English if the tool has no localized entry.
 */
export function toolStrings(lang: Language, toolName: string): ToolStrings {
	const table = TABLES[lang].strings[toolName]
	if (table) return table
	if (lang !== "en") return toolStrings("en", toolName)
	return {
		label: toolName,
		description: toolName,
		promptSnippet: toolName,
		promptGuidelines: [],
	}
}

/** Localized display name for a workflow status enum value. */
export function statusDisplay(lang: Language, status: WorkflowStatus): string {
	return TABLES[lang].statusDisplay[status] ?? status
}

/** Help text shown by `/novel help` — localized. */
export function helpText(lang: Language): string {
	return TABLES[lang].helpText
}

/**
 * Render a localized error message. `key` is one of the keys in
 * `ErrorKeyTable`. If the key's entry is a function, call it with
 * `vars`; otherwise return it as-is.
 */
export function errorMessage(lang: Language, key: keyof ErrorKeyTable, vars?: unknown): string {
	const entry = TABLES[lang].errors[key]
	if (typeof entry === "function") {
		return (entry as (v: unknown) => string)(vars)
	}
	return entry
}

/**
 * Convenience: render a localized error message and throw it as a
 * `new Error(...)`. Keeps call sites concise.
 */
export function localizedError(lang: Language, key: keyof ErrorKeyTable, vars?: unknown): never {
	throw new Error(errorMessage(lang, key, vars))
}
