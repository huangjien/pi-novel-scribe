/**
 * Continuity — canonical consistency primitives. Per Q3 worldview:
 *   - Reader knowledge is pure derivation from approved prose.
 *   - Character knowledge is POV-scene-derived by default, with
 *     authored overrides via `state/character-beliefs.yaml`.
 *   - World truth lives in `state/world-truth.yaml` (authored only).
 *
 * Phase 4 reads-only scope: derive facts from approved chapters +
 * read authored files. Mutations (`canon_propose` writing back) land
 * in Phase 5.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import * as yaml from "js-yaml"
import { parseFrontmatter } from "../workflow/status.ts"

export interface ChapterContent {
	readonly chapterPath: string
	readonly chapterNumber: number | null
	readonly status: string | null
	readonly body: string
	readonly sceneIds: readonly string[]
}

export interface CharacterBeliefProfile {
	readonly believes: readonly string[]
	readonly authored_overrides: readonly string[]
}

export interface CharacterBeliefsFile {
	readonly characters: Record<string, CharacterBeliefProfile>
}

export interface WorldTruthFile {
	readonly truths: readonly string[]
}

export interface DivergenceReport {
	readonly character: string
	readonly belief: string
	readonly type: "authored-no-derived" | "derived-no-authored"
	readonly at_chapter: number
}

// --- Reading helpers ---

const SCENE_RE =
	/@scene\b[\s\S]*?\bid\s*[:=]\s*([-a-zA-Z0-9_]+)[\s\S]*?\bpov\s*[:=]\s*([-a-zA-Z0-9_]+)/g

export function parseScenesFromBody(body: string): {
	readonly id: string
	readonly pov: string
}[] {
	const result: { id: string; pov: string }[] = []
	const re = new RegExp(SCENE_RE.source, "g")
	for (const match of body.matchAll(re)) {
		const id = match[1]
		const pov = match[2]
		if (id === undefined || pov === undefined) continue
		result.push({ id, pov })
	}
	return result
}

export function listApprovedChapters(novelRepo: string): ChapterContent[] {
	const chaptersDir = join(novelRepo, "chapters")
	if (!existsSync(chaptersDir)) return []
	const files = readdirSync(chaptersDir)
		.filter((f) => f.endsWith(".md"))
		.sort()
	const out: ChapterContent[] = []
	for (const file of files) {
		const path = join(chaptersDir, file)
		const raw = readFileSync(path, "utf8")
		const { frontmatter, body } = parseFrontmatter(raw)
		const status = typeof frontmatter.status === "string" ? (frontmatter.status as string) : null
		if (status !== "approved" && status !== "canonized") continue
		const scenes = parseScenesFromBody(body)
		out.push({
			chapterPath: path,
			chapterNumber:
				typeof frontmatter.chapter === "number" ? (frontmatter.chapter as number) : null,
			status,
			body,
			sceneIds: scenes.map((s) => s.id),
		})
	}
	return out
}

export function readCharacterBeliefs(novelRepo: string): CharacterBeliefsFile {
	const path = join(novelRepo, "state", "character-beliefs.yaml")
	if (!existsSync(path)) return { characters: {} }
	let parsed: unknown
	try {
		parsed = yaml.load(readFileSync(path, "utf8"))
	} catch {
		return { characters: {} }
	}
	if (typeof parsed !== "object" || parsed === null) {
		return { characters: {} }
	}
	const raw = parsed as { characters?: unknown }
	if (typeof raw.characters !== "object" || raw.characters === null) {
		return { characters: {} }
	}
	const characters: Record<string, CharacterBeliefProfile> = {}
	for (const [name, profile] of Object.entries(raw.characters as Record<string, unknown>)) {
		if (typeof profile !== "object" || profile === null) continue
		const p = profile as { believes?: unknown; authored_overrides?: unknown }
		characters[name] = {
			believes: stringArray(p.believes),
			authored_overrides: stringArray(p.authored_overrides),
		}
	}
	return { characters }
}

export function readWorldTruth(novelRepo: string): WorldTruthFile {
	const path = join(novelRepo, "state", "world-truth.yaml")
	if (!existsSync(path)) return { truths: [] }
	let parsed: unknown
	try {
		parsed = yaml.load(readFileSync(path, "utf8"))
	} catch {
		return { truths: [] }
	}
	if (typeof parsed !== "object" || parsed === null) {
		return { truths: [] }
	}
	const raw = parsed as { truths?: unknown }
	return { truths: stringArray(raw.truths) }
}

// --- Derivation ---

/** All fact IDs the reader knows after reading up through `chapterIndex` (inclusive). */
export function deriveReaderKnowledgeAt(novelRepo: string, chapterIndex: number): string[] {
	const facts = new Set<string>()
	for (const chapter of listApprovedChapters(novelRepo)) {
		if (chapter.chapterNumber === null) continue
		if (chapter.chapterNumber > chapterIndex) break
		for (const id of chapter.sceneIds) facts.add(id)
	}
	return [...facts]
}

/** Fact IDs that `character` has POV-witnessed up through `chapterIndex` (inclusive). */
export function deriveCharacterKnowledgeAt(
	novelRepo: string,
	chapterIndex: number,
	character: string,
): string[] {
	const facts = new Set<string>()
	for (const chapter of listApprovedChapters(novelRepo)) {
		if (chapter.chapterNumber === null) continue
		if (chapter.chapterNumber > chapterIndex) break
		const scenes = parseScenesFromBody(chapter.body)
		for (const scene of scenes) {
			if (scene.pov === character) facts.add(scene.id)
		}
	}
	return [...facts]
}

/** Find authored beliefs with no derivation evidence, or derived scenes with no authored belief. */
export function findDivergences(
	novelRepo: string,
	chapterIndex: number = Number.POSITIVE_INFINITY,
): DivergenceReport[] {
	const authored = readCharacterBeliefs(novelRepo)
	const out: DivergenceReport[] = []
	for (const [character, profile] of Object.entries(authored.characters)) {
		const derived = new Set(deriveCharacterKnowledgeAt(novelRepo, chapterIndex, character))
		for (const belief of profile.authored_overrides) {
			if (!derived.has(belief)) {
				out.push({
					character,
					belief,
					type: "authored-no-derived",
					at_chapter: chapterIndex,
				})
			}
		}
	}
	return out
}

// --- Internal ---

function stringArray(value: unknown): string[] {
	if (value === undefined) return []
	if (!Array.isArray(value)) return []
	return value.filter((x): x is string => typeof x === "string")
}
