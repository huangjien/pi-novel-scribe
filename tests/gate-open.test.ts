/**
 * Tests for the approval-gate `openApprovalGate` orchestrator
 * (extensions/editor/gate.ts). The gate's `injection` swap lets us
 * test the full happy-path + rollback without spawning a real
 * subprocess.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { openApprovalGate } from "../extensions/editor/gate.ts"
import type { SpawnFn, StatFn } from "../extensions/editor/open.ts"
import { makeNoSaveSpawn, makeSaveSpawn } from "./_helpers/fakeChild.ts"

let tmpDir = ""
let targetPath = ""

beforeEach(() => {
	tmpDir = join(tmpdir(), `gate-open-${Date.now()}-${Math.random().toString(36).slice(2)}`)
	mkdirSync(tmpDir, { recursive: true })
	targetPath = join(tmpDir, "canon-draft.yaml")
	writeFileSync(targetPath, "id: foo\nstatus: validated\n", "utf8")
})

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true })
})

function makeStat(): StatFn {
	return ((p: string) => {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const { statSync } = require("node:fs") as typeof import("node:fs")
		return statSync(p) as never
	}) as StatFn
}

/** A spawn that re-writes the file with identical content (no actual change). */
function makeNoopSaveSpawn(): SpawnFn {
	return ((_cmd: string, args: readonly string[]) => {
		const target = args[args.length - 1]
		if (typeof target === "string") {
			try {
				const original = readFileSync(target, "utf8")
				writeFileSync(target, original, "utf8")
			} catch {
				// ignore
			}
		}
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const { EventEmitter } = require("node:events") as typeof import("node:events")
		const child = new EventEmitter()
		queueMicrotask(() => {
			child.emit("exit", 0)
		})
		return child as never
	}) as unknown as SpawnFn
}

describe("openApprovalGate", () => {
	it("returns `approved` when the spawned editor saved a modified file", async () => {
		const result = await openApprovalGate({
			filePath: targetPath,
			injection: { spawn: makeSaveSpawn(), stat: makeStat() },
		})
		expect(result.outcome).toBe("approved")
		expect(result.saved).toBe(true)
		expect(result.after).not.toBe(result.before)
		expect(existsSync(targetPath)).toBe(true)
	})

	it("returns `approved-as-stated` when the spawned editor saved without changing content", async () => {
		const result = await openApprovalGate({
			filePath: targetPath,
			injection: { spawn: makeNoopSaveSpawn(), stat: makeStat() },
		})
		expect(result.outcome).toBe("approved-as-stated")
	})

	it("returns `rolled-back` when the editor exits without saving", async () => {
		const result = await openApprovalGate({
			filePath: targetPath,
			injection: { spawn: makeNoSaveSpawn(), stat: makeStat() },
		})
		expect(result.outcome).toBe("rolled-back")
		expect(result.saved).toBe(false)
	})

	it("records before/after/duration in the result", async () => {
		const result = await openApprovalGate({
			filePath: targetPath,
			injection: { spawn: makeSaveSpawn(), stat: makeStat() },
		})
		expect(result.before).toContain("status: validated")
		expect(result.after).toContain("Edited body")
		expect(result.durationMs).toBeGreaterThanOrEqual(0)
	})
})
