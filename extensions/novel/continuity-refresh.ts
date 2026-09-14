/**
 * Continuity refresh — re-derives character beliefs from approved prose.
 *
 * Per Q3 worldview:
 *   - Reader knowledge = pure derivation from approved prose (no store).
 *   - Character knowledge = POV-scene-derived by default.
 *   - Authored overrides live in `authored_overrides` and survive
 *     re-derivation.
 *
 * Language filter (Phase 9 / ADR-0007):
 *   - When `options.language` is set, only chapters whose
 *     `frontmatter.language === options.language` contribute to the
 *     derived beliefs. Chapters with no language field are skipped
 *     (the author must set them explicitly to be picked up).
 *   - When `options.language` is omitted, all approved chapters
 *     contribute (backward compatible).
 *   - The result always reports `languageBreakdown` (how many chapters
 *     per language exist in the project) and `chapterStats` (matched vs
 *     skipped under the active filter).
 *
 * Output format (state/character-beliefs.yaml):
 *
 *   characters:
 *     <id>:
 *       derived:
 *         believes: [...]      # auto-derived from POV-scene extraction
 *       authored_overrides: [...]  # preserved across refreshes
 */

import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import * as yaml from "js-yaml"
import type { Language } from "../i18n/index.ts"
import type { ChapterContent } from "./continuity.ts"
import { listApprovedChapters, parseScenesFromBody, readCharacterBeliefs } from "./continuity.ts"

export interface RefreshResult {
	readonly derivedCharacters: readonly string[]
	readonly preservedOverrides: readonly string[]
	readonly approvedChapterCount: number
	readonly outputPath: string
	readonly languageFilter: Language | null
	readonly chapterStats: {
		readonly matched: number
		readonly skipped: number
		readonly skippedChapters: readonly string[]
	}
	readonly languageBreakdown: Readonly<Record<Language, number>>
}

export interface RefreshOptions {
	/**
	 * When set, only chapters whose `frontmatter.language` exactly matches
	 * this value contribute to the derived beliefs. Chapters with no
	 * language field are skipped (the author must set them explicitly).
	 * When omitted (default), all approved chapters contribute.
	 */
	readonly language?: Language
}

const BELIEFS_PATH = "state/character-beliefs.yaml"

export function refreshCharacterBeliefs(
	novelRepo: string,
	options: RefreshOptions = {},
): RefreshResult {
	const allChapters = listApprovedChapters(novelRepo)
	const languageBreakdown = countLanguages(allChapters)

	const filter = options.language ?? null
	const { matched, skipped: skippedChapters } = filterChaptersByLanguage(allChapters, filter)

	const derived = new Map<string, Set<string>>()
	for (const chapter of matched) {
		const scenes = parseScenesFromBody(chapter.body)
		for (const scene of scenes) {
			if (!derived.has(scene.pov)) derived.set(scene.pov, new Set())
			derived.get(scene.pov)?.add(scene.id)
		}
	}

	const existing = readCharacterBeliefs(novelRepo)

	const newFile: {
		characters: Record<
			string,
			{
				derived: { believes: string[] }
				authored_overrides: string[]
			}
		>
	} = { characters: {} }

	const preserved: string[] = []
	const sortedDerivedKeys = [...derived.keys()].sort()
	for (const character of sortedDerivedKeys) {
		const sceneSet = derived.get(character)
		const believes = sceneSet ? [...sceneSet].sort() : []
		const profile = existing.characters[character]
		const authored_overrides = profile?.authored_overrides ?? []

		newFile.characters[character] = {
			derived: { believes },
			authored_overrides: [...authored_overrides],
		}
		if (authored_overrides.length > 0) preserved.push(character)
	}

	const outPath = join(novelRepo, BELIEFS_PATH)
	mkdirSync(join(novelRepo, "state"), { recursive: true })
	writeFileSync(outPath, yaml.dump(newFile, { lineWidth: 100 }), "utf8")

	return {
		derivedCharacters: sortedDerivedKeys,
		preservedOverrides: preserved,
		approvedChapterCount: allChapters.length,
		outputPath: outPath,
		languageFilter: filter,
		chapterStats: {
			matched: matched.length,
			skipped: skippedChapters.length,
			skippedChapters,
		},
		languageBreakdown,
	}
}

function filterChaptersByLanguage(
	chapters: readonly ChapterContent[],
	filter: Language | null,
): { matched: readonly ChapterContent[]; skipped: readonly string[] } {
	const matched: ChapterContent[] = []
	const skipped: string[] = []
	for (const ch of chapters) {
		if (filter === null || ch.language === filter) matched.push(ch)
		else skipped.push(ch.chapterPath)
	}
	return { matched, skipped }
}

function countLanguages(
	chapters: readonly Pick<ChapterContent, "language">[],
): Record<Language, number> {
	const counts: Record<Language, number> = { en: 0, zh: 0 }
	for (const ch of chapters) {
		if (ch.language === "en" || ch.language === "zh") counts[ch.language]++
	}
	return counts
}
