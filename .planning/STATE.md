# STATE.md — pi-novel-scribe

> **Project state tracker.** Single source of truth for what's locked in,
> what's open, and what comes next. Lives at `.planning/STATE.md` (GSD
> convention).

## Milestone: v0.1+ — Design lock + substrate + agents + schemas + workflow + tmux + wiki + i18n + wiki-first context
**Status:** complete
**Started:** 2026-09-13
**Closed:** 2026-09-20
**Tests:** 270/270 passing

### Implementation phases — all shipped

- [x] Phase 0 — Design review complete (`pi-novel-architecture-review.md` v0.4; Q1–Q16 locked)
- [x] Phase 0.5 — Substrate scaffold: `package.json`, `tsconfig.json`, `biome.json`, `extensions/index.ts`, status state machine, editor primitive, path resolver, 30 tests
- [x] Phase 1 — External editor (`extensions/editor/open.ts` + `gate.ts`; mtime-based decideOutcome)
- [x] Phase 2 — Agent registry + Director as route.yaml router (5 agents + Director; `config/route.yaml` with 9 intents; matchRoute with phrase > keyword priority), +14 tests
- [x] Phase 3 — Writer end-to-end (`composeSceneContext` + LLM `complete()`; writes `prose:` to chapter frontmatter), +13 tests
- [x] Phase 3.5 — Planner end-to-end (`extractYamlBlock` + LLM; writes `plan:` block), +15 tests
- [x] Phase 3.6 — Critic end-to-end (`composeCriticContext` + 5-field issue validation; writes `review:` block), +10 tests
- [x] Phase 4 — Continuity (read-side: parseScenesFromBody, deriveReaderKnowledgeAt, deriveCharacterKnowledgeAt, findDivergences; refresh mode writes `state/character-beliefs.yaml`), +16 tests
- [x] Phase 5 — Novel State (P0 schemas + Canon Change propose/validate/apply/deprecate lifecycle), +12 tests
- [x] Phase 6 — Workflow engine (12-edge transition graph, gate integration, `requires_state` checks, `canon_approve` tool, resume-on-exit scan), +29 tests
- [x] Phase 7 — tmux UI sketch (optional tmux layout + `extensions/tmux/widget.ts` custom widget — works in plain pi without tmux), +7 tests
- [x] Phase 8 — LLM Wiki (`extensions/wiki/` + `extensions/tools/wiki-search.ts`; SQLite consumer of wst NovelScribe reference corpus; FTS5 BM25 + LLM rerank top 5; per ADR-0006; `wikiDbPath` in `.pi/settings.json`), +21 tests
- [x] Phase 9 — Multilingual (en + zh) (`extensions/i18n/` module + `prompts/zh/*.md`; localized tool descriptions / prompts / status display; per ADR-0007; override chain = command flag > chapter frontmatter > settings > auto-detect > fallback; `/novel write --lang=zh`), +27 tests
- [x] Phase 10 — Wiki-first context (per ADR-0008): `extensions/wiki/{cache,context}.ts` add deterministic packet-level injection (Q21) + session-scoped rerank cache + budget (Q23) + Q22 `template_refs` gate; `Scene.template_refs`/`template_refs_exempt` + Critic issue `pattern_ref`; agent prompts consume wikiReferences as the default rhythm; `requires_state` gate enforces Q22; degrades to `null + warning` on wiki failure (never blocks writing)

---

## Milestone: v0.2 — Multi-chapter planning + sample novel + CI smoke
**Status:** complete
**Started:** 2026-09-20
**Closed:** 2026-09-20
**Tests:** 280/280 passing (was 270 pre-v0.2; +10 from multi-plan + smoke tests)

### Implementation phases — all shipped

