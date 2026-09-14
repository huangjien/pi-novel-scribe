/**
 * Multilingual support — language resolution chain. Per ADR-0007 §3.
 *
 * Order of precedence (first wins):
 *   1. `flag` (per-command override, e.g., `/novel write --lang=zh`)
 *   2. Chapter frontmatter `language:` field
 *   3. `.pi/settings.json` `language:` field
 *   4. Auto-detect from chapter body (CJK ratio > 30%)
 *   5. Final fallback: `en`
 */

import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import type { ExtensionContext } from "@earendil-works/pi-coding-agent"
import { detectFromBody } from "./detect.ts"
import { DEFAULT_LANGUAGE, isLanguage, type Language } from "./language.ts"

export interface ResolveLanguageOptions {
	readonly flag?: Language
	readonly chapterPath?: string
	/** Override the cwd used for settings.json + chapter lookup. */
	readonly cwd?: string
}

/**
 * Read `.pi/settings.json` and return the declared `language`, if any.
 * Walks up to 5 ancestor directories looking for the file.
 */
export function readLanguageSetting(startDir: string): Language | null {
	const candidates: string[] = []
	let dir = resolve(startDir)
	for (let i = 0; i < 5; i++) {
		candidates.push(join(dir, ".pi", "settings.json"))
		candidates.push(join(dir, "settings.json"))
		const parent = dirname(dir)
		if (parent === dir) break
		dir = parent
	}
	for (const path of candidates) {
		if (!existsSync(path)) continue
		try {
			const raw = readFileSync(path, "utf8")
			const parsed: unknown = JSON.parse(raw)
			if (typeof parsed !== "object" || parsed === null) continue
			const obj = parsed as { language?: unknown }
			if (isLanguage(obj.language)) return obj.language
		} catch {}
	}
	return null
}

/** Minimal chapter-frontmatter parser — pure; no LLM, no DB. */
export interface ChapterFrontmatterLite {
	readonly language?: unknown
	readonly [key: string]: unknown
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?([\s\S]*)$/

export function readChapterFrontmatterLite(path: string): {
	frontmatter: ChapterFrontmatterLite
	body: string
} {
	try {
		const raw = readFileSync(path, "utf8")
		const m = FRONTMATTER_RE.exec(raw)
		if (!m || m[1] === undefined || m[2] === undefined) {
			return { frontmatter: {}, body: raw }
		}
		// Quote-stripping parser for the `language:` line only — avoids
		// pulling js-yaml into a parse that's just looking for one key.
		const frontmatter: Record<string, unknown> = {}
		for (const line of m[1].split(/\r?\n/)) {
			const colonAt = line.indexOf(":")
			if (colonAt === -1) continue
			const key = line.slice(0, colonAt).trim()
			const value = line
				.slice(colonAt + 1)
				.trim()
				.replace(/^["']|["']$/g, "")
			if (key) frontmatter[key] = value
		}
		return { frontmatter, body: m[2] }
	} catch {
		return { frontmatter: {}, body: "" }
	}
}

/**
 * Resolve the working language for a session/tool call. Pure given the
 * options + filesystem reads; does not depend on pi context state.
 */
export function resolveLanguage(
	ctx: ExtensionContext | { cwd: string },
	options: ResolveLanguageOptions = {},
): Language {
	// 1. Per-command flag — always wins.
	if (options.flag) return options.flag

	const cwd = options.cwd ?? ctx.cwd

	// 2. Per-chapter frontmatter override.
	if (options.chapterPath) {
		const fm = readChapterFrontmatterLite(options.chapterPath)
		if (isLanguage(fm.frontmatter.language)) return fm.frontmatter.language
	}

	// 3. Settings.json (project default).
	const fromSettings = readLanguageSetting(cwd)
	if (fromSettings) return fromSettings

	// 4. Auto-detect from chapter body.
	if (options.chapterPath) {
		const fm = readChapterFrontmatterLite(options.chapterPath)
		const detected = detectFromBody(fm.body)
		if (detected) return detected
	}

	// 5. Final fallback.
	return DEFAULT_LANGUAGE
}
