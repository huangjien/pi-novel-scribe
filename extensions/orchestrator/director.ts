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
import { DEFAULT_LANGUAGE, localizedError, resolveLanguage, toolStrings } from "../i18n/index.ts"
import { loadRouteTable, type MatchResult, matchRoute, type RouteTable } from "./route.ts"

export function registerDirectorTool(pi: ExtensionAPI, routePath: string): RouteTable {
	const absolutePath = resolve(process.cwd(), routePath)
	const table = loadRouteTable(absolutePath)

	pi.registerTool({
		name: "run_director",
		label: toolStrings(DEFAULT_LANGUAGE, "run_director").label,
		description: toolStrings(DEFAULT_LANGUAGE, "run_director").description,
		promptSnippet: toolStrings(DEFAULT_LANGUAGE, "run_director").promptSnippet,
		promptGuidelines: [...toolStrings(DEFAULT_LANGUAGE, "run_director").promptGuidelines],
		parameters: Type.Object({
			input: Type.String({ description: "Raw user input to route." }),
			language: Type.Optional(
				Type.Union([Type.Literal("en"), Type.Literal("zh")], {
					description: "Override the working language for this call.",
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const p = params as { input: string; language?: "en" | "zh" }
			const lang = resolveLanguage(ctx, { flag: p.language, cwd: ctx.cwd })
			const input = p.input
			const match = matchRoute(input, table)
			if (!match) {
				localizedError(lang, "route_no_match", input)
			}
			const plan = dispatchPlan(match, table)
			const text =
				lang === "zh"
					? `调度器匹配：intent="${plan.intent}" via ${plan.matched_via}="${plan.matched_trigger}"。` +
						`主代理：${plan.primary}。支持：[${
							plan.support.join("、") || "无"
						}]。下一步：使用原始输入调用 delegate_to_${plan.primary}。`
					: `Director matched intent="${plan.intent}" via ${plan.matched_via}="${plan.matched_trigger}". ` +
						`Primary agent: ${plan.primary}. Support: [${plan.support.join(", ") || "none"}]. ` +
						`Next: invoke delegate_to_${plan.primary} with the original input.`
			return {
				content: [{ type: "text", text }],
				details: { ...plan, language: lang },
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
