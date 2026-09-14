/**
 * Continuity refresh — re-derives character beliefs from approved prose.
 *
 * Per Q3 worldview:
 *   - Reader knowledge = pure derivation from approved prose (no store).
 *   - Character knowledge = POV-scene-derived by default.
 *   - Authored overrides live in `authored_overrides` and survive
 *     re-derivation.
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
import { listApprovedChapters, parseScenesFromBody, readCharacterBeliefs } from "./continuity.ts"

export interface RefreshResult {
	readonly derivedCharacters: readonly string[]
	readonly preservedOverrides: readonly string[]
	readonly approvedChapterCount: number
	readonly outputPath: string
}

const BELIEFS_PATH = "state/character-beliefs.yaml"

export function refreshCharacterBeliefs(novelRepo: string): RefreshResult {
	const chapters = listApprovedChapters(novelRepo)
	const derived = new Map<string, Set<string>>()

	for (const chapter of chapters) {
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
		approvedChapterCount: chapters.length,
		outputPath: outPath,
	}
}
