/**
 * External-editor primitive. Per ADR-0002/Q8, the editor is also the
 * approval gate. Per review §14, editor resolution order is:
 *
 *   $VISUAL → $EDITOR → platform default
 *
 * The primitive returns enough metadata for callers to decide whether
 * the file was actually modified — that's how we distinguish
 * "save = approve/edit" from "quit-without-save = rollback".
 */

import { spawn } from "node:child_process"
import { statSync } from "node:fs"

export interface EditorResult {
	/** True iff the file's mtime increased during the editor session. */
	readonly saved: boolean
	/** Exit code from the editor subprocess, if it exited normally. */
	readonly exitCode: number | null
	/** How long the editor was open, in milliseconds. */
	readonly durationMs: number
	/** File mtime before opening (ms since epoch). */
	readonly beforeMtimeMs: number
	/** File mtime after closing (ms since epoch). */
	readonly afterMtimeMs: number
}

export interface EditorInvocation {
	readonly command: string
	readonly args: string[]
}

export type SpawnFn = typeof spawn
export type StatFn = typeof statSync

export interface EditorInjection {
	readonly spawn: SpawnFn
	readonly stat: StatFn
}

const defaultInjection: EditorInjection = { spawn, stat: statSync }

const PLATFORM_DEFAULTS: Readonly<Partial<Record<NodeJS.Platform, EditorInvocation>>> = {
	darwin: { command: "open", args: ["-t"] },
	linux: { command: "vi", args: [] },
	win32: { command: "notepad.exe", args: [] },
}

const POSIX_FALLBACK: EditorInvocation = { command: "vi", args: [] }

export function pickEditor(env: NodeJS.ProcessEnv = process.env): EditorInvocation {
	const visual = env.VISUAL
	if (typeof visual === "string" && visual.trim().length > 0) {
		return parseCommandString(visual)
	}
	const editor = env.EDITOR
	if (typeof editor === "string" && editor.trim().length > 0) {
		return parseCommandString(editor)
	}
	return PLATFORM_DEFAULTS[process.platform] ?? POSIX_FALLBACK
}

function parseCommandString(value: string): EditorInvocation {
	const parts = value.trim().split(/\s+/)
	const command = parts[0] ?? "vi"
	return { command, args: parts.slice(1) }
}

export async function openInEditor(
	filePath: string,
	injection: EditorInjection = defaultInjection,
): Promise<EditorResult> {
	const { command, args } = pickEditor()
	const before = injection.stat(filePath)
	const beforeMtimeMs = before.mtimeMs
	const startMs = Date.now()

	const child = injection.spawn(command, [...args, filePath], {
		stdio: "inherit",
		shell: false,
	})

	const exitCode: number | null = await new Promise((resolve, reject) => {
		child.on("exit", (code) => resolve(code))
		child.on("error", reject)
	})

	const after = injection.stat(filePath)
	const durationMs = Date.now() - startMs
	const afterMtimeMs = after.mtimeMs

	return {
		saved: afterMtimeMs > beforeMtimeMs,
		exitCode,
		durationMs,
		beforeMtimeMs,
		afterMtimeMs,
	}
}
