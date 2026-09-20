# ADR-0010: Sample novel + CI smoke

**Status:** Accepted
**Date:** 2026-09-20
**Authors:** pi-novel-scribe (v0.2 planning)
**Decisions:** Q26 (sample shape = representative), Q27 (smoke runner = offscreen vitest)

## Context

v0.1+ shipped 10 phases and 270/270 tests, but the open-questions list in
`.planning/STATE.md` still flags: "Sample/example novel repo under
`examples/` for end-to-end testing — still useful for CI smoke runs.
Deferred until after a real novel use."

The "real novel use" condition was satisfied during Phase 10 verification
(this session exercised the design across multiple turns with real
author intent). v0.2 is the natural moment to close that gap: ship a
small but representative sample novel + a CI smoke that exercises the
end-to-end vertical on every PR.

User framing (v0.2 = "scale & verify") and the standing "follow your
recommendation" instruction locked the shape and runner as below.

## Decision

### 1. Sample novel shape: representative (Q26)

Lives at `examples/novel-scribe-demo/` (git-tracked fixture; small).

Contents:

- 5 chapter files (`0001.md`–`0005.md`), all in terminal status
  (`approved` or `canonized`) so they can be the input to any smoke
  test that wants existing prose context.
- 2 character profiles (`characters/sara/profile.yaml`,
  `characters/john/profile.yaml`) with realistic voice/psychology.
- 2 story lines (`story/story-lines.yaml`) — one bright
  (`sara-investigation`), one dark (`the-watcher`).
- 1 foreshadowing, 1 unresolved thread, 1 timeline event — enough
  entities that Continuity-derive paths have real input.
- `.pi/settings.json` with `novelRepo: ./` (relative — the smoke can
  resolve from `examples/novel-scribe-demo/.pi/settings.json`).
- No `wikiDbPath` set — sample runs intentionally hit the wiki
  degradation path (so the smoke covers the ADR-0008 null + warning
  behavior).

This is **not** a real novel; it's the smallest corpus that exercises
single-chapter write/review, multi-chapter batch (ADR-0009), the
requires_state gate, the wiki degradation path, and Continuity
derivation across chapters. Smaller than this (e.g. 1 chapter) would
miss cross-chapter bugs. Larger (e.g. 12 chapters / full arc) is
overkill and slows the smoke.

### 2. CI smoke runner: offscreen vitest-only (Q27)

A new vitest file `tests/smoke.test.ts` that:

- Points at `examples/novel-scribe-demo/` (resolves via the same
  `resolveNovelRepo` helper used in production).
- Drives the existing slash commands via the agent tool entry points
  (`delegate_to_planner`, `delegate_to_writer`, etc.) with a mocked
  `ctx.modelRegistry.complete()` — **no real LLM call**, no model
  secrets, no network, no flake.
- Asserts the chapter files end in expected statuses (e.g. after a
  full write→review→approve cycle on chapter 1) and that `plan:` /
  `prose:` / `review:` frontmatter blocks are present and parseable.
- Lives behind a `describe.skip` guard removed by a `SMOKE=1` env var
  only if/when we add real-LLM CI later — but the offscreen suite runs
  unconditionally.

The smoke is intentionally **not** a `pi -e ./extensions/index.ts`
subprocess spawn — that would require a model binding, introduce
flakiness, and slow CI. The offscreen vitest approach reuses the
existing test harness (which already mocks ModelRegistry for every
agent test), so it costs ~50ms extra in CI and is deterministic.

### 3. What does NOT change

- The wiki packet injection (ADR-0008) is unchanged — the sample
  intentionally exercises the degradation path to keep that branch
  covered.
- The novel repo separation (ADR-0001) is unchanged — the sample is a
  *peer* repo under `examples/`, not part of the extension's source.
- The agent registry (ADR-0005) is unchanged — no new agents for
  the smoke; it drives existing tool entry points.

## Implementation impact

| File | Change |
|---|---|
| `examples/novel-scribe-demo/` | new fixture (git-tracked): 5 chapter files, 2 character profiles, 2 story lines, foreshadowing/thread/timeline entries, `.pi/settings.json` |
| `tests/smoke.test.ts` | new: end-to-end vertical smoke (write → review → approve) on `examples/novel-scribe-demo/`, mocked LLM |
| `vitest.config.ts` | (optional) widen the test include glob if `examples/` is excluded; add an alias for the demo repo path |
| `.gitignore` | (optional) ignore nothing in `examples/` — sample is source of truth for the smoke |

## Consequences

**Positive**
- CI catches integration bugs the unit tests miss (e.g. frontmatter
  round-trip across real chapter files; novel-repo resolution from a
  sibling directory).
- Sample novel doubles as a manual-test target for human users trying
  out the extension locally.
- Zero added CI cost (offscreen vitest; mocked LLM; small fixture).
- Wiki degradation path stays covered (sample omits wikiDbPath).

**Negative**
- Sample fixture needs maintenance: when an agent's output shape
  changes, the fixture's expected `prose:` / `plan:` / `review:` blocks
  may need updates.
- "Real novel use" gating no longer applies — this is a sample, not
  real prose; the smoke asserts shape, not quality.

## Alternatives considered

- **Real pi subprocess smoke** — rejected: requires model secrets in
  CI; introduces flake; slow.
- **Bigger sample (full arc, 12 chapters)** — rejected: overkill for a
  smoke; slows CI; bigger maintenance burden.
- **Minimal sample (1 chapter)** — rejected: misses cross-chapter
  bugs; doesn't exercise the ADR-0009 multi-chapter batch.

## Locked decisions

- **Q26 — representative shape.** `examples/novel-scribe-demo/` with
  5 chapters, 2 characters, 2 story lines, 1 foreshadowing, 1 thread,
  1 timeline event, no `wikiDbPath`. (Locked 2026-09-20)
- **Q27 — offscreen vitest smoke.** `tests/smoke.test.ts` drives the
  full vertical on the sample with mocked ModelRegistry; no real
  LLM, no secrets, no flake. (Locked 2026-09-20)
