# ADR-0012: v0.3 — Writer frontmatter safety + embedding retrieval evaluation

**Status:** Accepted
**Date:** 2026-09-20
**Authors:** pi-novel-scribe (v0.3 planning)
**Decisions:** Q28 (scope = writer safety + embedding eval), Q29 (writer fix = frontmatter merge), Q30 (embedding eval = synthesized fixture), Q31 (threshold = tie), Q32 (phase structure = two phases)

## Context

v0.2 shipped Phase 11 (multi-chapter planning) + Phase 12 (sample novel + offscreen smoke + real-pi smoke verification). The real-pi smoke against `examples/novel-scribe-demo/` surfaced a latent bug: the Writer's `writeFileSync` overwrites the chapter file with the LLM's prose only, wiping any pre-existing frontmatter (`chapter:`, `pov:`, `plan:`, `review:`). The unit smoke missed this because the mock LLM never produces frontmatter lines.

The natural next milestone is **harden & extend**: ship the writer bug fix as a correctness-critical patch (the v0.3 correctness thread), and run an evaluation-gated experiment on embedding retrieval — the path forward from ADR-0006 §7 — to either merge vector-rerank into `wiki_search` or document why we don't.

User framing (v0.3 = "harden & extend") and the standing "follow your recommendation" instruction locked the scope and detail decisions as below.

## Decision

### 1. Scope (Q28): writer safety + embedding eval

v0.3 ships two complementary threads:

**(i) Writer frontmatter safety** — the bug surfaced by v0.2's real-pi smoke. Small, correctness-critical, ships first.

**(ii) Embedding retrieval evaluation** — block-scoped spike that:
1. Builds a synthesized SQLite fixture with a hand-crafted populated `embedding` column mirroring realistic wst content shape
2. Compares vector-rerank precision against the current BM25+LLM baseline
3. Merges the vector-rerank path into `wiki_search` only if the eval result clears the Q31 threshold; otherwise the eval result is documented as "vector-rerank not adopted; reason = <eval finding>"

**Defer:** subagent split for Critic (no metric yet), editor roundtrip testing (low value), Continuity reading more domain files (no caller asks for it), CI integration of the real-pi smoke (unit smoke already in CI; promoting the real-pi smoke adds cost + flake).

### 2. Writer fix semantics (Q29): YAML-aware frontmatter merge

The Writer's bug is at `extensions/agents/writer.ts`:

```ts
writeFileSync(scene.chapterPath, finalProse, "utf8")
```

`finalProse` is the LLM's prose output (no frontmatter). The Writer's `writeFileSync` overwrites the entire chapter file, wiping the YAML frontmatter. `applyStatus` then rewrites with only `status:` added back — losing `chapter:`, `pov:`, `plan:`, `review:`.

**Fix:** introduce a `mergeProseIntoChapter(chapterPath, prose)` helper (in `extensions/workflow/status.ts` alongside the existing `applyStatus` / `setStatus` family, or in `extensions/novel/context.ts` next to `composeSceneContext`) that:
1. Reads the existing file
2. Parses the frontmatter (via the js-yaml-based parser already in `extensions/workflow/status.ts` after the Phase 12 fix)
3. Splits off the frontmatter block (preserved as-is)
4. Appends the new prose below `\n---`
5. Writes the merged result

**What this does NOT do:** it does not try to merge prose with the existing body (which is what a multi-revision document needs). v0.3 ships "Writer preserves frontmatter"; multi-revision prose merge is a v0.4+ concern (and arguably the right answer is git history, not code).

### 3. Embedding evaluation methodology (Q30): synthesized fixture

We can't depend on wst populating the `embedding` column on a fixed schedule. Build a synthesized fixture locally:

- Extend `tests/_helpers/wikiFixture.ts` with a second schema fixture that includes a populated `embedding TEXT` column for all 5 wiki tables, populated with deterministic near-relevance vectors (e.g. character-shingle TF-IDF vectors that a real embedding model would produce). Deterministic → reproducible.
- The fixture must support both BM25+LLM rerank (current path) AND cosine-vector rerank (proposed path).
- New `tests/embedding-eval.test.ts` runs both paths against a fixed query set (e.g. 10–20 hand-crafted queries per table) and asserts the comparison result.
- The Wiki integration: add a small `vectorRerankCandidates()` function in `extensions/wiki/rerank.ts` (or a new `extensions/wiki/vector.ts`) that consults the `embedding` column when present and returns cosine-similarity-ranked candidates. Per ADR-0012 §3, *only* if eval passes the Q31 threshold is this path wired into the public `searchWiki` flow.

### 4. Embedding decision threshold (Q31): tie

Vector-rerank must achieve **non-degradation** vs the current BM25+LLM baseline to merge — i.e. precision is not worse on the test fixture, regardless of whether vector-rerank actually wins. Rationale: v0.3's purpose is "maybe we should vector-rank"; an answer "vector-rerank is essentially equivalent, here's the eval number, here's how to swap if you want" is a fine milestone outcome. The current BM25+LLM is already working (Phase 8/10); we don't need to beat it, just need to know when (and when NOT) to use embeddings. The eval result IS the deliverable, even if the merge decision is "don't adopt".

