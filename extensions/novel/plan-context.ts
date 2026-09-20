/**
 * Planner scene-context composer. Mirrors `composeSceneContext` but
 * for planning: pulls novel-wide state (characters, story lines, last
 * prose register) so the Planner LLM has what it needs to emit a
 * coherent chapter plan.
 */

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import * as yaml from "js-yaml"
import { resolveNovelRepo } from "../state/path-resolver.ts"
import type { WikiResult } from "../wiki/schema.ts"
import { listApprovedChapters } from "./continuity.ts"

export interface PlanRequest {
	readonly novelRepo: string
	readonly chapterPath: string
	readonly chapterNumber: number | null
	readonly existingPlan: Record<string, unknown> | null
	readonly characterProfiles: Record<string, string>
	readonly activeStoryLines: readonly string[]
	readonly lastProseTail: string | null
	readonly approvedChapterCount: number
	readonly wikiReferences?: WikiResult | null
	readonly wikiWarning?: string | null
}

export interface ComposePlanRequestOptions {
	readonly chapterPath: string
	readonly cwd: string
}

export interface BatchChapterEntry {
	readonly chapterPath: string
	readonly chapterNumber: number | null
	readonly existingPlan: Record<string, unknown> | null
}

export interface BatchPlanRequest {
	readonly novelRepo: string
	readonly chapters: readonly BatchChapterEntry[]
	readonly characterProfiles: Record<string, string>
	readonly activeStoryLines: readonly string[]
	readonly lastProseTail: string | null
	readonly approvedChapterCount: number
	readonly wikiReferences?: WikiResult | null
	readonly wikiWarning?: string | null
}

export interface ComposeBatchPlanRequestOptions {
	readonly chapterPaths: readonly string[]
	readonly cwd: string
}

const STORY_LINE_INDEX = "story/story-lines.yaml"
const CHARACTERS_DIR = "characters"

export function composePlanRequest(options: ComposePlanRequestOptions): PlanRequest {
	const novelRepo = resolveNovelRepo(options.cwd).path
	const chapterPath = options.chapterPath.startsWith("/")
		? options.chapterPath
		: join(novelRepo, "chapters", options.chapterPath)

	if (!existsSync(chapterPath)) {
		throw new Error(`composePlanRequest: chapter file not found: ${chapterPath}`)
	}
	const raw = readFileSync(chapterPath, "utf8")
	const { frontmatter } = parseYamlFrontmatter(raw)

	return {
		novelRepo,
		chapterPath,
		chapterNumber: typeof frontmatter.chapter === "number" ? (frontmatter.chapter as number) : null,
		existingPlan:
			typeof frontmatter.plan === "object" && frontmatter.plan !== null
				? (frontmatter.plan as Record<string, unknown>)
				: null,
		characterProfiles: readCharacterProfiles(novelRepo),
		activeStoryLines: readActiveStoryLines(novelRepo),
		lastProseTail: readLastProseTail(novelRepo, chapterPath),
		approvedChapterCount: listApprovedChapters(novelRepo).length,
	}
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?([\s\S]*)$/

function parseYamlFrontmatter(content: string): {
	frontmatter: Record<string, unknown>
	body: string
} {
	const m = FRONTMATTER_RE.exec(content)
	if (!m || m[1] === undefined || m[2] === undefined) {
		return { frontmatter: {}, body: content }
	}
	let parsed: unknown
	try {
		parsed = yaml.load(m[1])
	} catch {
		return { frontmatter: {}, body: m[2] }
	}
	if (typeof parsed !== "object" || parsed === null) {
		return { frontmatter: {}, body: m[2] }
	}
	return { frontmatter: parsed as Record<string, unknown>, body: m[2] }
}
function readCharacterProfiles(novelRepo: string): Record<string, string> {
	const dir = join(novelRepo, CHARACTERS_DIR)
	if (!existsSync(dir)) return {}
	const profiles: Record<string, string> = {}
	for (const name of readdirSyncSafe(dir)) {
		const profilePath = join(dir, name, "profile.yaml")
		if (existsSync(profilePath)) {
			profiles[name] = readFileSync(profilePath, "utf8")
		}
	}
	return profiles
}

function readActiveStoryLines(novelRepo: string): readonly string[] {
	const path = join(novelRepo, STORY_LINE_INDEX)
	if (!existsSync(path)) return []
	let parsed: unknown
	try {
		parsed = yaml.load(readFileSync(path, "utf8"))
	} catch {
		return []
	}
	if (typeof parsed !== "object" || parsed === null) return []
	const obj = parsed as { lines?: unknown }
	if (!Array.isArray(obj.lines)) return []
	return obj.lines
		.filter(
			(l): l is { id: string; active?: boolean } =>
				typeof l === "object" && l !== null && "id" in l,
		)
		.filter((l) => l.active !== false)
		.map((l) => l.id)
}

function readLastProseTail(novelRepo: string, currentPath: string): string | null {
	const approved = listApprovedChapters(novelRepo)
	if (approved.length === 0) return null
	const last = approved[approved.length - 1]
	if (!last || last.chapterPath === currentPath) return null
	return last.body.slice(-500)
}

function readdirSyncSafe(dir: string): readonly string[] {
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		return require("node:fs").readdirSync(dir) as string[]
	} catch {
		return []
	}
}

/**
 * Multi-chapter plan composer (ADR-0009 Q25). Resolves novel-wide state
 * ONCE then walks N chapter files for per-chapter existingPlan only.
 * Used when the planner batches N > 1 chapter plans in one LLM call.
 */
export function composeBatchPlanRequest(options: ComposeBatchPlanRequestOptions): BatchPlanRequest {
	if (options.chapterPaths.length === 0) {
		throw new Error("composeBatchPlanRequest: chapterPaths must contain at least one path")
	}
	const novelRepo = resolveNovelRepo(options.cwd).path
	const characterProfiles = readCharacterProfiles(novelRepo)
	const activeStoryLines = readActiveStoryLines(novelRepo)
	const approvedChapterCount = listApprovedChapters(novelRepo).length

	const chapters: BatchChapterEntry[] = []
	let lastProseTail: string | null = null
	for (const inputPath of options.chapterPaths) {
		const chapterPath = inputPath.startsWith("/")
			? inputPath
			: join(novelRepo, "chapters", inputPath)
		if (!existsSync(chapterPath)) {
			throw new Error(`composeBatchPlanRequest: chapter file not found: ${chapterPath}`)
		}
		const raw = readFileSync(chapterPath, "utf8")
		const { frontmatter } = parseYamlFrontmatter(raw)
		chapters.push({
			chapterPath,
			chapterNumber:
				typeof frontmatter.chapter === "number" ? (frontmatter.chapter as number) : null,
			existingPlan:
				typeof frontmatter.plan === "object" && frontmatter.plan !== null
					? (frontmatter.plan as Record<string, unknown>)
					: null,
		})
		if (lastProseTail === null) {
			lastProseTail = readLastProseTail(novelRepo, chapterPath)
		}
	}

	return {
		novelRepo,
		chapters,
		characterProfiles,
		activeStoryLines,
		lastProseTail,
		approvedChapterCount,
	}
}
