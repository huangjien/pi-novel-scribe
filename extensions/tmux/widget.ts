/**
 * Phase 7 status widget. Renders a small status surface that fits
 * either:
 *
 *   (a) the bottom pane of the tmux split layout (when the user
 *       opts into Phase 7's tmux.conf), or
 *
 *   (b) the pi TUI itself (when running without tmux).
 *
 * The widget pulls the same state the workflow orchestrator consults:
 * resumable chapters (Q9), active story lines, pending canon-change
 * dockets. It updates on chapter transitions; for Phase 7 it's a
 * sketched / read-mostly surface.
 *
 * Per review §16: tmux is OPTIONAL. The widget works in plain pi.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import * as yaml from "js-yaml"
import { listResumableChapters, type ResumableChapter } from "../novel/resume-scan.ts"
import { type ResolvedNovelRepo, resolveNovelRepo } from "../state/path-resolver.ts"

export interface WidgetState {
	readonly novelRepo: string
	readonly resumable: readonly ResumableChapter[]
	readonly activeStoryLines: readonly string[]
	readonly pendingCanonDrafts: readonly string[]
}

export interface WidgetLine {
	readonly text: string
	readonly tone: "info" | "warning" | "error" | "muted"
}

export function buildWidgetLines(state: WidgetState): readonly WidgetLine[] {
	const lines: WidgetLine[] = []
	lines.push({ text: `pi-novel-scribe · ${state.novelRepo}`, tone: "info" })

	if (state.resumable.length === 0) {
		lines.push({
			text: "Resumable chapters: (none — all chapters approved or canonized)",
			tone: "muted",
		})
	} else {
		lines.push({ text: `Resumable chapters (${state.resumable.length}):`, tone: "info" })
		for (const r of state.resumable) {
			const ch = r.chapterNumber ?? "?"
			const file = r.chapterPath.split("/").pop() ?? r.chapterPath
			lines.push({ text: `  ch ${ch}  ${file}  [${r.status}]`, tone: "warning" })
		}
	}

	lines.push({ text: "", tone: "muted" })

	if (state.activeStoryLines.length === 0) {
		lines.push({
			text: "Active story lines: (none — story/story-lines.yaml missing or empty)",
			tone: "muted",
		})
	} else {
		lines.push({
			text: `Active story lines (${state.activeStoryLines.length}): ${state.activeStoryLines.join(", ")}`,
			tone: "info",
		})
	}

	lines.push({ text: "", tone: "muted" })

	if (state.pendingCanonDrafts.length === 0) {
		lines.push({ text: "Pending canon drafts: (none)", tone: "muted" })
	} else {
		lines.push({
			text: `Pending canon drafts (${state.pendingCanonDrafts.length}): ${state.pendingCanonDrafts.join(", ")}`,
			tone: "warning",
		})
	}

	return lines
}

export async function collectWidgetState(cwd: string): Promise<WidgetState | null> {
	let novelRepoResult: ResolvedNovelRepo | null
	try {
		novelRepoResult = resolveNovelRepo(cwd)
	} catch {
		return null
	}
	const novelRepo = novelRepoResult.path
	const resumable = listResumableChapters(novelRepo)
	return {
		novelRepo,
		resumable,
		activeStoryLines: readActiveStoryLines(novelRepo),
		pendingCanonDrafts: readPendingCanonDrafts(novelRepo),
	}
}

function readActiveStoryLines(novelRepo: string): readonly string[] {
	const path = join(novelRepo, "story", "story-lines.yaml")
	if (!existsSync(path)) return []
	try {
		const raw = readFileSync(path, "utf8")
		const parsed: unknown = yaml.load(raw)
		if (typeof parsed !== "object" || parsed === null) return []
		const obj = parsed as { lines?: unknown }
		if (!Array.isArray(obj.lines)) return []
		return obj.lines
			.filter(
				(l): l is { id: unknown; active?: unknown } =>
					typeof l === "object" && l !== null && "id" in l,
			)
			.filter((l) => l.active !== false)
			.map((l) => String(l.id))
	} catch {
		return []
	}
}

function readPendingCanonDrafts(novelRepo: string): readonly string[] {
	const dir = join(novelRepo, "state", "canon-changes")
	if (!existsSync(dir)) return []
	const out: string[] = []
	for (const file of readdirSync(dir)) {
		if (!file.endsWith(".draft")) continue
		const path = join(dir, file)
		try {
			const raw = readFileSync(path, "utf8")
			const parsed: unknown = yaml.load(raw)
			if (typeof parsed !== "object" || parsed === null) continue
			const obj = parsed as { status?: unknown }
			if (obj.status === "validated" || obj.status === "draft") {
				out.push(file.replace(/\.yaml\.draft$/, ""))
			}
		} catch {}
	}
	return out
}

export function registerStatusWidget(pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx: ExtensionContext) => {
		const state = await collectWidgetState(ctx.cwd)
		if (!state) {
			pi.sendUserMessage("pi-novel-scribe: novel repo not resolved; widget skipped.")
			return
		}
		const lines = buildWidgetLines(state)
		try {
			ctx.ui.setWidget(
				"pi-novel-scribe",
				lines.map((l) => l.text),
			)
		} catch {
			// setWidget throws in -p mode where UI is unavailable.
			ctx.ui.notify(
				`pi-novel-scribe widget skipped: ${lines.length} line(s) would have been shown in interactive mode.`,
				"info",
			)
		}
		void statSync
	})
}