### 5. Phase structure (Q32): two phases

- **Phase 13 — Writer frontmatter safety** (the (i) thread)
- **Phase 14 — Embedding retrieval evaluation + conditional merge** (the (ii) thread)

Rationale: the (i) thread is small and correctness-critical — Phase 13 ships it quickly. The (ii) thread has a conditional outcome (merge or don't based on eval) — Phase 14 keeps it separate so the (i) thread lands regardless of the eval verdict.

## Implementation impact

| File | Change |
|---|---|
| `extensions/agents/writer.ts` | replace `writeFileSync(scene.chapterPath, finalProse)` with `mergeProseIntoChapter(...)` (Phase 13) |
| `extensions/workflow/status.ts` (or `extensions/novel/context.ts`) | new `mergeProseIntoChapter(chapterPath, prose)` helper that parses frontmatter, keeps it intact, appends prose (Phase 13) |
| `tests/tool-writer.test.ts` | add a test that exercises the writer with pre-existing frontmatter (`chapter:`, `pov:`, `plan:`) and asserts all fields are preserved (Phase 13) — unit test that would have caught the bug |
| `extensions/wiki/vector.ts` (new, Phase 14) | optional vector-rerank path consulted when `embedding` column is populated |
| `extensions/wiki/index.ts` | extend `searchWiki` to dispatch to vector rerank when Q31 threshold is met (Phase 14, conditional) |
| `tests/_helpers/wikiFixture.ts` | add a second fixture with populated `embedding` columns (Phase 14) |
| `tests/embedding-eval.test.ts` (new, Phase 14) | run BM25+LLM vs vector-rerank against fixed query set; assert Q31 threshold |

## Consequences

**Positive**
- The latent writer bug is fixed; real-pi smoke results no longer lose frontmatter fields.
- The embedding eval is a contained experiment whose negative result is itself valuable (refusal to adopt is documented, not omitted).
- Phase 13 ships regardless of Phase 14's verdict — the (i) thread is never gated on the eval.
- Vitest remains the eval harness (no extra cost); the synthetic fixture is hermetic (no model calls).

**Negative**
- Embedding eval is bounded by the synthetic fixture's fidelity to real wst content. A "tied" verdict on synthetic data doesn't guarantee a real-data tie. Mitigated by: limit the scope of the merge (only flip the public `searchWiki` path on tie-or-better verdict); treat real-wst evaluation as a v0.4+ quality gate.
- Phase 13's writer fix surfaces a backward-compat wrinkle: the existing tool-writer test mocks pass prose-only because the mocked LLM doesn't produce frontmatter. The new test must exercise pre-existing frontmatter; unit smoke runs unchanged.
- One more thing deferred (Continuity-reading foreshadowing/threads/timeline files). Not blocking — those files are inert right now.

## Alternatives considered

- **(a) Ship Phase 13 only as v0.3, defer embedding eval entirely** — rejected; loses the one open retrieval-rigor thread.
- **(b) Single phase (writer + embedding + merge)** — rejected; too much in one commit; eval conditional outcome mingles with a deterministic fix.
- **(c) Vector-rerank wins the eval — merge unconditionally** — rejected; doesn't allow documenting the "don't adopt" verdict.
- **(d) Continuity files in v0.3** — rejected; no caller asks for the data; would expand scope beyond "harden & extend".

## Open questions to lock

None — all decisions locked in this ADR (status: Proposed, awaiting your review).

## Locked decisions

- **Q28 — v0.3 scope = writer frontmatter safety + embedding retrieval evaluation.** "Harden & extend": (i) correctness fix for the writer bug; (ii) evaluation-gated vector-rerank experiment with documented outcome. (Locked 2026-09-20)
- **Q29 — writer fix = YAML-aware frontmatter merge.** `mergeProseIntoChapter(chapterPath, prose)` reads existing frontmatter via the js-yaml parser already in `extensions/workflow/status.ts`, preserves it intact, appends the LLM prose below `\n---`. No body-merge logic. (Locked 2026-09-20)
- **Q30 — embedding eval = synthesized SQLite fixture.** Extend `tests/_helpers/wikiFixture.ts` with a populated `embedding TEXT` column; new `tests/embedding-eval.test.ts` compares BM25+LLM vs cosine-vector rerank against a fixed 10–20 query set per table. (Locked 2026-09-20)
- **Q31 — embedding threshold = tie.** Vector-rerank merges into the public `searchWiki` path only when its precision is not worse than BM25+LLM on the synthetic fixture. Below-tie = documented as "not adopted; reason = <finding>". (Locked 2026-09-20)
- **Q32 — phase structure = two phases.** Phase 13 = writer frontmatter safety (the (i) thread); Phase 14 = embedding retrieval evaluation + conditional merge (the (ii) thread). (Locked 2026-09-20)
