import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	deriveCharacterKnowledgeAt,
	deriveReaderKnowledgeAt,
	findDivergences,
	listApprovedChapters,
	parseScenesFromBody,
	readCharacterBeliefs,
	readWorldTruth,
} from "../extensions/novel/continuity.ts"

let sandbox: string
beforeEach(() => {
	sandbox = mkdtempSync(join(tmpdir(), "pi-novel-scribe-continuity-"))
})
afterEach(() => {
	rmSync(sandbox, { recursive: true, force: true })
})

function makeChapter(filename: string, content: string): void {
	const chaptersDir = join(sandbox, "chapters")
	mkdirSync(chaptersDir, { recursive: true })
	writeFileSync(join(chaptersDir, filename), content, "utf8")
}

function makeBeliefs(content: string): void {
	const stateDir = join(sandbox, "state")
	mkdirSync(stateDir, { recursive: true })
	writeFileSync(join(stateDir, "character-beliefs.yaml"), content, "utf8")
}

function makeWorldTruth(content: string): void {
	const stateDir = join(sandbox, "state")
	mkdirSync(stateDir, { recursive: true })
	writeFileSync(join(stateDir, "world-truth.yaml"), content, "utf8")
}

const APPROVED_CH1 = `---
chapter: 1
status: approved
---

@scene id=lighthouse-arrival pov=sara location=lighthouse time=evening
Sara arrived at the lighthouse.
`

const APPROVED_CH2 = `---
chapter: 2
status: approved
---

@scene id=miguel-reveal pov=sara location=lighthouse
Sara confronted Miguel.

@scene id=watcher-planted pov=miguel location=dark-room
Miguel whispered a name to himself.
`

const DRAFT_CH3 = `---
chapter: 3
status: drafted
---

@scene id=not-canon pov=sara
This is in a draft chapter and should not appear in derivation.
`

const SAMPLE_BELIEFS = `characters:
  sara:
    believes: ["lighthouse-exists"]
    authored_overrides: ["watcher-planted-secret"]
  miguel:
    believes: []
    authored_overrides: []
`

describe("parseScenesFromBody", () => {
	it("extracts each @scene marker with id and pov", () => {
		const body = `@scene id=foo pov=sara location=here
some prose
@scene id=bar pov=miguel
other prose`
		const scenes = parseScenesFromBody(body)
		expect(scenes).toEqual([
			{ id: "foo", pov: "sara" },
			{ id: "bar", pov: "miguel" },
		])
	})

	it("returns empty array when no scenes", () => {
		expect(parseScenesFromBody("just prose\n\n")).toEqual([])
	})
})

describe("listApprovedChapters", () => {
	it("returns only approved + canonized chapters, sorted by chapter number", () => {
		makeChapter("0001.md", APPROVED_CH1)
		makeChapter("0003.md", DRAFT_CH3)
		makeChapter("0002.md", APPROVED_CH2)
		const result = listApprovedChapters(sandbox)
		expect(result.length).toBe(2)
		expect(result[0]?.chapterNumber).toBe(1)
		expect(result[1]?.chapterNumber).toBe(2)
	})

	it("returns empty array when no chapters dir exists", () => {
		expect(listApprovedChapters(sandbox)).toEqual([])
	})

	it("skips chapters with status: planned, drafted, writing, etc.", () => {
		makeChapter("0001.md", "---\nstatus: planned\n---\n\n@scene id=x pov=sara\n")
		makeChapter("0002.md", "---\nstatus: drafted\n---\n\n@scene id=y pov=sara\n")
		expect(listApprovedChapters(sandbox)).toEqual([])
	})
})

describe("deriveReaderKnowledgeAt", () => {
	it("accumulates scene IDs from chapters ≤ N", () => {
		makeChapter("0001.md", APPROVED_CH1)
		makeChapter("0002.md", APPROVED_CH2)
		makeChapter("0003.md", DRAFT_CH3)

		const at1 = deriveReaderKnowledgeAt(sandbox, 1)
		expect(at1).toEqual(["lighthouse-arrival"])

		const at2 = deriveReaderKnowledgeAt(sandbox, 2)
		expect(at2).toEqual(["lighthouse-arrival", "miguel-reveal", "watcher-planted"])
	})

	it("returns empty array when no approved chapters", () => {
		expect(deriveReaderKnowledgeAt(sandbox, 999)).toEqual([])
	})
})

describe("deriveCharacterKnowledgeAt", () => {
	it("returns only scene-fact IDs from chapters where the character POVs", () => {
		makeChapter("0001.md", APPROVED_CH1)
		makeChapter("0002.md", APPROVED_CH2)
		makeChapter("0003.md", DRAFT_CH3)

		const saraAt2 = deriveCharacterKnowledgeAt(sandbox, 2, "sara")
		expect(saraAt2).toEqual(["lighthouse-arrival", "miguel-reveal"])

		const miguelAt2 = deriveCharacterKnowledgeAt(sandbox, 2, "miguel")
		expect(miguelAt2).toEqual(["watcher-planted"])
	})

	it("returns empty array for a character who never POVs", () => {
		makeChapter("0001.md", APPROVED_CH1)
		expect(deriveCharacterKnowledgeAt(sandbox, 1, "no-one")).toEqual([])
	})
})

describe("readCharacterBeliefs", () => {
	it("parses authored beliefs from yaml", () => {
		makeBeliefs(SAMPLE_BELIEFS)
		const result = readCharacterBeliefs(sandbox)
		expect(result.characters.sara?.believes).toEqual(["lighthouse-exists"])
		expect(result.characters.sara?.authored_overrides).toEqual(["watcher-planted-secret"])
	})

	it("returns empty record when file doesn't exist", () => {
		const result = readCharacterBeliefs(sandbox)
		expect(result.characters).toEqual({})
	})

	it("returns empty record on malformed yaml", () => {
		makeBeliefs("{not: yaml")
		expect(readCharacterBeliefs(sandbox).characters).toEqual({})
	})
})

describe("readWorldTruth", () => {
	it("parses authored world truths", () => {
		makeWorldTruth("truths:\n  - 'antagonist survived'\n  - 'lighthouse abandoned in 1987'\n")
		const result = readWorldTruth(sandbox)
		expect(result.truths).toEqual(["antagonist survived", "lighthouse abandoned in 1987"])
	})

	it("returns empty truths when file missing", () => {
		expect(readWorldTruth(sandbox).truths).toEqual([])
	})
})

describe("findDivergences", () => {
	it("reports authored overrides that have no derivation evidence", () => {
		makeChapter("0001.md", APPROVED_CH1)
		makeChapter("0002.md", APPROVED_CH2)
		makeBeliefs(SAMPLE_BELIEFS)

		const divergences = findDivergences(sandbox, 999)
		expect(divergences.length).toBe(1)
		expect(divergences[0]?.character).toBe("sara")
		expect(divergences[0]?.belief).toBe("watcher-planted-secret")
		expect(divergences[0]?.type).toBe("authored-no-derived")
	})

	it("returns empty array when authored overrides match derivation", () => {
		makeChapter("0001.md", APPROVED_CH1)
		makeChapter("0002.md", APPROVED_CH2)
		makeBeliefs(`characters:
  sara:
    believes: ["lighthouse-exists"]
    authored_overrides: ["lighthouse-arrival"]
  miguel:
    believes: []
    authored_overrides: []
`)
		expect(findDivergences(sandbox, 999)).toEqual([])
	})
})
