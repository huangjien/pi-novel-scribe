# ADR-0004: Director as route.yaml router with LLM fallback

**Status:** Accepted
**Date:** 2026-09-13
**Author:** pi-novel-scribe (grilling sessions Q13 + Q16)

## Context

The architecture review §17 names five workflows but underspecifies how
the Director picks them. We considered:

- **A. TypeScript state machines.** Pure TS, deterministic, vitest-able.
- **B. YAML-declarative.** YAML state machines; engine interprets.
- **C. Hybrid: YAML schema + TS handlers.** Best of both, most code.
- **D. Prompt-driven LLM orchestration.** (Chosen initially in Q13.)

We chose D in Q13 (prompt-driven) but immediately surfaced a tension with
review §22 (recursion caps). Q14 fixed the tension with hybrid safety.
User feedback (Q16) proposed the route.yaml pattern from
`~/.agents/route.yaml` as a concrete substrate for D — applying the same
router + workers pattern Major uses for cross-tool agent dispatch.

## Decision

The Director is implemented as a **`config/route.yaml` router** with LLM
fallback. The router walks a static table of intents, matches user
input via keyword / phrase / regex triggers, and dispatches to the
matched intent's primary + support agents. For ambiguous input the
Director falls back to LLM-determined dispatch; for still-ambiguous
input it asks one clarifying question.

The router shape is **adapted from** `~/.agents/route.yaml`, with
novel-specific extensions:

| Field | Purpose |
|---|---|
| `intent` | Stable name (e.g., `write_chapter`). |
| `triggers` | Keywords, phrases, optional regex. |
| `primary` | Main agent for this route. |
| `support` | Optional parallel agents. |
| `priority` | Tie-breaker when multiple routes match. |
| `tier` | Model tier per agent (expensive/balanced/cheap). |
| `requires_state` | Novel-state pre-flight (e.g., chapter must exist). |
| `transitions_status` | Workflow `status` values this route moves through. |
| `recursion_caps` | Per-route override of default caps (Q14). |

Default routes ship with the extension; novel repos override via
`<novelRepo>/.pi/novel-state.yaml`.

## Consequences

**Easier:**

- A single-file inventory of every workflow the extension supports.
- Adding a new workflow = adding a route entry, no code changes.
- Per-workflow limits are declarative (no scattered constants).
- The router is testable as a pure function: input → matched route →
  dispatched agents. The fallback path is testable separately.
- Multi-tenant use: different novels can have different intent sets
  via `.pi/novel-state.yaml` overrides.

**Harder:**

- The router itself is non-trivial code. Hybrid (router + LLM fallback)
  means two code paths: deterministic route matching (fast path) and
  LLM classifier fallback (slow path). Both need test coverage.
- Trigger matching is brittle: phrase lists require curation. Bad
  triggers produce wrong-route matches. Mitigation: ship a
  `route-eval.ts` test harness with sample inputs per route.
- `requires_state` evaluation requires the extension to expose state
  queries to the router — coupling the router to the state machine
  defined in CONTEXT.md.
- Reviewing and tuning the table becomes a maintenance burden over time
  (similar to how route.yaml's 213-line file grows).

**Rejected alternatives:**

- A (TS state machines): preferred in Q12 for typed safety but rejected
  here because the user requested route.yaml semantics (router, not
  state machine). The state machine can still live inside the
  route-handling code, but the *router* is the yaml.
- C (YAML + TS handlers): most expressive but biggest surface area.
  We get most of the benefit of C without the handlers layer by keeping
  state machine implementation inside the route handler functions.

## Compliance

The implementation must:

1. Read `config/route.yaml` on every Director invocation. Hot-reload
   on file change (optional).
2. Match longest-trigger-first; ties broken by `priority` (higher wins).
3. Honor `handle_directly` (greetings, identity, meta) **before**
   attempting route matching.
4. Honor explicit `/novel <cmd>` invocations **before** route matching
   (rule `explicit_over_implicit`).
5. Per-route `requires_state` failures → ask clarifying question with
   the missing condition; do not bypass the gate.
6. Per-route `recursion_caps` override global caps when specified.
7. Per-route `transitions_status` is enforced through the workflow
   machine (CONTEXT.md Q9).
8. `read_only_inspect` routes never write to novel-repo state.
9. Announce dispatch: "Dispatching to {primary} because {matched route}"
   before invoking the agent (rule `no_orphan_delegation`).
