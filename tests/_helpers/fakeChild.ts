/**
 * Test helper — fake `child_process.spawn` that emits `exit` synchronously.
 * `openInEditor` waits on `child.on("exit", ...)`; without `exit` ever firing,
 * tests hang forever. We return a minimal EventEmitter-shaped object and
 * emit `exit` with code 0 immediately after the spawn call.
 */

import { EventEmitter } from "node:events"
import { writeFileSync } from "node:fs"
import type { SpawnFn } from "../../extensions/editor/open.ts"

/** A spawn mock that saves the target file then exits cleanly. */
export function makeSaveSpawn(): SpawnFn {
	return ((_cmd: string, args: readonly string[]) => {
		const target = args[args.length - 1]
		if (typeof target === "string") {
			try {
				writeFileSync(target, "Edited body from editor.\n", "utf8")
			} catch {
				// ignore — tests may pass a path that doesn't exist yet
			}
		}
		return makeFakeChild(0) as never
	}) as unknown as SpawnFn
}

/** A spawn mock that emits `exit` without touching the file. */
export function makeNoSaveSpawn(): SpawnFn {
	return (() => makeFakeChild(0) as never) as unknown as SpawnFn
}

function makeFakeChild(exitCode: number): EventEmitter {
	const child = new EventEmitter()
	queueMicrotask(() => {
		child.emit("exit", exitCode)
	})
	return child
}
