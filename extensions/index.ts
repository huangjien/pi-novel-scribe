/**
 * pi-novel-scribe — Extension entry point.
 *
 * Phase 0.5 substrate: `/novel write` opens the next chapter in the
 * user's editor and updates chapter `status: drafted` on save.
 *
 * Phase 2 orchestrator: All other `/novel <cmd>` invocations route via
 * the Director (config/route.yaml). Per ADR-0004 rule
 * `explicit_over_implicit`, named commands (`/novel write`) bypass the
 * router. Ambiguous / fuzzy inputs go through the LLM tool loop.
 *
 * Phase 3: Writer wired end-to-end with the LLM.
 * Phase 4: Continuity read-side wired.
 * Phase 5: P0 schemas + Canon Change lifecycle.
 * Phase 6: workflow transitions + editor-as-gate primitive.
 * Phase 6.5: slash command → LLM tool loop (run_director → delegate_to_<primary>).
 * Phase 6.6: canon_approve tool — editor-as-gate for Canon Changes.
 */

import { resolve } from "node:path"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"
import { registerContinuityAgent } from "./agents/continuity.ts"
import { registerCriticAgent } from "./agents/critic.ts"
import { registerPlannerAgent } from "./agents/planner.ts"
import { registerWriterAgent } from "./agents/writer.ts"
import { handleNovelWrite } from "./commands/novel-write.ts"
import { openApprovalGate } from "./editor/gate.ts"
import { listDraftCanonChanges, proposeCanonChange } from "./novel/canon.ts"
import { applyApprovalFromGate } from "./novel/canon-approval.ts"
import { registerDirectorTool } from "./orchestrator/director.ts"
import { loadRouteTable, matchRoute, type RouteTable } from "./orchestrator/route.ts"
import { resolveNovelRepo } from "./state/path-resolver.ts"
import { registerStatusWidget } from "./tmux/widget.ts"
import { registerWikiSearchTool } from "./tools/wiki-search.ts"

const ROUTE_PATH = "config/route.yaml"

const HELP_TEXT =
	"Available subcommands:\n" +
	"  /novel write [chapter] — open the chapter in your editor; mark drafted on save (Phase 0.5 substrate).\n" +
	"  /novel help             — show this message.\n" +
	"  /novel <anything>       — LLM tool loop (run_director → delegate_to_<primary>).\n" +
	"\nBuilt-in agent tools (Phase 3+: Writer wired, Continuity read-side, others stubbed):\n" +
	"  delegate_to_writer       — drafts prose from scene context (Q7).\n" +
	"  delegate_to_planner      — plan-time intent stub.\n" +
	"  delegate_to_critic       — review intent stub.\n" +
	"  delegate_to_continuity   — canon consistency (Phase 4: read-side).\n" +
	"  run_director             — route-table router (ADR-0004).\n" +
	"  canon_propose            — propose a Canon Change (Phase 5).\n" +
	"  canon_approve            — editor-as-gate for a Canon Change draft (Phase 6.6).\n" +
	"  wiki_search              — LLM wiki: pick top-N reference templates (Phase 8).\n"

