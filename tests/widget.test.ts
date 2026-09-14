import { describe, expect, it } from "vitest"
import { buildWidgetLines } from "../extensions/tmux/widget.ts"

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
