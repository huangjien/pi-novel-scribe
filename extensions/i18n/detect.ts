/**
 * Multilingual support — language detection from prose content.
 * Per ADR-0007 §9. CJK-vs-letters ratio heuristic.
 */

import { countCjk, countLetters, DEFAULT_LANGUAGE, type Language } from "./language.ts"

/** Threshold above which prose is classified as Chinese. */
const CJK_THRESHOLD = 0.3

/**
 * Detect the working language of a chunk of text.
 * Returns `null` when the text is too short or too mixed to decide;
 * the caller should then fall through to the next override in the
 * chain.
 */
export function detectLanguage(text: string): Language | null {
	const trimmed = text.trim()
	if (trimmed.length < 10) return null

	const cjk = countCjk(trimmed)
	const letters = countLetters(trimmed)
	const total = cjk + letters
	if (total === 0) return null

	const ratio = cjk / total
	if (ratio > CJK_THRESHOLD) return "zh"
	if (ratio > 0) return null // mixed — caller decides
	return DEFAULT_LANGUAGE
}

/**
 * Auto-detect from a chapter file. Reads the frontmatter `language` if
 * present, otherwise samples the body. Returns `null` if no signal.
 */
export function detectFromBody(body: string): Language | null {
	if (body.trim().length === 0) return null
	return detectLanguage(body.slice(0, 2000))
}
