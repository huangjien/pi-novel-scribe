# ADR-0003: Substrate-first MVP

**Status:** Accepted
**Date:** 2026-09-13
**Author:** pi-novel-scribe (grilling session Q10)

## Context

The architecture review §26 specifies the MVP as "Agent Registry + Skill
Loader + Basic Novel State + External Editor + /novel write" — five
shipped pieces, several weeks of glue work before any chapter sees
end-to-end prose. Per project engineering principles: _"Grow in working
layers — start from the smallest version that works end to end, then
add each new capability on top of a product that already works."_

We considered:

- **A. Substrate-only.** Extension + `/novel write` + editor + status
  machine. No LLM calls. (Chosen.)
- **B. Substrate + Writer stub.** Above + one LLM call that emits
  prose.
- **C. §26 MVP in full.** All five shipped pieces.
- **D. Phase 0+1+2.** Skeleton + editor + all 5 agents with prompts.

## Decision

The first shipped vertical under pi-novel-scribe is **substrate-only**:

- The extension package loads via `pi -e ./extensions/index.ts`.
- `/novel write` is a registered command.
- The command opens the next chapter file in `$VISUAL`/`$EDITOR`.
- Chapter `status` frontmatter transitions on save/quit.
- No LLM calls. No agents. No skill loader.

Agent prompts (Director, Planner, Writer, Critic, Continuity) are
drafted as **plain Markdown** in `prompts/` from day 1 — they can be
read and iterated independently of TypeScript agent code.

## Consequences

**Easier:**

- The hardest part of the system (substrate) is the first part
  validated. Novel-repo separation, editor roundtrip, status machine,
  chapter frontmatter parsing — all proven before agents exist.
- A working product (`pi -e` + `/novel write` + editor) is shippable in
  half a day. Author can hand-write chapters using the extension as a
  fancy entry point.
- Failure isolation: if Writer produces bad prose later, we know it's
  the agent, not the substrate.
- Agent prompts are reviewable in PRs without TypeScript knowledge.

**Harder:**

- Months may pass before an agent actually writes prose. Mitigation:
  draft agent prompts in parallel with substrate; iterate prompts
  against a hand-written chapter as a baseline.
- "Substrate-only" can drift into "substrate-forever" if the team
  doesn't reserve time for agent work. Mitigation: STATE.md tracks
  Phase 0.5 → Phase 2 boundary explicitly.

**Rejected alternatives:**

- B: ships an LLM call but loses the substrate-only signal. Failure
  becomes multifactorial on first agent bug.
- C: ~weeks of work before the user sees any prose. High risk of
  building a system that no individual has touched working.
- D: agents with no workflow glue — agent personas exist but no
  chapter-authoring experience emerges. Classic parts-without-whole
  trap.

## Compliance

The implementation must:

1. Phase 0.5 acceptance criterion: `pi -e ./extensions/index.ts -p
   "/novel write"` opens the next-chapter file in the user's editor,
   exits the editor cleanly, and updates the chapter `status` to
   `drafted` only on save.
2. No LLM provider imports in Phase 0.5 source. (Skill loader and agent
   module can be stubbed with `throw new Error("Phase 0.5: not yet
   implemented")`.)
3. README documents the substrate-only milestone prominently so
   reviewers don't expect prose generation.
