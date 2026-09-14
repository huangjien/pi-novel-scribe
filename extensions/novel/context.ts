/**
 * Scene context packet composer. Per Q7 — the Writer (and Critic /
 * Continuity) consume a deterministic, programmatically-built
 * `scene-context.yaml`-equivalent so the LLM sees the same material
 * every time. Composition is pure reads, no LLM judgment.
 *
 * Phase 3 is intentionally minimal: just the chapter frontmatter +
 * the POV character's profile. Phase 5 (Novel State) widens this to
 * include character beliefs, story lines, foreshadowing, etc.
 *
 * Implementation note: the chapter frontmatter may contain nested
 * YAML (e.g., a `plan:` block with sub-keys). The simple chapter
 * frontmatter parser in `workflow/status.ts` flattens those. For Phase
 * 3+ we use `js-yaml` here to preserve nesting.
 */

import { existsSync, readFileSync } from "node:fs"
import { isAbsolute, join } from "node:path"
import * as yaml from "js-yaml"
import { resolveNovelRepo } from "../state/path-resolver.ts"

export interface SceneContext {
	readonly novelRepo: string
	readonly chapterPath: string
	readonly chapterNumber: number | null
	readonly status: string | null
	readonly plan: Record<string, unknown>
	readonly pov: string | null
	readonly characterProfile: string | null
	readonly wordCountBefore: number
}

export interface ComposeContextOptions {
	readonly chapterPath: string
	readonly novelRepo?: string
	readonly cwd: string
	readonly fsAdapter?: FsAdapter
}

export interface FsAdapter {
	existsSync: (path: string) => boolean
	readFileSync: (path: string, encoding: "utf8") => string
}

const defaultFs: FsAdapter = { existsSync, readFileSync }

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?([\s\S]*)$/

export function composeSceneContext(options: ComposeContextOptions): SceneContext {
	const fs = options.fsAdapter ?? defaultFs
	const novelRepo = options.novelRepo ?? resolveNovelRepo(options.cwd).path
	const chapterPath = isAbsolute(options.chapterPath)
		? options.chapterPath
		: join(novelRepo, "chapters", options.chapterPath)

	if (!fs.existsSync(chapterPath)) {
		throw new Error(`composeSceneContext: chapter file not found: ${chapterPath}`)
	}
	const raw = fs.readFileSync(chapterPath, "utf8")
	const { frontmatter, body } = parseYamlFrontmatter(raw)

	const pov = extractPov(body, frontmatter)
	const plan = extractPlan(frontmatter)
	const profilePath = pov ? join(novelRepo, "characters", pov, "profile.yaml") : null
	const characterProfile =
		profilePath && fs.existsSync(profilePath) ? fs.readFileSync(profilePath, "utf8") : null

	const trimmedBody = body.trim()
	const wordCountBefore = trimmedBody.length === 0 ? 0 : trimmedBody.split(/\s+/).length

	return {
		novelRepo,
		chapterPath,
		chapterNumber: typeof frontmatter.chapter === "number" ? (frontmatter.chapter as number) : null,
		status: typeof frontmatter.status === "string" ? (frontmatter.status as string) : null,
		plan,
		pov,
		characterProfile,
		wordCountBefore,
	}
}

/**
 * YAML-frontmatter-aware parser. Uses js-yaml so nested blocks
 * (e.g., `plan:` with sub-keys) survive intact. Returns `{ frontmatter,
 * body }` like parseFrontmatter, but frontmatter is a parsed JS object.
 */
function parseYamlFrontmatter(content: string): {
	frontmatter: Record<string, unknown>
	body: string
} {
	const match = FRONTMATTER_RE.exec(content)
	if (!match || match[1] === undefined || match[2] === undefined) {
		return { frontmatter: {}, body: content }
	}
	let parsed: unknown
	try {
		parsed = yaml.load(match[1])
	} catch (err) {
		throw new Error(`Frontmatter YAML parse error: ${(err as Error).message}`)
	}
	if (typeof parsed !== "object" || parsed === null) {
		return { frontmatter: {}, body: match[2] }
	}
	return { frontmatter: parsed as Record<string, unknown>, body: match[2] }
}

function extractPov(body: string, frontmatter: Record<string, unknown>): string | null {
	const match = /@scene\b[\s\S]*?\bpov\s*[:=]([-a-zA-Z0-9_]+)/.exec(body)
	if (match?.[1]) return match[1]
	const fallback = frontmatter.pov
	if (typeof fallback === "string") return fallback
	return null
}

function extractPlan(frontmatter: Record<string, unknown>): Record<string, unknown> {
	if (typeof frontmatter.plan === "object" && frontmatter.plan !== null) {
		return frontmatter.plan as Record<string, unknown>
	}
	const plan: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(frontmatter)) {
		if (key === "status" || key === "title" || key === "chapter" || key === "pov") continue
		plan[key] = value
	}
	return plan
}

export function isDraftable(status: string | null): boolean {
	if (status === null) return true
	return status !== "approved" && status !== "canonized"
}
