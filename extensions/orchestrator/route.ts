/**
 * Route table loader + matcher. Per ADR-0004 (Q13 + Q16), the Director
 * is a route.yaml router with LLM fallback. This module loads
 * config/route.yaml and exposes a deterministic matcher.
 *
 * The Director's LLM path (Phase 3+) handles fallback when this matcher
 * returns null. For Phase 2, "no match" surfaces as a clear error.
 */

import { existsSync, readFileSync } from "node:fs"
import * as yaml from "js-yaml"

export interface RecursionCaps {
	readonly max_agent_depth: number
	readonly max_subagents_per_task: number
	readonly max_iterations: number
	readonly max_tokens_per_call: number
	readonly max_time_seconds: number
}

export interface RouteTrigger {
	readonly keywords: readonly string[]
	readonly phrases: readonly string[]
}

export interface RouteAgents {
	readonly primary: string
	readonly support: readonly string[]
}

export interface Route {
	readonly intent: string
	readonly description: string
	readonly triggers: RouteTrigger
	readonly agents: RouteAgents
	readonly requires_state: readonly string[]
	readonly transitions_status: readonly string[]
	readonly priority: number
}

export interface RouteTable {
	readonly version: number
	readonly routes: readonly Route[]
	readonly fallback: Route | null
	readonly recursion_caps_default: RecursionCaps
}

export interface MatchResult {
	readonly intent: string
	readonly route: Route
	readonly matched_via: "phrase" | "keyword"
	readonly matched_trigger: string
}

export interface FsAdapter {
	existsSync: (path: string) => boolean
	readFileSync: (path: string, encoding: "utf8") => string
}

const defaultFs: FsAdapter = { existsSync, readFileSync }

export function loadRouteTable(filePath: string, fsAdapter: FsAdapter = defaultFs): RouteTable {
	if (!fsAdapter.existsSync(filePath)) {
		throw new Error(`route file not found: ${filePath}`)
	}
	const raw = fsAdapter.readFileSync(filePath, "utf8")
	let parsed: unknown
	try {
		parsed = yaml.load(raw)
	} catch (err) {
		throw new Error(`route file YAML parse error: ${(err as Error).message}`)
	}
	return validateRouteTable(parsed, filePath)
}

export function matchRoute(input: string, table: RouteTable): MatchResult | null {
	const lower = input.toLowerCase().trim()
	if (lower.length === 0) return null

	const phraseMatches: Array<{ result: MatchResult; index: number }> = []
	const keywordMatches: Array<{ result: MatchResult; index: number }> = []

	table.routes.forEach((route, index) => {
		for (const phrase of route.triggers.phrases) {
			if (lower.includes(phrase.toLowerCase())) {
				phraseMatches.push({
					result: { intent: route.intent, route, matched_via: "phrase", matched_trigger: phrase },
					index,
				})
			}
		}
		for (const keyword of route.triggers.keywords) {
			if (lower.includes(keyword.toLowerCase())) {
				keywordMatches.push({
					result: { intent: route.intent, route, matched_via: "keyword", matched_trigger: keyword },
					index,
				})
			}
		}
	})

	const pool =
		phraseMatches.length > 0 ? phraseMatches : keywordMatches.length > 0 ? keywordMatches : null
	if (pool === null || pool.length === 0) return null

	// Within pool: highest priority wins; ties broken by declared order (lower index wins).
	const first = pool[0]
	if (!first) return null
	let best: MatchResult = first.result
	for (const entry of pool) {
		if (entry.result.route.priority > best.route.priority) {
			best = entry.result
		} else if (
			entry.result.route.priority === best.route.priority &&
			entry.index < (pool.findIndex((p) => p.result === best) ?? 0)
		) {
			best = entry.result
		}
	}
	return best
}

