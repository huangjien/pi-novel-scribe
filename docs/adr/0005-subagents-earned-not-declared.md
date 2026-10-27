# ADR-0005: Subagents earned by measured need, not declared up front

**Status:** Accepted
**Date:** 2026-09-13
**Author:** pi-novel-scribe (grilling session Q11)

## Context

The architecture review §5 lists 9 subagents across the 5 agents
(Planner: Snowflake Specialist, Arc Designer, Scene Planner; Writer:
Dialogue Specialist, Description Specialist; Critic: Story/Character/
Pacing/Prose; Continuity: Fact Checker). §5 itself adds: _"Subagents
should only be introduced when they provide meaningful isolation or
quality improvement."_

We considered:

- **A. Pre-build every §5 subagent.** Faithful to review §5, lots of
  code, slow feedback loop.
- **B. One Critic, segmented output.** Single LLM call with `category`
  field per issue; subagents split out only when measured bottleneck.
- **C. Parallel fanout.** Always run all 4 critics in parallel.
- **D. Monolithic Critic forever.** No subagents, ever.

We chose B (Q11).

## Decision

**The shipped extension pre-declares ONLY its 5 agents** (Director,
Planner, Writer, Critic, Continuity). Subagents are **earned by measured
need**:

- A subagent is added only when an objective measurement shows the
  parent's segmented approach is the bottleneck on output quality (e.g.,
  Critic's `category: pacing` issues are systematically less calibrated
  than other categories).
- The first candidate subagent is **Story Critic** (split out from
  Critic if/when Critic's issue-segmentation is measured to be the
  bottleneck). It will exist as a stand-alone LLM call with a narrower
  prompt and a Story-craft rubric.
- Each subagent has the same shape as its parent (TS module + markdown
  prompt + tool calls) — there's no special "subagent primitive."

## Consequences

**Easier:**

- The shipped extension has 5 agents + 1 LLM call each, not 14.
  Smaller surface area, faster to ship, easier to test.
- Quality gating forces a measurement pass before adding complexity —
  prevents "we have these because the review said so" dead code.
- Prompts can be split out without refactoring the parent — the
  parent's prompt just sheds the section now living in the subagent.
- Subagent authorship is local: whoever adds the subagent owns the
  quality eval that motivated it.

**Harder:**

- Quality eval instrumentation is non-trivial. We need reproducible
  measurements of issue-segmentation quality before committing to a
  subagent split. Until then we don't know if a subagent helps.
- The decision criterion ("objectively measured bottleneck") is fuzzy
  in practice. Engineers may either over-eagerly split (premature
  complexity) or never split (latent quality issue no one fixes).
- The route.yaml's `primary: writer` doesn't expose "writer's
  subagents" — if/when subagents appear, route.yaml may need a new
  field like `primary_subagents: [...]`.
- Reviewers of v1 may push back: "where is the §5 Snowflake
  Specialist?" Answer: earned, not declared. Document this in
  reviewer notes.

**Rejected alternatives:**

- A: maximum upfront cost; risk of building subagents that don't pay
  off in practice; violates §5's own rule about measured isolation.
- C (always-fanout): identical quality ceiling to B but 4× cost per
  review. Until measured, unjustifiable.
- D: eliminates the option entirely. We don't know if subagents help
  for fiction; locking that out before measuring is dogmatic.

## Compliance

The implementation must:

1. Ship with **only 5 agents** in `extensions/agents/`. No
   pre-declared subagents.
2. The `extensions/quality-eval/` directory (skeleton) exists for
   per-category issue calibration. Skeleton, not implementation, by
   Phase 2; becomes load-bearing before any subagent split.
3. When a subagent is added, the ADR must reference
   `extensions/quality-eval/<category>.md` showing the bottleneck
   evidence.
4. The Director's system prompt explicitly states: _"Subagents are
   earned, not pre-declared. New subagents require measured evidence of
   improvement."_
5. Review §5 is preserved as-is in the architecture review; its list is
   a **roadmap**, not a spec. The Update Log captures this.
