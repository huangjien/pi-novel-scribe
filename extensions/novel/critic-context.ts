/**
 * Critic scene-context composer. Gathers the chapter prose + plan +
 * character profiles + active story lines for the Critic's review.
 * Per Q7 deterministic composition.
 */

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import * as yaml from "js-yaml"
import { resolveNovelRepo } from "../state/path-resolver.ts"
import { composePlanRequest } from "./plan-context.ts"

export interface CriticContext {
	readonly novelRepo: string
	readonly chapterPath: string
	readonly chapterNumber: number | null
	readonly prose: string
	readonly wordCount: number
	readonly plan: Record<string, unknown> | null
	readonly pov: string | null
	readonly characterProfile: string | null
	readonly activeStoryLines: readonly string[]
	readonly storyLineIndex: readonly string[]
}

export interface ComposeCriticContextOptions {
	readonly chapterPath: string
	readonly cwd: string
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?([\s\S]*)$/
const PO_MARKER = /@scene\b[\s\S]*?\bpov\s*[:=]\s*([-\w]+)/

export function composeCriticContext(options: ComposeCriticContextOptions): CriticContext {
	const novelRepo = resolveNovelRepo(options.cwd).path
	const chapterPath = options.chapterPath.startsWith("/")
		? options.chapterPath
		: join(novelRepo, "chapters", options.chapterPath)

	if (!existsSync(chapterPath)) {
		throw new Error(`composeCriticContext: chapter file not found: ${chapterPath}`)
	}
	const raw = readFileSync(chapterPath, "utf8")
	const m = FRONTMATTER_RE.exec(raw)
	const frontmatter =
		m && m[1] !== undefined && m[2] !== undefined ? (safeYaml(m[1]) as Record<string, unknown>) : {}
	const prose = m && m[2] !== undefined ? m[2] : raw

	const planRaw = frontmatter.plan
	const plan =
		typeof planRaw === "object" && planRaw !== null ? (planRaw as Record<string, unknown>) : null

	const sceneMarker = PO_MARKER.exec(prose)
	const pov = sceneMarker?.[1] ? sceneMarker[1] : null

	const profilePath = pov ? join(novelRepo, "characters", pov, "profile.yaml") : null
	const characterProfile =
		profilePath && existsSync(profilePath) ? readFileSync(profilePath, "utf8") : null

	const planRequest = composePlanRequest({
		chapterPath: options.chapterPath,
		cwd: options.cwd,
	})

	const trimmedProse = prose.trim()
	const wordCount = trimmedProse.length === 0 ? 0 : trimmedProse.split(/\s+/).length
	const storyLineIndex = composePlanRequest.name ? indexifyStoryLines(novelRepo) : []

	return {
		novelRepo,
		chapterPath,
		chapterNumber: typeof frontmatter.chapter === "number" ? (frontmatter.chapter as number) : null,
		prose,
		wordCount,
		plan,
		pov,
		characterProfile,
		activeStoryLines: planRequest.activeStoryLines,
		storyLineIndex,
	}
}

function safeYaml(text: string): unknown {
	try {
		return yaml.load(text)
	} catch {
		return {}
	}
}

function indexifyStoryLines(novelRepo: string): readonly string[] {
	// Lightweight — name + intent summary for each story line. Used by the
	// Critic to cross-reference line advancement with scenes in the prose.
	const path = join(novelRepo, "story", "story-lines.yaml")
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
			(l): l is { id: string; intent?: string } =>
				typeof l === "object" &&
				l !== null &&
				"id" in l &&
				typeof (l as { id: unknown }).id === "string",
		)
		.map((l) => `${l.id}: ${l.intent ?? "(no intent)"}`)
}