- [x] Phase 11 — Multi-chapter planning (per ADR-0009): `delegate_to_planner` accepts `chapters=N` (1–8, clamped) for batch planning; single `ctx.modelRegistry.complete()` call returns N plan blocks; per-block Q22 validation isolates failures (N-1 plans written, failed files untouched); `composeBatchPlanRequest` shares novel-wide state once across the batch; wiki packet injected once for the batch. +7 tests in `tests/multi-plan.test.ts`.
- [x] Phase 12 — Sample novel + CI smoke (per ADR-0010): `examples/novel-scribe-demo/` peer fixture (5 chapters, 2 characters, 2 story lines, 1 foreshadowing, 1 thread, 1 timeline event); offscreen vitest smoke in `tests/smoke.test.ts` drives planner→writer→critic with mocked ModelRegistry and asserts file state + frontmatter + wiki degradation path. +3 tests. **Latent v0.1+ fix included:** `extensions/workflow/status.ts` `parseSimpleYaml` and `serializeFrontmatter` rewrote with js-yaml so the writer's `applyStatus` post-write transition no longer mangles the planner's object-valued `plan:` block.
- [x] **Tidy pass (post-v0.2):** ADR-0011 written to clarify that the Q24/Q25 `chapters` parameter lives on the `delegate_to_planner` TypeBox schema, not on the route's `params:` block (supersedes the misleading `config/route.yaml` row in ADR-0009 §Implementation impact). STATE.md "Resolved terms" + Q24/Q25 rows updated to point at ADR-0011. `docs/README.md` ADR index bumped to 11 entries; ADR-0009 + ADR-0010 dropped their stale "Proposed" tags (Accepted during Phase 11/12 but never reflected in the index).

### Locked decisions (architectural)

| # | Decision | Source |
|---|---|---|
| 1 | Separate novel repo, configured path (`novelRepo` config or `.pi/novel-state.yaml` marker) | Q1 / ADR-0001 |
| 2 | Prose-as-source, canon-as-derived. Approved prose is append-only. | Q2 / ADR-0002 |
| 3 | POV-derived character knowledge + authored `character-beliefs.yaml` overrides + authored `world-truth.yaml` | Q3 |
| 4 | Named N-lines per novel; `kind: bright \| dark \| subplot \| red-herring` | Q4 |
| 5 | Inline scene markers in chapter prose, markdown-safe (`@scene id=...`) | Q5 |
| 6 | Character profile = `characters/<id>/profile.yaml` (authored) + `state/character-beliefs.yaml` (derived) | Q6 |
| 7 | Scene context packet composed deterministically by extension, no LLM | Q7 |
| 8 | Approval gates open authored artifact in `$VISUAL`/`$EDITOR`; save = approve/edit, no-change = approve-as-stated, no-save = rollback | Q8 |
| 9 | Workflow `status` lives in chapter frontmatter; `session_start` scans for non-terminal states to offer resume | Q9 |
| 10 | MVP scope: substrate-only first (extension + editor + status), agents later | Q10 / ADR-0003 |
| 11 | Subagents earned by measured need, not declared up front (single Critic LLM w/ `category` field; reviewed before splitting out subagents) | Q11 / ADR-0005 |
| 12 | Scene schema: authored fields (Plan-time intent) vs derived fields (extension extracts after drafting) | Q12 |
| 13 | Workflows are prompt-driven (LLM orchestrates agents dynamically) | Q13 / ADR-0004 |
| 14 | Recursion safety: hybrid — caps in Director prompt + runtime guards at tool-call boundary | Q14 |
| 15 | Skills = multi-file `SKILL.md` (frontmatter + body), on-demand loading, optional `scripts/` + `references/` | Q15 |
| 16 | Director = `config/route.yaml`-based router (modeled on `~/.agents/route.yaml`) with LLM fallback for ambiguous input (refines Q13) | Q16 / ADR-0004 |
| 17 | Wiki DB path: `wikiDbPath` setting → wst snapshot default; never `sync.db` | Q17 / ADR-0006 |
| 18 | Wiki retrieval: FTS5 BM25 candidates + single LLM rerank call (content judgment, not control flow) | Q18 / ADR-0006 |
| 19 | Multilingual en/zh; override chain = command flag > chapter frontmatter > settings > auto-detect > fallback | Q19 / ADR-0007 |
| 20 | Localized surface: tool descriptions, prompt snippets, status display, error messages | Q20 / ADR-0007 |
| 21 | Wiki references composed into context packets by the extension (packet-level injection; agents cannot skip) | Q21 / ADR-0008 |
| 22 | Plans must cite `template_refs`; exemption requires explicit `template_refs_exempt: true` + rationale | Q22 / ADR-0008 |
| 23 | Wiki rerank cache is session-scoped in-process only; novel repo never written for cache | Q23 / ADR-0008 |
| 24 | Multi-chapter scope: `/novel plan --chapters=N` batches plans only; drafting stays single-chapter (author-as-final-authority preserved) | Q24 / ADR-0009 *(placement: ADR-0011)* |
| 25 | Planner batching semantics: one `ctx.modelRegistry.complete()` call returns N plan blocks; extension parses + validates per-block independently | Q25 / ADR-0009 *(placement: ADR-0011)* |
| 26 | Sample novel shape: representative — 5 chapters, 2 characters, 2 story lines, 1 foreshadowing, 1 thread, 1 timeline event, no `wikiDbPath` (intentional degradation) | Q26 / ADR-0010 |
| 27 | CI smoke runner: offscreen vitest with mocked ModelRegistry; no real LLM, no secrets, no flake | Q27 / ADR-0010 |

