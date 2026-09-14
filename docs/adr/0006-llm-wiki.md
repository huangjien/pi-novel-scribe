# ADR-0006: LLM Wiki — cross-project SQLite reference corpus

**Status:** Accepted
**Date:** 2026-09-13
**Authors:** pi-novel-scribe (user request, design via grilling)
**Decisions:** Q17 (wiki path config), Q18 (rerank algorithm)

## Context

pi-novel-scribe is a TypeScript pi extension. Adjacent to it (in the same
workspace) is **wst / NovelScribe**, a Flutter + Python FastAPI novel
platform. The wst FastAPI backend maintains a SQLite DB with a rich
reference corpus — `story_lines`, `character_templates`, `scene_templates`,
`writing_patterns`, `prompts` — used by the backend's own Writer/Critic
agents.

Today those tables live only in dev snapshots
(`novel_harness/data/snapshots/scribe-2026-08-07-authorconsole-restore.db`,
12 MB). The published `sync.db` is empty (Flutter reader sync target,
wrong schema).

**Goal.** Let pi-novel-scribe's Planner/Writer/Critic consult this
reference corpus via a `wiki_search` tool: given a query (chapter plan,
character description, scene intent), return the **top 5 most matched**
reference items, ranked by an LLM.

## Decision

### 1. New module: `extensions/wiki/`

```
extensions/wiki/
  db.ts             # resolveWikiDbPath + openDb (better-sqlite3, sync)
  fts.ts            # FTS5 BM25 candidate retrieval per table
  rerank.ts         # LLM rerank via ctx.model.complete()
  schema.ts         # WikiItem, WikiCandidate, WikiResult types
  index.ts          # searchWiki(dbPath, query, options) → WikiResult
```

Public surface (one entry):

```ts
async function searchWiki(
  ctx: ExtensionContext,
  dbPath: string,
  query: string,
  options: { tables: WikiTable[]; topN: number; rerank: boolean },
): Promise<WikiResult>
```

### 2. New tool: `extensions/tools/wiki-search.ts`

Registered with `pi.registerTool(...)`. Tool name: `wiki_search`.
Parameters (TypeBox):

```ts
{
  query: string,                            // 1+ sentence
  tables: ("story_lines" | "character_templates"
           | "scene_templates" | "writing_patterns"
           | "prompts")[],                  // default: all 5
  topN: number,                             // default: 5, max: 20
  rerank: boolean,                          // default: true
}
```

Tool contract:
1. Resolve `wikiDbPath` from `.pi/settings.json` key `wikiDbPath`,
   fall back to the wst snapshot default
   (`../wst/novel_harness/data/snapshots/scribe-2026-08-07-authorconsole-restore.db`).
2. Run FTS5 BM25 against each requested table's FTS5 virtual table,
   collecting top 15 candidates per table.
3. If `rerank === true`, call `ctx.model.complete()` with a structured
   prompt: input = (query, candidate list with id+title+summary+snippet),
   output = JSON `{ picks: [{ id, rationale }] }` constrained to `topN`.
4. Return `{ candidates, picks, rationale, query }` to the LLM caller.

### 3. Path config (Q17)

`.pi/settings.json` adds a `wikiDbPath` key, sibling of `novelRepo`:

```json
{
  "novelRepo": "../my-novel",
  "wikiDbPath": "/Users/huangjien/workspace/wst/novel_harness/data/snapshots/scribe-2026-08-07-authorconsole-restore.db"
}
```

Resolution order: `wikiDbPath` setting → default snapshot.
**Never** falls back to `sync.db` (wrong schema).

### 4. Rerank algorithm (Q18)

Two-stage:

1. **FTS5 BM25 candidate retrieval** — fast, deterministic, language-aware
   (each table has `*_fts` virtual table + INSERT/UPDATE/DELETE triggers
   keeping it in sync). Done in code; no LLM.
2. **LLM rerank** — one `ctx.model.complete()` call with structured
   output. Picks best `topN` from candidates with one-sentence
   rationale per pick.

Per global rule 5 ("Do not use the LLM for deterministic logic"):
reranking is **content judgment** (which template *thematically* matches
a query), not control flow. Approved.

### 5. Scope (per user pick)

Exposed tables: `story_lines`, `character_templates`, `scene_templates`,
`writing_patterns`, `prompts`. Excluded: `imported_novels`,
`imported_chapters`, `*_index` tables (live novel state lives in the
novel repo per ADR-0001, not in the wiki).

### 6. Where it lives in pi-novel-scribe

The wiki is **a tool, not an agent**. Director routes existing intents
(`plan_chapter`, `write_chapter`, `review_chapter`) to call it as a
support tool when the relevant agent prompt asks for "consider templates."
No new agent, no new slash command (per user pick). `config/route.yaml`
gains no new route.

### 7. Embedding column

`embedding TEXT` column exists in all template tables but is sparse
(0/13 story_lines, 24/49 character_templates). **For v0.1 we ignore it.**
The rerank is BM25 + LLM, not cosine. Embedding support is a v0.2 add
once the wst backend populates the column consistently.

## Consequences

**Positive**
- Reference templates are now reachable from any agent — Writer can
  consult character archetypes; Planner can ground scene designs in
  proven narrative structures; Critic can compare the chapter against
  craft patterns.
- No schema duplication: read-only consumer of wst's existing tables.
- Single tool, single LLM call per search. Cost scales with use, not
  novel size.

**Negative**
- New native dependency (`better-sqlite3`); requires `npm install` to
  rebuild on architecture change (handled by postinstall).
- Wiki is **read-only**. If wst later switches DB engine (Postgres +
  pgvector), this tool needs a rewrite. Mitigated by isolating all SQL
  to `extensions/wiki/`.
- LLM rerank is non-deterministic; two identical queries may return
  different `rationale`. Picks are usually stable; rationale varies.
- Wiki data is **language-mixed** (en + zh rows). Default rerank
  prompt should not assume English; pass language hint when the query
  is short.

## Alternatives considered

- **Embedding cosine rerank** — rejected for v0.1 because embeddings are
  sparsely populated (see §7). FTS5 + LLM works on every row.
- **LLM rerank top N only, no FTS5** — too expensive on `writing_patterns`
  (338 rows × full content).
- **New Wiki agent** — rejected per ADR-0005 ("subagents earned, not
  declared"). The wiki is a tool, not a role.

## Test plan

- `tests/wiki.test.ts`:
  - FTS5 candidate retrieval returns rows ordered by BM25 score
  - `searchWiki` with empty query returns no candidates
  - `searchWiki` with `tables: ["story_lines"]` only queries that table
  - Mocked `ctx.model.complete()` is invoked with structured prompt and
    returns picks; rerank output is parsed correctly
  - Path resolution: `wikiDbPath` setting > snapshot default
  - Malformed rerank output (LLM returns garbage) → graceful error
