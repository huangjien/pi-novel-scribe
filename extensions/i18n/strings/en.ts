/**
 * English UI strings — tool descriptions, promptSnippet, promptGuidelines,
 * labels, status display names, and error message templates.
 *
 * Per ADR-0007: tool names stay English (`delegate_to_writer`); these are
 * the **author-facing** strings. Status keys in frontmatter stay English;
 * the display table is for tool output messages.
 */

import type { WorkflowStatus } from "../../workflow/status.ts"

export interface ToolStrings {
	readonly description: string
	readonly promptSnippet: string
	readonly promptGuidelines: readonly string[]
	readonly label: string
}

export const TOOL_STRINGS_EN: Readonly<Record<string, ToolStrings>> = {
	wiki_search: {
		label: "Wiki Search",
		description:
			"Search the reference corpus (story_lines, character_templates, scene_templates, writing_patterns, prompts) for templates thematically aligned with a query. Returns FTS5 candidates and an LLM-reranked top-N with rationale.",
		promptSnippet: "Look up matching reference templates from the LLM wiki.",
		promptGuidelines: [
			"Use wiki_search when a planner/critic needs thematically aligned reference templates for a chapter or character concept.",
			"Always set query to a single sentence describing the chapter plan, character concept, or scene intent.",
			"Top N defaults to 5; raise it (max 20) for broader coverage, lower it for tight top picks.",
			"Tables default to all 5; restrict to one table when you have a narrow question (e.g., only character_templates).",
			"Pass rerank=false only when you want pure FTS5 BM25 results without the LLM call.",
		],
	},
	run_director: {
		label: "Run Director",
		description:
			"Route user input to a workflow via config/route.yaml. Returns the matched intent and primary agent. Phase 2 limitation: throws on no match (LLM fallback is Phase 3+).",
		promptSnippet: "Match user input against route table; returns intent + dispatch plan.",
		promptGuidelines: [
			"Use run_director when the user types /novel and you need to decide which workflow to invoke.",
			"After run_director, the LLM should call delegate_to_<intent> based on the returned intent name.",
			"The dispatch plan's `support` list mixes agent IDs and direct tool names. Bare names like `wiki_search` mean call that tool directly; anything else maps to `delegate_to_<name>`.",
			"Invoke support items in parallel with the primary agent. Read wiki_search picks BEFORE drafting so the chapter is grounded in reference templates.",
		],
	},
	delegate_to_writer: {
		label: "Writer",
		description:
			"Draft prose for a chapter. Reads scene context (Q7) deterministically, calls the LLM with the Writer prompt, writes prose into the chapter file, and transitions status → human_editing.",
		promptSnippet: "Generate chapter prose from the active scene context.",
		promptGuidelines: [
			"Use delegate_to_writer only when the chapter has an approved or provisional plan.",
			"Always set chapter_id (filename or absolute path) so the Writer knows what to draft.",
			"After drafting, the canonical workflow continues to Continuity validation (Phase 5+).",
		],
	},
	delegate_to_planner: {
		label: "Planner",
		description:
			"Generate a chapter plan. Reads novel state, calls the LLM, parses the YAML plan, writes it back to chapter frontmatter, transitions status → planned.",
		promptSnippet: "Generate a chapter plan from novel state.",
		promptGuidelines: [
			"Use delegate_to_planner when the user asks to plan a chapter (route plan_chapter).",
			"Output ONLY a YAML plan block — no preamble, no commentary.",
			"After the plan is written, the user reviews it; only then does /novel write invoke delegate_to_writer.",
		],
	},
	delegate_to_critic: {
		label: "Critic",
		description:
			"Review a chapter. Issues are segmented by `category` (story / character / pacing / prose / foreshadowing / continuity-issue / other) with severity (blocker / high / medium / low / praise). Output written to chapter frontmatter `review:` field.",
		promptSnippet: "Review a chapter and emit categorized issues.",
		promptGuidelines: [
			"Use delegate_to_critic when the user asks for review, critique, or feedback on a chapter (route review_chapter).",
			"Always set chapter_id so the Critic knows which chapter to read.",
			"Output ONLY a YAML review block — no preamble, no commentary.",
		],
	},
	delegate_to_continuity: {
		label: "Continuity",
		description:
			"Canonical consistency queries. Read-only: inspect_novel_state (what does X know), investigate_continuity_break (find divergence), refresh (Phase 5+: writes back beliefs).",
		promptSnippet: "Read novel state, derive beliefs, find contradictions.",
		promptGuidelines: [
			"Use delegate_to_continuity for inspect_novel_state and investigate_continuity_break routes.",
			"Continuity is read-only in Phase 4. Mutation of canonical state goes through canon_propose (Phase 5).",
		],
	},
}

export const STATUS_DISPLAY_EN: Readonly<Record<WorkflowStatus, string>> = {
	planned: "Planned",
	writing: "Writing",
	drafted: "Drafted",
	human_editing: "Human Editing",
	edited: "Edited",
	continuity_check: "Continuity Check",
	reviewing: "Reviewing",
	revision_required: "Revision Required",
	approved: "Approved",
	canonized: "Canonized",
}

export const HELP_TEXT_EN = `Available subcommands:
  /novel write [chapter] [--lang=<en|zh>]  — open the chapter in your editor; mark drafted on save.
  /novel help                              — show this message.
  /novel <anything>                        — LLM tool loop (run_director → delegate_to_<primary>).

Built-in agent tools:
  delegate_to_writer       — drafts prose from scene context (Q7).
  delegate_to_planner      — plan-time intent.
  delegate_to_critic       — review intent.
  delegate_to_continuity   — canon consistency (Phase 4: read-side).
  run_director             — route-table router (ADR-0004).
  canon_propose            — propose a Canon Change (Phase 5).
  canon_approve            — editor-as-gate for a Canon Change draft (Phase 6.6).
  wiki_search              — LLM wiki: pick top-N reference templates (Phase 8).
`

export const ERROR_MESSAGES_EN = {
	wiki_no_model:
		"wiki rerank requires an active model; run inside a pi session with a model bound.",
	wiki_db_missing: (path: string) =>
		`wiki DB not found at ${path}. Set "wikiDbPath" in .pi/settings.json or restore the default snapshot.`,
	editor_no_model: (agent: string) => `${agent}: no active model in this session.`,
	editor_chapter_approved: (agent: string, status: string) =>
		`${agent}: chapter is ${status} — refusing to overwrite approved canon.`,
	editor_no_prose: (agent: string) => `${agent}: LLM produced no prose.`,
	editor_no_yaml_plan: (agent: string) =>
		`${agent}: LLM output had no \`\`\`yaml fenced plan block.`,
	editor_no_yaml_review: (agent: string) =>
		`${agent}: LLM output had no \`\`\`yaml fenced review block.`,
	route_no_match: (input: string) =>
		`run_director: no route matched input "${input.slice(0, 60)}" and LLM fallback is not yet wired (Phase 3+). Add a fallback route to config/route.yaml or wire the LLM classifier.`,
} as const