### ADRs

- [x] ADR-0001: Separate novel repo (Q1)
- [x] ADR-0002: Prose-as-source, canon-as-derived (Q2)
- [x] ADR-0003: Substrate-first MVP (Q10)
- [x] ADR-0004: Director as route.yaml router with LLM fallback (Q13 + Q16)
- [x] ADR-0005: Subagents earned, not declared (Q11)
- [x] ADR-0006: LLM Wiki — cross-project SQLite reference corpus (Q17 + Q18)
- [x] ADR-0007: Multilingual support (Q19 + Q20)
- [x] ADR-0008: Wiki-first context — corpus as mandatory prompt context (Q21 + Q22 + Q23)
- [x] ADR-0009: Multi-chapter planning — scope = plan-only, batching = one LLM call → N plan blocks (Q24 + Q25)
- [x] ADR-0010: Sample novel + CI smoke — representative shape, offscreen vitest runner (Q26 + Q27)
- [x] ADR-0011: Multi-chapter `chapters` lives on the tool, not the route — clarifies ADR-0009 §Implementation impact (no new Q)

### Implementation phases (per review §27, refined by Q10, Q11, Q13, Q15) — all shipped

- [x] Phase 0 — Design review complete (`pi-novel-architecture-review.md` v0.4; Q1–Q16 locked)
- [x] Phase 0.5 — Substrate scaffold: `package.json`, `tsconfig.json`, `biome.json`, `extensions/index.ts`, status state machine, editor primitive, path resolver, 30 tests
- [x] Phase 1 — External editor (`extensions/editor/open.ts` + `gate.ts`; mtime-based decideOutcome)
- [x] Phase 2 — Agent registry + Director as route.yaml router (5 agents + Director; `config/route.yaml` with 9 intents; matchRoute with phrase > keyword priority), +14 tests
- [x] Phase 3 — Writer end-to-end (`composeSceneContext` + LLM `complete()`; writes `prose:` to chapter frontmatter), +13 tests
- [x] Phase 3.5 — Planner end-to-end (`extractYamlBlock` + LLM; writes `plan:` block), +15 tests
- [x] Phase 3.6 — Critic end-to-end (`composeCriticContext` + 5-field issue validation; writes `review:` block), +10 tests
- [x] Phase 4 — Continuity (read-side: parseScenesFromBody, deriveReaderKnowledgeAt, deriveCharacterKnowledgeAt, findDivergences; refresh mode writes `state/character-beliefs.yaml`), +16 tests
- [x] Phase 5 — Novel State (P0 schemas + Canon Change propose/validate/apply/deprecate lifecycle), +12 tests
- [x] Phase 6 — Workflow engine (12-edge transition graph, gate integration, `requires_state` checks, `canon_approve` tool, resume-on-exit scan), +29 tests
- [x] Phase 7 — tmux UI sketch (optional tmux layout + `extensions/tmux/widget.ts` custom widget — works in plain pi without tmux), +7 tests
- [x] Phase 8 — LLM Wiki (`extensions/wiki/` + `extensions/tools/wiki-search.ts`; SQLite consumer of wst NovelScribe reference corpus; FTS5 BM25 + LLM rerank top 5; per ADR-0006; `wikiDbPath` in `.pi/settings.json`), +21 tests
- [x] Phase 9 — Multilingual (en + zh) (`extensions/i18n/` module + `prompts/zh/*.md`; localized tool descriptions / prompts / status display; per ADR-0007; override chain = command flag > chapter frontmatter > settings > auto-detect > fallback; `/novel write --lang=zh`), +27 tests

### Resolved terms (formerly open)

The following were listed as "open" pre-implementation and are now resolved:

