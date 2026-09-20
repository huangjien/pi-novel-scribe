# ADR-0008: Wiki-first context — reference corpus as mandatory prompt context

**Status:** Accepted
**Date:** 2026-09-20
**Authors:** pi-novel-scribe (user request)
**Decisions:** Q21 (packet-level injection), Q22 (mandatory `template_refs`), Q23 (session-scoped cache)
**Amends:** ADR-0006 §6 (integration stance — "a tool, not an agent" stays, but "opportunistic support" becomes "mandatory context")

## Context

ADR-0006 shipped the wiki as a loosely-coupled support tool: `wiki_search` rides
the `support` list of 4 routes, called in parallel, with a dispatch guideline
("read picks before drafting"). Utilization is therefore **opportunistic**:

- The three context composers (`context.ts`, `plan-context.ts`, `critic-context.ts`)
  never touch the wiki — `SceneContext`, `PlanRequest`, `CriticContext` carry zero
  wiki material.
- No prompt template (`prompts/*.md`) mentions the wiki.
- Whether picks influence a draft is left entirely to LLM discretion.

User requirement: **heavily utilize wiki content** — utilization must be
guaranteed by structure, not encouraged by suggestion.

## Decision

### 1. Wiki references enter every context packet (Q21)

New pure function in `extensions/wiki/context.ts`:

```ts
function composeWikiReferences(
  querySources: WikiQuerySources,
  options: { tables, topN, rerank, language },
): Promise<WikiResult | null>   // null on db-missing / budget-exhausted, never throws
```

Queries are **derived by the extension** from packet data — no LLM builds queries:

| Packet | Query source (deterministic) | Tables |
|---|---|---|
| `PlanRequest` (Planner) | active story-line objectives + character roles + premise | `scene_templates`, `story_lines` |
| `SceneContext` (Writer) | scene plan `purpose + conflict + advances_lines` kinds + POV role | `scene_templates`, `character_templates` |
| `CriticContext` (Critic) | the plan's `template_refs` (Q22) + scene tone | `writing_patterns`, `scene_templates` |

Each composer gains a `wikiReferences: WikiResult | null` field. Q7 (deterministic
composition) is preserved: query derivation is code; the single LLM rerank call
remains content judgment per global rule 5.

**Degradation rule:** wiki failure (db missing, FTS error, budget exhausted)
yields `wikiReferences: null` + a warning line in the packet — writing is never
blocked by the wiki.

### 2. Plans must cite templates (Q22)

The Planner's `plan:` block gains, per scene:

```yaml
template_refs:
  - { table: scene_templates, id: "17", how_used: "beat skeleton for the reveal" }
```

`template_refs` becomes an **authored scene field** (Q12 split). A plan with
zero `template_refs` is valid only with an explicit `template_refs_exempt: true`
and a rationale — silence is invalid. This makes corpus grounding auditable in
review (`/novel review` can diff plan refs vs. Critic packet refs).

### 3. Writer drafts against cited beats

The Writer prompt template gains a **Reference templates** section: beats from
cited `scene_templates` are the default rhythm; deviations are allowed but must
stay consistent with the plan's `purpose/conflict/turn`. (en + zh prompts)

### 4. Critic issues may carry `pattern_ref`

The 5-field Critic issue schema gains an optional 6th field
`pattern_ref: { table, id }` — grounding an issue in a `writing_patterns` row
when one applies. Issues citing patterns take precedence in severity triage.

### 5. Cost & determinism controls (Q23)

- **Session-scoped cache** (Q23 locked): in-process map in
  `extensions/wiki/cache.ts`, keyed by `(query, tables, topN, db-mtime)`.
  Cache hit → no rerank call. **The novel repo is never written** — the
  cache lives only for the session lifetime; a restart re-reranks (bounded:
  ≤3 calls per packet). Keeps the author-owned repo free of
  extension-internal cache artifacts, consistent with ADR-0001's
  extension/novel-repo separation.
- **Rerank budget:** max 3 LLM rerank calls per packet assembly (one per query
  class); overflow falls back to BM25 order (`reranked: false`).
- **`wiki_search` tool unchanged** — remains available for ad-hoc queries
  (`inspect_novel_state`, author-driven lookups).

### 6. What does NOT change

- Wiki stays a tool, not an agent (ADR-0005 upheld).
- Wiki stays read-only, cross-project, and **never a canon source** — a wiki
  template influencing prose changes nothing until the CanonChange pipeline
  (§4 of BUSINESS-LOGIC) says so. Hard rule #1 untouched.
- Embedding retrieval stays a v0.2 candidate (ADR-0006 §7).

## Implementation impact (post-acceptance)

| File | Change |
|---|---|
| `extensions/wiki/context.ts` | new — `composeWikiReferences` + query derivation |
| `extensions/novel/{context,plan-context,critic-context}.ts` | + `wikiReferences` field |
| `extensions/novel/schemas.ts` | Scene gains authored `template_refs`; Critic issue gains optional `pattern_ref` |
| `extensions/agents/{planner,writer,critic}.ts` | validate/emit the new fields |
| `prompts/{en,zh}/{planner,writer,critic}.md` | Reference-templates sections |
| `extensions/i18n/strings/{en,zh}.ts` | new strings (degradation warning, budget notice) |
| `config/route.yaml` | support-list comments updated (packet-level guarantee, tool = ad-hoc) |
| `extensions/wiki/cache.ts` | new — session-scoped in-memory cache (no repo writes) |
| tests | packet wiki injection, citation gate, cache hit/invalidation, degradation paths |

## Consequences

**Positive**
- Utilization becomes structural: every plan/draft/review packet carries corpus
  matches; the LLM cannot skip them.
- Plans become auditable against the corpus (`template_refs` diff).
- Critic critique gains verifiable grounding (`pattern_ref`).
- Cost bounded: ≤3 rerank calls per packet, cached within the session.
- Novel repo stays clean — no cache artifacts written (Q23).

**Negative**
- Packet assembly gains an async dependency (mitigated: null-degradation rule).
- Rerank cost repeats across sessions (session-scoped cache — bounded at
  ≤3 calls per packet assembly).
- Corpus staleness matters more: the wst snapshot is frozen at 2026-08-07;
  stale-template risk now reaches every draft (accept + revisit when wst
  refreshes).

## Alternatives considered

- **Tighter route-level prompting only** (status quo + stronger guidelines) —
  rejected: suggestions don't guarantee utilization.
- **Wiki agent** — rejected per ADR-0005.
- **Embedding retrieval now** — rejected for v0.1 (sparse column, ADR-0006 §7).

## Locked decisions

- **Q21 — packet-level injection.** Wiki references are composed into the
  context packets by the extension itself; agents do not decide whether to
  consult the corpus. (Locked 2026-09-20)
- **Q22 — mandatory `template_refs`.** Plans without template citations are
  invalid unless they carry `template_refs_exempt: true` plus a rationale.
  Silence is invalid. (Locked 2026-09-20)
- **Q23 — session-scoped cache.** No `state/wiki-cache/` in the novel repo;
  the cache is in-process only and dies with the session. The author's repo
  stays free of extension-internal cache artifacts. (Locked 2026-09-20)
