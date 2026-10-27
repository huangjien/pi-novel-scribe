import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as yaml from "js-yaml"
import { describe, expect, it } from "vitest"
import {
	buildWidgetLines,
	collectWidgetState,
	registerStatusWidget,
} from "../extensions/tmux/widget.ts"
import { makeFakeCtx } from "./_helpers/fakePi.ts"

describe("buildWidgetLines", () => {
	it("includes the novel repo path in the first line", () => {
		const lines = buildWidgetLines({
			novelRepo: "/abs/path/to/novel",
			resumable: [],
			activeStoryLines: [],
			pendingCanonDrafts: [],
		})
		expect(lines[0]?.text).toContain("/abs/path/to/novel")
		expect(lines[0]?.tone).toBe("info")
	})

	it("lists each resumable chapter with status", () => {
		const lines = buildWidgetLines({
			novelRepo: "/novel",
			resumable: [
				{ chapterPath: "/novel/chapters/0005.md", chapterNumber: 5, status: "human_editing" },
				{ chapterPath: "/novel/chapters/0007.md", chapterNumber: 7, status: "reviewing" },
			],
			activeStoryLines: [],
			pendingCanonDrafts: [],
		})
		const chapterBlock = lines.find((l) => l.text.startsWith("Resumable chapters"))
		expect(chapterBlock?.text).toContain("(2)")
		expect(lines.find((l) => l.text.includes("ch 5"))?.tone).toBe("warning")
		expect(lines.find((l) => l.text.includes("ch 7"))?.tone).toBe("warning")
	})

	it("uses 'muted' tone when there are no resumable chapters", () => {
		const lines = buildWidgetLines({
			novelRepo: "/novel",
			resumable: [],
			activeStoryLines: [],
			pendingCanonDrafts: [],
		})
		const r = lines.find((l) => l.text.startsWith("Resumable chapters"))
		expect(r?.tone).toBe("muted")
		expect(r?.text).toContain("none")
	})

	it("shows active story line names comma-separated", () => {
		const lines = buildWidgetLines({
			novelRepo: "/novel",
			resumable: [],
			activeStoryLines: ["sara-investigation", "the-watcher"],
			pendingCanonDrafts: [],
		})
		const sl = lines.find((l) => l.text.startsWith("Active story lines"))
		expect(sl?.text).toContain("sara-investigation")
		expect(sl?.text).toContain("the-watcher")
		expect(sl?.tone).toBe("info")
	})

	it("flags pending canon drafts with warning tone", () => {
		const lines = buildWidgetLines({
			novelRepo: "/novel",
			resumable: [],
			activeStoryLines: [],
			pendingCanonDrafts: ["F-023-ch5", "F-024-ch5"],
		})
		const c = lines.find((l) => l.text.startsWith("Pending canon drafts"))
		expect(c?.text).toContain("F-023-ch5")
		expect(c?.tone).toBe("warning")
	})

	it("uses 'muted' tone when no canon drafts are pending", () => {
		const lines = buildWidgetLines({
			novelRepo: "/novel",
			resumable: [],
			activeStoryLines: [],
			pendingCanonDrafts: [],
		})
		const c = lines.find((l) => l.text.startsWith("Pending canon drafts"))
		expect(c?.tone).toBe("muted")
		expect(c?.text).toContain("none")
	})

	it("separator lines use 'muted' tone", () => {
		const lines = buildWidgetLines({
			novelRepo: "/novel",
			resumable: [],
			activeStoryLines: [],
			pendingCanonDrafts: [],
		})
		const blankLines = lines.filter((l) => l.text.trim() === "")
		expect(blankLines.length).toBeGreaterThan(0)
		for (const l of blankLines) expect(l.tone).toBe("muted")
	})
})

/** Seed a minimal novel repo exercising every widget state source. */
function makeNovelRepo(): string {
	const repo = mkdtempSync(join(tmpdir(), "widget-state-"))
	mkdirSync(join(repo, "chapters"), { recursive: true })
	mkdirSync(join(repo, "story"), { recursive: true })
	mkdirSync(join(repo, "state", "canon-changes"), { recursive: true })

	writeFileSync(
		join(repo, "chapters", "0001.md"),
		"---\nchapter: 1\nstatus: approved\n---\n\n# Chapter 1\n",
		"utf8",
	)
	writeFileSync(
		join(repo, "chapters", "0002.md"),
		"---\nchapter: 2\nstatus: human_editing\n---\n\n# Chapter 2\n",
		"utf8",
	)

	writeFileSync(
		join(repo, "story", "story-lines.yaml"),
		yaml.dump({
			lines: [
				{ id: "sara-investigation", active: true },
				{ id: "the-watcher", active: false },
				{ id: "lighthouse-curse" },
			],
		}),
		"utf8",
	)

	writeFileSync(
		join(repo, "state", "canon-changes", "F-1.yaml.draft"),
		yaml.dump({ id: "F-1", status: "validated" }),
		"utf8",
	)
	writeFileSync(
		join(repo, "state", "canon-changes", "F-2.yaml.draft"),
		yaml.dump({ id: "F-2", status: "draft" }),
		"utf8",
	)
	writeFileSync(
		join(repo, "state", "canon-changes", "F-3.yaml.draft"),
		yaml.dump({ id: "F-3", status: "deprecated" }),
		"utf8",
	)
	writeFileSync(join(repo, "state", "canon-changes", "broken.yaml.draft"), "\t- [unclosed", "utf8")
	writeFileSync(join(repo, "state", "canon-changes", "notes.txt"), "not a draft", "utf8")

	return repo
}