- **Scene schema field names + types** — locked in `extensions/novel/schemas.ts` (Q12)
- **Story line schema fields** — `objective / state / next_target / hidden_information / planned_reveal` shipped in `extensions/novel/schemas.ts`
- **Approval-level config location** — `config/route.yaml` per novel repo, overridable
- **Multi-chapter workflows** — shipped in v0.2 Phase 11 (Q24 = plan-only, Q25 = one LLM call → N blocks, ADR-0009); `/novel plan --chapters=N` batches plans with per-block failure isolation; see ADR-0011 for the tool-parameter vs. route-config clarification (supersedes §Implementation impact in ADR-0009)
- **Director's actual prompt template** — wired in `extensions/orchestrator/director.ts`; `prompts/director.md` no longer a placeholder
- **Critic quality eval harness** — `tests/critic-context.test.ts` (10 tests) + `tests/planner.test.ts` (7 tests) cover the schema-validation contract. Subagent split gated on measured need per ADR-0005.
- **Architecture review doc** — Update Log added; v0.4 reflects Q1–Q16 lock state.

### Files (current layout — shipped through Phase 10)

```
pi-novel-scribe/
├── package.json                # pi manifest under "pi" key + scripts (vitest 5, biome 2.5, TS 7)
├── tsconfig.json               # strict, Node strip-only (erasable TS)
├── biome.json                  # format + lint
├── vitest.config.ts            # v8 coverage provider
├── README.md                   # project overview (v0.1+)
├── AGENTS.md                   # agent guide (v0.1+ complete)
├── CONTEXT.md                  # 16 locked terms
├── pi-novel-architecture-review.md  # spec v0.4 + Update Log
├── .planning/STATE.md          # this file (v0.1+ complete; v0.2 scoped)
├── docs/
│   ├── README.md               # doc index
│   └── adr/                    # 8 ADRs (0001–0008 issued; 0009 + 0010 Proposed for v0.2)
├── extensions/
│   ├── index.ts                # ExtensionAPI default export; registers Director + 5 agents + status widget + wiki_search tool
│   ├── commands/novel-write.ts # /novel write handler
│   ├── agents/                 # director, planner, writer, critic, continuity (LLM-driven via ctx.modelRegistry.complete)
│   ├── orchestrator/           # director.ts + route.ts
│   ├── novel/                  # schemas, canon, canon-approval, continuity, continuity-refresh,
│   │                           #   context, plan-context, critic-context, resume-scan,
│   │                           #   requires-state, yaml-extract
│   ├── editor/                 # open.ts, gate.ts
│   ├── i18n/                   # strings/{en,zh}.ts, index.ts, language.ts, resolve.ts
│   ├── state/path-resolver.ts  # novelRepo resolution
│   ├── workflow/               # status.ts, transitions.ts
│   ├── tmux/widget.ts          # Phase 7 status widget
│   ├── wiki/                   # ADR-0006: schema.ts, db.ts (node:sqlite), fts.ts, rerank.ts, index.ts
│   │                           # ADR-0008: cache.ts (session-scoped in-memory cache + budget),
│   │                           #          context.ts (deterministic query derivation + packet injection)
│   └── tools/wiki-search.ts    # pi tool wrapper for the wiki
├── config/route.yaml           # 9 intents (write, plan, review, revise, continue, inspect, investigate, approve, reject)
├── prompts/                    # agent prompt templates (Markdown, en + zh)
├── examples/novel-scribe-demo/  # v0.2 peer fixture (5 chapters + 2 chars + 2 story lines + thread/foreshadow/timeline)
└── tests/                      # 30 vitest spec files (280 tests); _helpers/ has fakePi.ts, fakeChild.ts, wikiFixture.ts
```

---

## Open questions to revisit

1. **Editor roundtrip testing without a real TTY** — currently the editor is injected (`open.ts` accepts an `Injection` type). Test harness substitutes `spawn` + `stat`. Sufficient for unit tests; not exercised against real editors yet.
2. **Subagent split (Q11 / ADR-0005)** — gated on Critic quality metrics. Current Critic ships as a single LLM call with `category` field.
3. **Embedding retrieval (ADR-0006 §7)** — gated on the wst snapshot's `embedding` column being populated (currently 0/13 story_lines, 24/49 character_templates). FTS5 + LLM rerank works on every row today; vector retrieval is a v0.3+ swap.
