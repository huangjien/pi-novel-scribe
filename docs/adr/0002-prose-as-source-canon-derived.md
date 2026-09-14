# ADR-0002: Prose-as-source, canon-as-derived

**Status:** Accepted
**Date:** 2026-09-13
**Author:** pi-novel-scribe (grilling session Q2)

## Context

We need to decide what "canon" means in pi-novel-scribe. The architecture
review §8 says canon is "approved state changes, never auto-promoted
from Writer drafts." §9 distinguishes manuscript and canon as two
valuable historical artifacts. Yet §10's pacing analysis treats prose as
the word-count source, and finding B (`Character knowledge separate from
truth`) seems to require explicit structured facts.

We considered:

- **A. State changes only.** Canon = structured YAML entries; prose is
  byproduct.
- **B. Prose only.** Canon = approved chapter prose; facts extracted by
  Continuity.
- **C. Both, dual-tracked.** Author maintains prose and state in
  parallel; risk of drift.
- **D. Prose-as-source, canon-as-derived.** (Chosen.)

## Decision

**Approved prose is the single source of truth for canon.** Any fact a
reader can treat as true is derivable from the set of approved chapters
they have read.

- Approved prose is **append-only**: from the moment a chapter's
  `status` becomes `approved`, the extension refuses in-place edits.
  Revisions create new chapter versions, never overwrite.
- Authored state lives only where prose is awkward to query (planning
  metadata, intentional foreshadowing commitments, pre-written
  pre-prose facts). All these are clearly marked as `authored`, not
  canon.
- Character knowledge, world truth, foreshadowing state, etc. are
  derived — never authored — by re-running Continuity against the
  approved prose at regeneration time.

## Consequences

**Easier:**

- One source of truth (the prose). No drift between prose and canon.
- Continuous validation: re-running Continuity against the same prose
  produces the same canon.
- Reader's knowledge at chapter N = "facts mentioned in any approved
  chapter ≤ N." No store to maintain.
- Pre-prose authored facts (planned-but-not-yet-written) are isolated
  and clearly marked, so they don't accidentally become canon.

**Harder:**

- Approved prose cannot be edited in place. Authors wanting to revise
  must use a "rewrite as new chapter" workflow that preserves history.
- Parsing prose to extract facts is brittle — inline annotations
  (`<!-- fact:... -->`) become a maintenance concern if the author is
  lazy about them.
- Long novels may become slow to re-derive (full re-scan of approved
  prose on each Continuity run). Mitigation: cache derived canon, only
  re-scan changed chapters.

**Rejected alternatives:**

- A (state changes only): forces a structured "fact table" that must
  be kept in sync with prose. Drift city for long novels.
- B (prose only, derived facts): close, but doesn't carve out the
  small authored-state space for things prose can't express (planned
  facts, intentional commitments). A novelist with a planned twist can't
  author the plan before writing the reveal.

## Compliance

The implementation must:

1. Refuse to edit approved prose in place (write to a new chapter file
   with a version suffix if revision is needed).
2. Tag all derived state as `derived: true` with provenance pointing
   at the source chapter.
3. Authored state files must contain a top-level `authored: true` field
   so they can't be confused with derived canon.
4. Continuity runs must be **idempotent** — running twice with no
   prose change produces the same derived canon.
