# ADR-0013: v0.4 — prompt improvement (Markdown-only; SQLite deferred)

**Status:** Accepted
**Date:** 2026-09-20
**Authors:** pi-novel-scribe (v0.4 planning)
**Decisions:** Q33 (scope = α Markdown rewrite only), Q34 (5 files in en + zh), Q35 (no new tool/runtime module), Q36 (5 agents all rewritten), Q37 (Phase 15 single phase), Q38 (no SQLite-related decisions this milestone — deferred to v0.5+)

## Context

v0.3 closed at 282/282 tests, Q1–Q32 locked, 12 ADRs accepted. Phase 10 (ADR-0008) introduced wiki-first context, Phase 14 (ADR-0012) added vector rerank, and the v0.2 real-pi smoke against `examples/novel-scribe-demo/` produced usable prose. The next natural concern: how good are the prompts that drive the Writer / Planner / Critic / Continuity / Director today?

A read of the wst SQLite snapshot at `scribe-2026-08-07-authorconsole-restore.db` (the corpus ADR-0006 §1 makes read-only) surfaces 26 rows in the `prompts` table, all `is_public=1`, in `en` + `zh`. The table layout:

| column | type | meaning |
|---|---|---|
| `prompt_key` | TEXT NOT NULL | `system.<domain>.<verb>` |
| `language` | TEXT NOT NULL | `en` / `zh` |
| `content` | TEXT NOT NULL | the prompt body |
| `is_public` | INTEGER | 1 for all shipped rows |
| `(user_id, prompt_key, language)` | UNIQUE | per-user override surface |

Distinct prompt_keys:

- `system.beta.editor` / `.female` / `.male` / `.teenager` (8 rows; persona / voice presets)
- `system.character.convert` (role-card → DB-row)
- `system.pattern.improve` (writing-pattern normalisation)
- `system.scene.convert` (freeform scene → DB-row)
- `system.snowflake.expanded_synopsis` / `.refine` / `.refine_paragraph` / `system.snowflake_page` / `system.snowflake_paragraph` (Snowflake-method workflow)
- `system.story_line.improve` (longest at 3705 / 1583 chars)
- `system.qa.autogen` / `.direct` (QA tasks)

All 26 rows use a recognisable structure: **identity → critical constraints → core objective → procedure → output schema → examples**. The prompts read as a specification, not free prose. They survive translation across 4× length ratios (`zh` ~⅓ of `en`) by relying on structure rather than rhetoric.

The current `prompts/<agent>.md` files in this repo are short, free-prose, and lack explicit anti-patterns / hard constraints. The Writer prompt is 56 lines (the longest), the Continuity prompt is 28 lines. None of them carry the structural discipline of the wst corpus.

User framing (v0.4 scope = α Markdown-only) and the standing "follow your recommendation" interpretation locked the decisions below.

## Decision

### 1. Scope (Q33): Markdown rewrite only

v0.4 rewrites the 5 agent prompt files in `prompts/*.md` (en + zh). **No** `extensions/wiki/prompts.ts` / runtime wst-table query path / new `lookup_wst_prompt` tool this milestone. The wst SQLite corpus is read **once** (during Phase 15 design) to learn the structural template; the rewritten Markdown files are then the single source of truth at runtime, exactly as today.

Rationale: (α) is the cheapest change with the largest immediate payoff on agent output stability. (β) — exposing wst rows as runtime data — was explicitly deferred to v0.5+ (see §6 Consequences).

### 2. Coverage (Q34): 5 files × 2 languages = 10 files

All five agents get both languages: `prompts/{writer,planner,critic,continuity,director}.md` + `prompts/zh/{writer,planner,critic,continuity,director}.md`. The existing `loadAgentPrompt(name, lang)` loader (`extensions/i18n/prompts.ts`) is the single entry point; no signature change.

### 3. Naming (Q35): no code-side wst enumeration

The Markdown files stay at `prompts/<agent>.md`. **No** `extensions/i18n/wstPrompts.ts` runtime module, **no** `prompt_key → Markdown` mapping. The wst corpus informs Phase 15 design but does not bleed into the file layout.

Rationale: a runtime mapping layer would (a) become stale the moment wst renames a key, (b) duplicate information already encoded in `prompts/*.md`, and (c) require a sync convention. Keeping Markdown single-source eliminates all three.

### 4. Per-agent scope (Q36): all five agents rewritten

- `writer.md` (en + zh)
- `planner.md` (en + zh)
- `critic.md` (en + zh)
- `continuity.md` (en + zh)
- `director.md` (en + zh)

Even though Director does not directly drive the vertical — it routes — its prompt shapes how user input becomes `delegate_to_<agent>` calls. Restructuring it yields clearer routing decisions.

### 5. Phase structure (Q37): single Phase 15

v0.4 has one phase: **Phase 15 — prompt improvement**. No Phase 16/17. The original three-phase plan (f3) collapses to a single phase because Q-A eliminated (β-1) and (β-2) from this milestone; only (α) remains.

