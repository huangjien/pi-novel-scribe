import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { resolveNovelRepo, walkUp } from "../extensions/state/path-resolver.ts"

let sandbox: string

beforeEach(() => {
	sandbox = mkdtempSync(join(tmpdir(), "pi-novel-scribe-test-"))
})

afterEach(() => {
	rmSync(sandbox, { recursive: true, force: true })
})

function writeSettings(dir: string, data: object): void {
	const dotPi = join(dir, CONFIG_DIR_NAME)
	mkdirSync(dotPi, { recursive: true })
	writeFileSync(join(dotPi, "settings.json"), JSON.stringify(data), "utf8")
}

function writeMarker(dir: string): void {
	const dotPi = join(dir, CONFIG_DIR_NAME)
	mkdirSync(dotPi, { recursive: true })
	writeFileSync(join(dotPi, "novel-state.yaml"), "novel: true\n", "utf8")
}

describe("walkUp", () => {
	it("returns cwd up to filesystem root", () => {
		const result = walkUp(sandbox)
		expect(result.length).toBeGreaterThan(1)
		expect(result[0]).toBe(sandbox)
		// Last entry is the filesystem root
		expect(result[result.length - 1]).toMatch(/^(\/|[A-Za-z]:[\\/])$/)
	})

	it("stops at root without looping", () => {
		// walkUp("/") → just ["/"]
		expect(walkUp("/")).toEqual(["/"])
	})
})

describe("resolveNovelRepo", () => {
	it("returns fallback when no settings or marker exist anywhere", () => {
		const sub = join(sandbox, "child")
		mkdirSync(sub)
		const result = resolveNovelRepo(sub)
		expect(result.source).toBe("fallback")
		expect(result.path).toBe(sub)
	})

	it("returns the settings-declared novelRepo path (absolute)", () => {
		writeSettings(sandbox, { novelRepo: "/abs/path/to/novel" })
		const result = resolveNovelRepo(sandbox)
		expect(result.source).toBe("settings")
		expect(result.path).toBe("/abs/path/to/novel")
	})

	it("returns the settings-declared novelRepo path (relative, joined to dir)", () => {
		writeSettings(sandbox, { novelRepo: "novels/mine" })
		const result = resolveNovelRepo(sandbox)
		expect(result.source).toBe("settings")
		expect(result.path).toBe(join(sandbox, "novels/mine"))
	})

	it("ignores malformed settings.json and falls back to cwd", () => {
		const dotPi = join(sandbox, CONFIG_DIR_NAME)
		mkdirSync(dotPi, { recursive: true })
		writeFileSync(join(dotPi, "settings.json"), "{not json", "utf8")
		const result = resolveNovelRepo(sandbox)
		expect(result.source).toBe("fallback")
		expect(result.path).toBe(sandbox)
	})

	it("ignores settings.json without novelRepo and falls back to marker", () => {
		writeSettings(sandbox, { other: "value" })
		writeMarker(sandbox)
		const result = resolveNovelRepo(sandbox)
		expect(result.source).toBe("marker")
		expect(result.path).toBe(sandbox)
	})

	it("returns the marker file's parent directory as the novel repo", () => {
		const novelRoot = join(sandbox, "novels", "thelighthouse")
		mkdirSync(novelRoot, { recursive: true })
		const dotPi = join(novelRoot, CONFIG_DIR_NAME)
		mkdirSync(dotPi, { recursive: true })
		writeFileSync(join(dotPi, "novel-state.yaml"), "novel: true\n", "utf8")
		const worktree = join(novelRoot, "chapters")
		mkdirSync(worktree, { recursive: true })
		const result = resolveNovelRepo(worktree)
		expect(result.source).toBe("marker")
		expect(result.path).toBe(novelRoot)
	})

	it("prefers ancestor settings over cwd marker", () => {
		// Sandbox has settings.json — child has marker. Settings should win
		// because settings check runs before marker check.
		writeSettings(sandbox, { novelRepo: "/abs/path/from/parent-settings" })
		const child = join(sandbox, "child")
		mkdirSync(child)
		const dotPi = join(child, CONFIG_DIR_NAME)
		mkdirSync(dotPi, { recursive: true })
		writeFileSync(join(dotPi, "novel-state.yaml"), "novel: true\n", "utf8")
		const result = resolveNovelRepo(child)
		expect(result.source).toBe("settings")
		expect(result.path).toBe("/abs/path/from/parent-settings")
	})
})