function validateRouteTable(value: unknown, source: string): RouteTable {
	if (typeof value !== "object" || value === null) {
		throw new Error(`route file ${source}: top-level must be an object`)
	}
	const obj = value as Record<string, unknown>
	const routesRaw = obj.routes
	if (!Array.isArray(routesRaw)) {
		throw new Error(`route file ${source}: "routes" must be an array`)
	}
	const routes = routesRaw.map((r, i) => validateRoute(r, `${source}::routes[${i}]`))
	const fallbackRaw = obj.fallback
	const fallback = fallbackRaw ? validateRoute(fallbackRaw, `${source}::fallback`) : null
	const capsRaw = obj.recursion_caps_default
	const recursion_caps_default = validateRecursionCaps(
		capsRaw ?? {},
		`${source}::recursion_caps_default`,
	)
	return {
		version: typeof obj.version === "number" ? obj.version : 1,
		routes,
		fallback,
		recursion_caps_default,
	}
}

function validateRoute(value: unknown, path: string): Route {
	if (typeof value !== "object" || value === null) {
		throw new Error(`route ${path}: must be an object`)
	}
	const v = value as Record<string, unknown>
	const intent = stringField(v, "intent", path)
	const description = stringField(v, "description", path)
	const triggersRaw = v.triggers
	const triggers =
		triggersRaw === undefined
			? { keywords: [], phrases: [] }
			: validateTriggers(triggersRaw, `${path}::triggers`)
	const agentsRaw = v.agents
	const agents = validateAgents(agentsRaw, `${path}::agents`)
	const requires_state = stringArrayField(v, "requires_state", path)
	const transitions_status = stringArrayField(v, "transitions_status", path)
	const priorityRaw = v.priority
	const priority = typeof priorityRaw === "number" ? priorityRaw : 50
	return {
		intent,
		description,
		triggers,
		agents,
		requires_state,
		transitions_status,
		priority,
	}
}

function validateTriggers(value: unknown, path: string): RouteTrigger {
	if (typeof value !== "object" || value === null) {
		throw new Error(`triggers ${path}: must be an object`)
	}
	const v = value as Record<string, unknown>
	return {
		keywords: stringArrayField(v, "keywords", path),
		phrases: stringArrayField(v, "phrases", path),
	}
}

function validateAgents(value: unknown, path: string): RouteAgents {
	if (typeof value !== "object" || value === null) {
		throw new Error(`agents ${path}: must be an object`)
	}
	const v = value as Record<string, unknown>
	return {
		primary: stringField(v, "primary", path),
		support: stringArrayField(v, "support", path),
	}
}

function validateRecursionCaps(value: unknown, path: string): RecursionCaps {
	if (typeof value !== "object" || value === null) {
		throw new Error(`recursion_caps ${path}: must be an object`)
	}
	const v = value as Record<string, unknown>
	return {
		max_agent_depth: numberField(v, "max_agent_depth", path, 2),
		max_subagents_per_task: numberField(v, "max_subagents_per_task", path, 4),
		max_iterations: numberField(v, "max_iterations", path, 2),
		max_tokens_per_call: numberField(v, "max_tokens_per_call", path, 8000),
		max_time_seconds: numberField(v, "max_time_seconds", path, 120),
	}
}

function stringField(obj: Record<string, unknown>, key: string, path: string): string {
	const v = obj[key]
	if (typeof v !== "string") {
		throw new Error(`${path}: "${key}" must be a string`)
	}
	return v
}

function stringArrayField(obj: Record<string, unknown>, key: string, path: string): string[] {
	const v = obj[key]
	if (v === undefined) return []
	if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) {
		throw new Error(`${path}: "${key}" must be a string array`)
	}
	return v as string[]
}

function numberField(
	obj: Record<string, unknown>,
	key: string,
	path: string,
	defaultValue: number,
): number {
	const v = obj[key]
	if (v === undefined) return defaultValue
	if (typeof v !== "number") {
		throw new Error(`${path}: "${key}" must be a number`)
	}
	return v
}