export default function (pi: ExtensionAPI): void {
	registerDirectorTool(pi, ROUTE_PATH)
	registerPlannerAgent(pi)
	registerWriterAgent(pi)
	registerCriticAgent(pi)
	registerContinuityAgent(pi)

	// Phase 5: Canon Change propose tool.
	pi.registerTool({
		name: "canon_propose",
		label: "Canon Propose",
		description:
			"Create a Canon Change proposal (.yaml.draft) under state/canon-changes/. Author approval happens via canon_approve (editor-as-gate, Q8).",
		promptSnippet:
			"Propose a structured Canon Change for the Continuity agent to validate and the author to approve.",
		promptGuidelines: [
			"Use canon_propose when the LLM (Writer) emits proposed_state_changes alongside prose.",
			"After canon_propose, the Change awaits Continuity validation + author approval (Phase 6+ workflow).",
		],
		parameters: Type.Object({
			id: Type.String({ description: "Stable change ID (e.g., F-023-ch5)." }),
			kind: Type.String({
				description:
					"One of: character_belief_added | character_belief_revised | world_fact_added | foreshadowing_planted | foreshadowing_revealed | thread_opened | thread_resolved | timeline_event",
			}),
			target: Type.String({
				description: "Subject of the change (character id, location id, etc.).",
			}),
			payload: Type.Record(Type.String(), Type.Unknown(), {
				description: "Structured change body.",
			}),
			rationale: Type.String({ description: "Why this change is canon." }),
			proposed_in_chapter: Type.Number({ description: "Chapter index where proposed." }),
			chapter_file: Type.String({ description: "Path of the source chapter file." }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const p = params as {
				id: string
				kind: string
				target: string
				payload: Record<string, unknown>
				rationale: string
				proposed_in_chapter: number
				chapter_file: string
			}
			const novelRepo = resolveNovelRepo(ctx.cwd).path
			const draftPath = proposeCanonChange(novelRepo, {
				id: p.id,
				kind: p.kind as Parameters<typeof proposeCanonChange>[1]["kind"],
				target: p.target,
				payload: p.payload,
				rationale: p.rationale,
				proposed_in_chapter: p.proposed_in_chapter,
				chapter_file: p.chapter_file,
			})
			return {
				content: [
					{
						type: "text",
						text: `Canon Change proposed: ${p.id} (kind=${p.kind}). Draft at: ${draftPath}.`,
					},
				],
				details: { draftPath, changeId: p.id },
			}
		},
	})

	// Phase 6.6: Canon Change approve tool — editor-as-gate.
	pi.registerTool({
		name: "canon_approve",
		label: "Canon Approve",
		description:
			"Open a Canon Change .yaml.draft in the user's editor (Q8). Save = approve (apply canon). No-change = approve-as-stated. Quit-no-save = rollback (delete draft).",
		promptSnippet:
			"Open a Canon Change draft in $EDITOR so the author can approve, edit, or reject it.",
		promptGuidelines: [
			"Use canon_approve after canon_propose has created a draft and Continuity has validated it.",
			"Author save → promote .yaml.draft → .yaml (status: approved). No-save → delete .draft (rolled-back).",
		],
		parameters: Type.Object({
			change_id: Type.String({ description: "ID of the Canon Change to approve." }),
			approved_in_chapter: Type.Number({
				description: "Chapter where the approval is recorded.",
			}),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const p = params as { change_id: string; approved_in_chapter: number }
			const novelRepo = resolveNovelRepo(ctx.cwd).path
			const drafts = listDraftCanonChanges(novelRepo)
			const target = drafts.find((d) => d.id === p.change_id)
			if (!target) {
				throw new Error(`No Canon Change draft for id=${p.change_id}`)
			}
			const draftPath = `${novelRepo}/state/canon-changes/${p.change_id}.yaml.draft`
			const gate = await openApprovalGate({ filePath: draftPath })
			const result = applyApprovalFromGate(draftPath, p.approved_in_chapter, gate)
			return {
				content: [
					{
						type: "text",
						text: `Canon ${p.change_id}: ${result.outcome}${result.approvedPath ? ` → ${result.approvedPath}` : ""}.`,
					},
				],
				details: result,
			}
		},
	})

	pi.registerCommand("novel", {
		description: "Novel writing commands",
		handler: async (args, ctx) => {
			const trimmed = args.trim()
			const subcommand = trimmed.split(/\s+/)[0] ?? ""

			if (subcommand === "" || subcommand === "help") {
				ctx.ui.notify(HELP_TEXT, "info")
				return
			}

			// ADR-0004 rule `explicit_over_implicit`: explicit /novel write
			// bypasses the LLM tool loop and runs the Phase 0.5 substrate.
			if (subcommand === "write") {
				await handleNovelWrite(ctx)
				return
			}

			// Anything else goes through the LLM tool loop.
			try {
				pi.sendUserMessage(
					`The user invoked: /novel ${trimmed}\nUse the run_director tool with input="${trimmed}" to route this to the right workflow. Then invoke the matched agent's delegate_to_<primary> tool as needed.`,
				)
				return
			} catch {
				// LLM tool loop unavailable (e.g., -p mode). Fall back to the
				// deterministic route-match announcement.
			}

			let table: RouteTable
			try {
				table = loadRouteTable(resolve(ctx.cwd, ROUTE_PATH))
			} catch (err) {
				ctx.ui.notify(`Could not load route table: ${(err as Error).message}`, "error")
				return
			}

			const match = matchRoute(trimmed, table)
			if (!match) {
				ctx.ui.notify(
					`No route matched "${trimmed.slice(0, 60)}". LLM fallback not yet wired (Phase 3+).`,
					"warning",
				)
				return
			}
			ctx.ui.notify(
				`Director matched intent="${match.intent}" (${match.matched_via}: "${match.matched_trigger}") ` +
					`→ primary: ${match.route.agents.primary}, support: [${match.route.agents.support.join(", ") || "none"}].`,
				"info",
			)
		},
	})

	pi.on("session_start", async (_event, ctx) => {
		try {
			const t = loadRouteTable(resolve(ctx.cwd, ROUTE_PATH))
			ctx.ui.notify(`pi-novel-scribe loaded. ${t.routes.length} routes registered.`, "info")
		} catch {
			ctx.ui.notify("pi-novel-scribe loaded (no route table found yet).", "info")
		}
	})

	registerStatusWidget(pi)
	registerWikiSearchTool(pi)
}
