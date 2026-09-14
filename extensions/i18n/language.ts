/**
 * Multilingual support — language types + validation + CJK helpers.
 * Per ADR-0007 §2: hardcoded `"en" | "zh"`. Anything else throws.
 */

export const LANGUAGES = ["en", "zh"] as const
export type Language = (typeof LANGUAGES)[number]

/** Default when nothing in the override chain is set. */
export const DEFAULT_LANGUAGE: Language = "en"

export function isLanguage(value: unknown): value is Language {
	return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value)
}

export function asLanguage(value: unknown, fallback: Language = DEFAULT_LANGUAGE): Language {
	return isLanguage(value) ? value : fallback
}

export function normalizeLanguage(value: unknown): Language | null {
	return isLanguage(value) ? value : null
}

/**
 * Count CJK Unified Ideographs (CJK Unified + Extension A).
 * Returns the count of code points in the basic CJK + CJK Extension A blocks.
 * Tolerant of mixed text (counts only CJK, leaves the rest alone).
 */
export function countCjk(text: string): number {
	let count = 0
	for (const ch of text) {
		const code = ch.codePointAt(0)
		if (code === undefined) continue
		if ((code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf)) {
			count++
		}
	}
	return count
}

/** Count Unicode letters (any script). Used as the "non-CJK" denominator. */
export function countLetters(text: string): number {
	let count = 0
	for (const ch of text) {
		const code = ch.codePointAt(0)
		if (code === undefined) continue
		if (isCjkCodePoint(code)) continue
		if (isLatinBasic(code) || isOtherLetterScript(code)) count++
	}
	return count
}

function isLatinBasic(code: number): boolean {
	return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)
}

function isOtherLetterScript(code: number): boolean {
	return (
		(code >= 0xc0 && code <= 0x024f) ||
		(code >= 0x0400 && code <= 0x04ff) ||
		(code >= 0x0370 && code <= 0x03ff) ||
		(code >= 0x3040 && code <= 0x309f) ||
		(code >= 0x30a0 && code <= 0x30ff) ||
		(code >= 0xac00 && code <= 0xd7af)
	)
}

function isCjkCodePoint(code: number): boolean {
	return (code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf)
}

/** Human-readable name of the language, in English. Used for diagnostics. */
export function displayName(lang: Language): string {
	return lang === "zh" ? "Chinese" : "English"
}

// Re-export ToolStrings here so callers can `import type { ToolStrings } from
// "../i18n/index.ts"` without dipping into the strings subdirectory.
export type { ToolStrings } from "./strings/en.ts"