describe("collectWidgetState", () => {
	it("reads resumable chapters, active story lines, and pending drafts from the repo", async () => {
		const repo = makeNovelRepo()
		try {
			const state = await collectWidgetState(repo)
			expect(state).not.toBeNull()
			expect(state?.novelRepo).toBe(repo)

			expect(state?.resumable.map((r) => r.chapterPath.split("/").pop())).toEqual(["0002.md"])
			expect(state?.resumable[0]?.status).toBe("human_editing")

			expect(state?.activeStoryLines).toEqual(["sara-investigation", "lighthouse-curse"])

			expect(state?.pendingCanonDrafts).toEqual(["F-1", "F-2"])
		} finally {
			rmSync(repo, { recursive: true, force: true })
		}
	})

	it("returns empty collections for a bare directory with no novel state", async () => {
		const repo = mkdtempSync(join(tmpdir(), "widget-empty-"))
		try {
			const state = await collectWidgetState(repo)
			expect(state?.resumable).toEqual([])
			expect(state?.activeStoryLines).toEqual([])
			expect(state?.pendingCanonDrafts).toEqual([])
		} finally {
			rmSync(repo, { recursive: true, force: true })
		}
	})

	it("survives malformed story-lines.yaml (returns no active lines)", async () => {
		const repo = mkdtempSync(join(tmpdir(), "widget-broken-"))
		try {
			mkdirSync(join(repo, "story"), { recursive: true })
			writeFileSync(join(repo, "story", "story-lines.yaml"), "\t- [unclosed", "utf8")
			const state = await collectWidgetState(repo)
			expect(state?.activeStoryLines).toEqual([])
		} finally {
			rmSync(repo, { recursive: true, force: true })
		}
	})
})

describe("registerStatusWidget", () => {
	it("sets the widget with the rendered lines on session_start", async () => {
		const repo = makeNovelRepo()
		try {
			const captured: { handler?: (event: unknown, ctx: unknown) => Promise<void> } = {}
			const pi = {
				on: (event: string, h: (event: unknown, ctx: unknown) => Promise<void>) => {
					if (event === "session_start") captured.handler = h
				},
			}
			registerStatusWidget(pi as unknown as Parameters<typeof registerStatusWidget>[0])

			const setWidgetCalls: unknown[][] = []
			const notifyCalls: unknown[][] = []
			const ctx = makeFakeCtx({
				cwd: repo,
				ui: {
					setWidget: (...args: unknown[]) => setWidgetCalls.push(args),
					notify: (...args: unknown[]) => notifyCalls.push(args),
				},
			})

			expect(captured.handler).toBeDefined()
			await captured.handler?.("session_start", ctx)

			expect(setWidgetCalls).toHaveLength(1)
			expect(notifyCalls).toHaveLength(0)
			const [name, lines] = setWidgetCalls[0] as [string, string[]]
			expect(name).toBe("pi-novel-scribe")
			expect(lines[0]).toContain("pi-novel-scribe")
			expect(lines.join("\n")).toContain("ch 2")
		} finally {
			rmSync(repo, { recursive: true, force: true })
		}
	})

	it("falls back to notify when setWidget throws (headless -p mode)", async () => {
		const repo = makeNovelRepo()
		try {
			const captured: { handler?: (event: unknown, ctx: unknown) => Promise<void> } = {}
			const pi = {
				on: (event: string, h: (event: unknown, ctx: unknown) => Promise<void>) => {
					if (event === "session_start") captured.handler = h
				},
			}
			registerStatusWidget(pi as unknown as Parameters<typeof registerStatusWidget>[0])

			const notifyCalls: unknown[][] = []
			const ctx = makeFakeCtx({
				cwd: repo,
				ui: {
					setWidget: () => {
						throw new Error("no UI in -p mode")
					},
					notify: (...args: unknown[]) => notifyCalls.push(args),
				},
			})

			await captured.handler?.("session_start", ctx)
			expect(notifyCalls).toHaveLength(1)
			expect(String(notifyCalls[0]?.[0])).toContain("widget skipped")
		} finally {
			rmSync(repo, { recursive: true, force: true })
		}
	})
})
