/**
 * Test helper — capture tools registered via `pi.registerTool(spec)`
 * so tests can invoke `spec.execute(...)` directly with a fake ctx.
 *
 * Pi's `ExtensionAPI.registerTool` is typed loosely enough that we
 * can stub it with a small map + a `get(name)` accessor. This keeps
 * the suite honest — we test the **tool body** the agent will
 * execute in production, not a parallel reimplementation.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"

interface CapturedTool {
	readonly spec: Record<string, unknown>
	readonly execute: (...args: unknown[]) => Promise<unknown>
}

/** Result of `makeFakePi()` — satisfies `ExtensionAPI` plus test helpers. */
export interface FakePi extends ExtensionAPI {
	get(name: string): CapturedTool
	has(name: string): boolean
	names(): readonly string[]
}

export function makeFakePi(): FakePi {
	const tools = new Map<string, CapturedTool>()
	const fake = {
		registerTool(spec: Record<string, unknown>) {
			const name = spec.name as string
			if (!name) throw new Error("tool spec missing name")
			tools.set(name, { spec, execute: spec.execute as CapturedTool["execute"] })
		},
		get(name: string): CapturedTool {
			const t = tools.get(name)
			if (!t) throw new Error(`tool ${name} not registered`)
			return t
		},
		has(name: string): boolean {
			return tools.has(name)
		},
		names(): readonly string[] {
			return [...tools.keys()]
		},
	}
	return fake as unknown as FakePi
}

/**
 * Build a fake `ExtensionContext` for tool execute calls. Pass only
 * what the tool under test actually reads; everything else is a stub.
 */
export interface FakeCtxOverrides {
	readonly cwd?: string
	readonly model?: unknown
	readonly modelRegistry?: { complete: (...args: unknown[]) => Promise<unknown> }
	readonly ui?: {
		notify: (msg: string, kind?: string) => void
		setWidget: (...args: unknown[]) => void
	}
	readonly signal?: AbortSignal
}

export function makeFakeCtx(overrides: FakeCtxOverrides = {}): Record<string, unknown> {
	return {
		cwd: overrides.cwd ?? "/tmp",
		model: overrides.model,
		modelRegistry: overrides.modelRegistry,
		ui: overrides.ui ?? {
			notify: () => {},
			setWidget: () => {},
		},
		signal: overrides.signal ?? new AbortController().signal,
	}
}
