/**
 * Director orchestrator — per ADR-0004 (Q13 + Q16).
 *
 * The Director is a route-table router. It loads config/route.yaml on
 * registration, exposes the table to the tools it registers, and routes
 * user input through deterministic match → dispatch.
 *
 * "LLM fallback" for unmatched inputs is Phase 3+ — for now, "no match"
 * surfaces as a clear error.
 */

import { resolve } from "node:path"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"
import { loadRouteTable, type MatchResult, matchRoute, type RouteTable } from "./route.ts"

export function registerDirectorTool(pi: ExtensionAPI, routePath: string): RouteTable {
	const absolutePath = resolve(process.cwd(), routePath)
	const table = loadRouteTable(absolutePath)

	pi.registerTool({
		name: "run_director",
		label: "Run Director",
		description:
			"Route user input to a workflow via config/route.yaml. Returns the matched intent and primary agent. Phase 2 limitation: throws on no match (LLM fallback is Phase 3+).",
		promptSnippet: "Match user input against route table; returns intent + dispatch plan.",
		promptGuidelines: [
			"Use run_director when the user types /novel and you need to decide which workflow to invoke.",
			"After run_director, the LLM should call delegate_to_<intent> based on the returned intent name.",
		],
		parameters: Type.Object({
			input: Type.String({ description: "Raw user input to route." }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const input = (params as { input: string }).input
			const match = matchRoute(input, table)
			if (!match) {
				throw new Error(
					`run_director: no route matched input "${input.slice(0, 60)}" and LLM fallback is not yet wired (Phase 3+). Add a fallback route to config/route.yaml or wire the LLM classifier.`,
				)
			}
			const plan = dispatchPlan(match, table)
			return {
				content: [
					{
						type: "text",
						text:
							`Director matched intent="${plan.intent}" via ${plan.matched_via}="${plan.matched_trigger}". ` +
							`Primary agent: ${plan.primary}. Support: [${plan.support.join(", ") || "none"}]. ` +
							`Next: invoke delegate_to_${plan.primary} with the original input.`,
					},
				],
				details: plan,
			}
		},
	})

	return table
}

interface DispatchPlan {
	readonly intent: string
	readonly matched_via: string
	readonly matched_trigger: string
	readonly primary: string
	readonly support: readonly string[]
	readonly requires_state: readonly string[]
	readonly transitions_status: readonly string[]
}

function dispatchPlan(match: MatchResult, _table: RouteTable): DispatchPlan {
	return {
		intent: match.route.intent,
		matched_via: match.matched_via,
		matched_trigger: match.matched_trigger,
		primary: match.route.agents.primary,
		support: match.route.agents.support,
		requires_state: match.route.requires_state,
		transitions_status: match.route.transitions_status,
	}
}
