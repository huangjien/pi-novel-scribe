# ADR-0009: Multi-chapter planning

**Status:** Accepted
**Date:** 2026-09-20
**Authors:** pi-novel-scribe (v0.2 planning)
**Decisions:** Q24 (scope = plan-only), Q25 (batching semantics = one LLM call → N plan blocks)

## Context

v0.1+ shipped the single-chapter vertical (Phase 10 wiki-first context). The
natural bottleneck for an author outlining an arc is repeating
`/novel plan` per chapter, with no cross-chapter coherence inside the LLM
context. The resolved-terms list in `.planning/STATE.md` explicitly deferred
"multi-chapter workflows" to v0.2.

User framing (v0.2 = "scale & verify") and the standing "follow your
recommendation" instruction locked the scope to planner-side batching
only — prose drafting stays single-chapter to preserve the existing
author-as-final-authority approval gate per chapter.

## Decision

### 1. Scope: plan-only (Q24)

`/novel plan` accepts an optional `--chapters=N` flag (default 1, max 8).
The flag batches N successive plan writes into one user command. Drafting
(`/novel write`), review (`/novel review`), and approval gates remain
single-chapter. Rationale: plans are _author intent_ (Q12), so batching is
safe — author reviews plans collectively, then runs the existing per-
chapter Writer flow. Prose batching would tension the author-as-final-
authority hard rule (one mega-approval vs. per-chapter gates).

### 2. Batching semantics: one LLM call → N plan blocks (Q25)

The extension:

1. Resolves the next N unwritten chapter files (existing helper logic).
2. Composes a single packet that contains the existing PlanRequest
   fields **once** + an enumerated list of chapter stubs (number, title
   hint, line membership) — packet size stays small because the LLM
   output carries the bulk.
3. Makes **one** `ctx.modelRegistry.complete()` call. The LLM returns a
   YAML doc containing N plan blocks (delimited, e.g. by
   `chapters: [ {plan}, {plan}, ... ]`).
4. Parses + validates each block independently (Q22 `template_refs`
   gate runs per block). Failures are reported per-block; the user
   sees which chapters' plans failed and can re-plan just those.

The wiki packet injection (ADR-0008) is computed **once** for the batch
(shared novel-wide state), not per chapter. Same for the existing
planner query derivation.

### 3. What does NOT change

- `/novel write` is unchanged — still single-chapter, one LLM call per
  chapter, single human-editor gate per chapter.
- `/novel review`, `/novel revise`, `/novel continue` are unchanged.
- The wiki-first context (ADR-0008) applies identically to the batched
  packet; no new wiki queries, no new cache/budget concerns.
- ADR-0005 still binds: no new subagents; the planner ships as one LLM
  call whether the user asks for 1 plan or 8.

### 4. Failure model

- **Per-block validation failure**: extension writes the N-1 successful
  plans, surfaces the failed block(s) in the response, leaves the failed
  chapters' files untouched (status stays where it was — usually
  `planned` for missing plans, or untouched if a plan existed and was
  replaced by a bad re-batch). Author re-plans just the failed range.
- **LLM output malformed**: throw — author retries the batch. No
  partial writes.
- **Budget exceeded**: N/A — single LLM call, same cost model as
  today's single-chapter plan.

## Implementation impact

| File                                 | Change                                                                                                                                             |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config/route.yaml`                  | `plan_chapter` route: agents `primary: planner, support: [wiki_search]`, optional `params: { chapters: int }`                                      |
| `extensions/agents/planner.ts`       | extend to accept `chapters` count; build batched packet; parse + validate N blocks; per-block error reporting                                      |
| `extensions/novel/plan-context.ts`   | `composePlanRequest` → `composeBatchPlanRequest(chapters)` returning a packet with `chapters: PlanRequest[]`                                       |
| `extensions/i18n/strings/{en,zh}.ts` | tool description for `delegate_to_planner` mentions `--chapters=N`; new error key for per-block failure summary                                    |
| `extensions/novel/schemas.ts`        | optional: shared `BatchPlanResult` type (successes + per-block failures)                                                                           |
| `tests/`                             | new `tests/multi-plan.test.ts`: per-block failure isolation; N=1 backward compat; Q22 gate runs per block; wiki packet injected once for the batch |

## Consequences

**Positive**
- Authors can outline an arc in one prompt; cross-chapter coherence in
  the LLM's context window.
- Cost: still one LLM call (no worse than today's per-chapter plan cost
  for N=1; better than N individual calls).
- Failure isolation: bad chapter 3 doesn't lose chapters 1, 2, 4–N.
- Reuses every existing gate (Q22, ADR-0008 wiki injection, requires_state).

**Negative**
- Larger LLM context per call (novel state × N chapter stubs).
- The N=8 cap from planner constraints (ADR-0007) carries over as the
  batch cap.
- LLM output parsing is a new failure surface — partial-batch logic
  needs careful testing.

## Alternatives considered

- **Per-chapter loop with shared context** — rejected: N LLM calls,
  N× cost, slower; coherence weaker.
- **Multi-chapter write (Q-B option b)** — rejected: tensions author
  authority; editor-gate complexity (one or N?); deferred to a future
  v0.3 if requested.
- **Streaming partial writes** — rejected: complicates the atomic
  "plan is a contract" model.

## Locked decisions

- **Q24 — plan-only scope.** `/novel plan --chapters=N` batches plans;
  drafting stays single-chapter. (Locked 2026-09-20)
- **Q25 — one LLM call → N plan blocks.** Extension makes a single
  registry.complete() call; per-block validation runs independently;
  failures surface per-block, not as full-batch abort. (Locked 2026-09-20)
