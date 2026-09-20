# ADR-0011: Multi-chapter `chapters` lives on the tool, not the route

**Status:** Accepted
**Date:** 2026-09-20
**Authors:** pi-novel-scribe (tidy pass after v0.2)
**Decisions:** none new — clarifies the implementation placement of the Q24/Q25 `chapters` parameter

## Context

ADR-0009 ("Multi-chapter planning") locks Q24 (plan-only scope) and Q25
(one LLM call → N plan blocks). It also lists, in §Implementation impact,
the change `config/route.yaml` — `plan_chapter` route: agents …, optional
`params: { chapters: int }`.

That wording is misleading. The `route.yaml` route table has no
`params:` field at all — `params:` on route entries is reserved for
`recursion_caps` overrides (per the Q14 / `recursion_caps_default`
mechanism). The actual implementation landed the `chapters` parameter on
the `delegate_to_planner` tool's TypeBox schema:

```ts
parameters: Type.Object({
  chapter_id: Type.String({...}),
  chapters: Type.Optional(Type.Number({ minimum: 1, maximum: 8, ... })),
  scope: Type.Optional(...),
  language: Type.Optional(...),
}),
```

The Director's LLM is what translates user input like `/novel plan 5`
into the `chapters: 5` tool call — the route table doesn't carry it.

## Decision

The `chapters` parameter is a **tool parameter on `delegate_to_planner`**, not a route configuration. The route table for `plan_chapter` is unchanged from v0.1+.

This decision is a clarification of the implementation placement of the
Q24/Q25 parameter — no new Q-decision is locked here. The semantics are
unchanged from ADR-0009.

## What changes

- **No code change.** The implementation already matches this ADR; the
  patch is documentation-only.
- ADR-0009 §Implementation impact is treated as superseded for the
  `config/route.yaml` row — the rest of that table (planner.ts,
  plan-context.ts, i18n, schemas, tests/) is unchanged.

## Consequences

**Positive**
- Future readers won't be misled into looking for a `params:` block on
  the route that doesn't exist.
- Explicit pointer (`see ADR-0011`) added to STATE.md's "Resolved
  terms" entry so the clarification is discoverable from the project
  status path.

**Negative**
- None (no behaviour change).

## Notes on ADR etiquette

Per the `docs/README.md` footer — "ADRs are append-only — never edit an
issued ADR; supersede it with a new ADR" — this clarification lives as
its own ADR rather than as an edit to ADR-0009. The original ADR-0009
file is left untouched; this ADR is the authoritative reference for
where the `chapters` parameter lives.