Phase 15 scope:
1. Read the 26 rows in `prompts` (wst snapshot) to extract the structural template.
2. Design a single shared template (Identity / Critical Constraints / Core Objective / Procedure / Output Schema / Anti-patterns / Examples).
3. Rewrite each `prompts/<agent>.md` to that template, preserving the agent's existing responsibilities but with hard constraints, anti-patterns, and explicit output schema.
4. Mirror zh versions in `prompts/zh/`.
5. Add a `tests/prompts.test.ts` that asserts structural invariants on all 10 files (each prompt has Identity + Constraints + Procedure + Output sections; lengths within bounds).
6. Run `npm run check` + `npm test`. Existing 282 tests must stay green; the structural test must pass.

### 6. Decisions deferred to v0.5+ (Q38)

- `prompts` table ingestion (β-1: wiki-fixture + wiki-eval EVAL_TABLES update)
- `lookup_wst_prompt(prompt_key, language)` tool (β-2: structured `{prompt_key, language, content, source}` return; en→zh silent fallback per ADR-0007)
- Soft-fallback semantics (g2) for missing wst prompt_keys
- `system.<domain>.<verb>` naming reconciliation (Q-C iii deferred to v0.5+ if at all)

These will resurface if / when we want the agent to consult the wst corpus at runtime; for v0.4, Markdown stays the single source of truth.

## Implementation impact

| File | Change |
|---|---|
| `prompts/writer.md` | rewrite (en) |
| `prompts/zh/writer.md` | rewrite (zh) |
| `prompts/planner.md` | rewrite (en) |
| `prompts/zh/planner.md` | rewrite (zh) |
| `prompts/critic.md` | rewrite (en) |
| `prompts/zh/critic.md` | rewrite (zh) |
| `prompts/continuity.md` | rewrite (en) |
| `prompts/zh/continuity.md` | rewrite (zh) |
| `prompts/director.md` | rewrite (en) |
| `prompts/zh/director.md` | rewrite (zh) |
| `tests/prompts.test.ts` | **new** — structural invariant tests on all 10 prompt files |

## Consequences

**Positive**
- Agent output stabilises: every prompt now carries explicit hard constraints and an explicit output schema, so the LLM cannot silently drift.
- The Markdown corpus becomes self-documenting in the same idiom the wst authors use; a future v0.5 ingestion path can map Markdown sections 1:1 onto wst prompt_keys without rewriting content.
- Structural tests catch regressions: if a future prompt edit drops the `## Constraints` section, the test fails.
- Zh versions written together with en versions (not patched later) so the override chain in ADR-0007 keeps working.

**Negative**
- 10 Markdown files all change in one commit — large diff. Mitigated by per-agent sub-todos so the diff is reviewable per agent.
- The new templates are longer than the current ones (the wst rows run 100–3700 chars; current Markdown is shorter). Token cost rises slightly for every agent invocation. Mitigated by keeping each rewrite as short as possible while hitting the structural floor; token cost is bounded by the wst precedent.

## Alternatives considered

- **(a) Rewrite only the 3 vertical agents (writer/planner/critic)** — rejected (e2): inconsistency between Director/Continuity and the vertical, harder to maintain.
- **(b) Add `extensions/i18n/wstPrompts.ts` as a thin fallback layer** — rejected (Q-C iii): stale risk + duplicate-source problem; saved for v0.5+ if at all.
- **(c) Defer the rewrite to ship (β-1) first** — rejected: wst-ingestion is a larger, longer path; (α) is independent and self-contained.

## Open questions to lock

None — all decisions locked in this ADR (status: Proposed, awaiting your review).

## Locked decisions

- **Q33 — v0.4 scope = α Markdown rewrite only.** Read wst `prompts` table once during Phase 15 design; do not expose wst rows at runtime in this milestone. (Locked 2026-09-20)
- **Q34 — 10 files.** All 5 agents × {en, zh} rewritten in Phase 15. Loader entry point (`loadAgentPrompt(name, lang)`) unchanged. (Locked 2026-09-20)
- **Q35 — Markdown stays single source of truth.** No runtime wst enumeration; no `extensions/i18n/wstPrompts.ts` module this milestone. (Locked 2026-09-20)
- **Q36 — all 5 agents rewritten.** writer / planner / critic / continuity / director, each in en + zh. (Locked 2026-09-20)
- **Q37 — single Phase 15.** Three-phase plan (f3) collapses because Q-A eliminates (β-1) + (β-2); only (α) remains. Phase 15 is the only v0.4 phase. (Locked 2026-09-20)
- **Q38 — SQLite deferred to v0.5+.** `prompts` table ingestion, `lookup_wst_prompt` tool, soft-fallback semantics, and `system.<domain>.<verb>` naming are all out of v0.4 scope; they will resurface when the agent needs to consult the wst corpus at runtime. (Locked 2026-09-20)
