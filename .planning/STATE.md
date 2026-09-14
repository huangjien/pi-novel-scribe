# STATE.md — pi-novel-scribe

> **Project state tracker.** Single source of truth for what's locked in,
> what's open, and what comes next. Lives at `.planning/STATE.md` (GSD
> convention).

## Milestone: v0.1 — Design lock + substrate scaffold + all phases shipped
**Status:** complete
**Started:** 2026-09-13
**Closed:** 2026-09-13
**Tests:** 149/149 passing

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

### ADRs

- [x] ADR-0001: Separate novel repo (Q1)
- [x] ADR-0002: Prose-as-source, canon-as-derived (Q2)
- [x] ADR-0003: Substrate-first MVP (Q10)
- [x] ADR-0004: Director as route.yaml router with LLM fallback (Q13 + Q16)
- [x] ADR-0005: Subagents earned, not declared (Q11)

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
- **Multi-chapter workflows** — deferred (still on roadmap for v0.2)
- **Director's actual prompt template** — wired in `extensions/orchestrator/director.ts`; `prompts/director.md` no longer a placeholder
- **Critic quality eval harness** — `tests/critic-context.test.ts` (10 tests) + `tests/planner.test.ts` (7 tests) cover the schema-validation contract. Subagent split gated on measured need per ADR-0005.
- **Architecture review doc** — Update Log added; v0.4 reflects Q1–Q16 lock state.

### Files (current layout — shipped)

```
pi-novel-scribe/
├── package.json                # pi manifest under "pi" key + scripts
├── tsconfig.json               # strict, Node strip-only (erasable TS)
├── biome.json                  # format + lint
├── README.md                   # project overview (v0.1)
├── AGENTS.md                   # agent guide (v0.1 complete)
├── CONTEXT.md                  # 16 locked terms
├── pi-novel-architecture-review.md  # spec v0.4 + Update Log
├── .planning/STATE.md          # this file (v0.1 complete)
├── extensions/
│   ├── index.ts                # ExtensionAPI default export; registers Director + 5 agents + status widget
│   ├── agents/                 # director, planner, writer, critic, continuity
│   ├── orchestrator/           # director.ts + route.ts
│   ├── novel/                  # schemas, canon, canon-approval, continuity, continuity-refresh,
│   │                           #   context, plan-context, critic-context, resume-scan,
│   │                           #   requires-state, yaml-extract
│   ├── commands/novel-write.ts # /novel write handler
│   ├── editor/                 # open.ts, gate.ts
│   ├── state/path-resolver.ts  # novelRepo resolution
│   ├── workflow/               # status.ts, transitions.ts
│   └── tmux/widget.ts          # Phase 7 status widget
├── config/route.yaml           # 9 intents
└── tests/                      # 15 vitest spec files (149 tests)
```

---

## Open questions to revisit

1. **Sample/example novel repo** under `examples/` for end-to-end testing — still useful for CI smoke runs. Deferred until after a real novel use.
2. **Editor roundtrip testing without a real TTY** — currently the editor is injected (`open.ts` accepts an `Injection` type). Test harness substitutes `spawn` + `stat`. Sufficient for unit tests; not exercised against real editors yet.
3. **Subagent split (Q11 / ADR-0005)** — gated on Critic quality metrics. Current Critic ships as a single LLM call with `category` field.
