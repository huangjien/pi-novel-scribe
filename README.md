# pi-novel-scribe

> **Pi extension for autonomous long-form novel writing.**
> Status: **v0.1+, v0.2, and v0.3 milestones complete** (14 implementation phases shipped, **282/282 tests passing**). **v0.4 scoped** — Phase 15 prompt improvement: rewrite the 5 agent system prompts (`prompts/*.md` + `prompts/zh/*.md`) using the structural template distilled from the wst SQLite `prompts` corpus (per ADR-0013, Q33–Q38).

A TypeScript [pi](https://pi.dev/) extension that orchestrates five agents
(Director, Planner, Writer, Critic, Continuity) for novel writing. The
extension is stateless across novels; each novel lives in its own
git-managed peer repo (see [ADR-0001](docs/adr/0001-separate-novel-repo.md)).

## What's in this build

v0.1 ships the full vertical — substrate, agents, schemas, workflow engine, and UI adapter:

- **Substrate** — `extensions/index.ts`, `state/path-resolver.ts`, `workflow/status.ts`, `editor/open.ts` + `gate.ts`. No `any`, no inline imports, erasable TypeScript only.
- **Five agents** + a thin **Director** as a `config/route.yaml` router ([ADR-0004](docs/adr/0004-director-route-yaml-router.md)): `Planner` emits `plan:`, `Writer` emits `prose:`, `Critic` emits `review:`, `Continuity` derives reader/character knowledge and refreshes `state/character-beliefs.yaml`. All four invoke pi's `ModelRegistry.complete()` for LLM calls.
- **P0 schemas + Canon Change lifecycle** — `extensions/novel/schemas.ts` (Character, Character Knowledge, Scene, Story Line, Foreshadowing, Unresolved Thread, Timeline Event, Canon Change); `canon.ts` proposes/validates/applies/deprecates `.yaml.draft` files.
- **Workflow engine** — 12-edge transition graph, `requires_state` gate (block deterministic dispatch before the LLM tool loop), `canon_approve` tool wired to the editor gate, resume-on-exit scan on `session_start`.
- **Slash command** — `/novel write` opens the next chapter in `$VISUAL` → `$EDITOR` → platform default. Save = approve, no-save = rollback.
- **Phase 7 tmux UI** — `extensions/tmux/widget.ts` registers a custom widget that surfaces resumable chapters, active story lines, and pending canon drafts. Works in plain pi (no tmux required); tmux layout snippet is opt-in via `docs/phase-7/`.
- **Phase 8 LLM Wiki** — `extensions/wiki/` + `extensions/tools/wiki-search.ts` exposes a `wiki_search` tool that consults the wst NovelScribe reference corpus (story_lines / character_templates / scene_templates / writing_patterns / prompts). FTS5 BM25 candidates → one LLM rerank call → top 5 picks with rationale. `wikiDbPath` in `.pi/settings.json` overrides the snapshot default. Per [ADR-0006](docs/adr/0006-llm-wiki.md).
- **Phase 9 Multilingual (en + zh)** — `extensions/i18n/` + `prompts/zh/*.md` localize tool descriptions, prompt snippets, status display, and error messages; override chain = command flag > chapter frontmatter > settings > auto-detect > fallback; `/novel write --lang=zh`. Per [ADR-0007](docs/adr/0007-multilingual.md).
- **Phase 10 Wiki-first context** — every context packet (Writer / Planner / Critic) deterministically derives a wiki query and injects `wikiReferences` into the LLM prompt; session-scoped rerank cache + budget cap (no novel-repo writes); `Scene.template_refs` are mandatory on plans unless explicitly exempt (Q22, gated by `requires_state`); Critic issues gain an optional `pattern_ref` grounding them in `writing_patterns`. Degrades to `null + warning` when wiki is unavailable — never blocks writing. Per [ADR-0008](docs/adr/0008-wiki-first-context.md).
- **Phase 11 Multi-chapter planning** — `/novel plan --chapters=N` (1–8) batches N successive plan writes into one LLM call; per-block Q22 `template_refs` validation isolates failures (N-1 plans written, failed files untouched); wiki packet computed once for the batch. Per [ADR-0009](docs/adr/0009-multi-chapter-planning.md).
- **Phase 12 Sample novel + CI smoke** — `examples/novel-scribe-demo/` peer fixture (5 chapters, 2 characters, 2 story lines, 1 foreshadowing, 1 thread, 1 timeline event) plus offscreen vitest smoke (`tests/smoke.test.ts`) driving the full planner→writer→critic vertical with mocked ModelRegistry; deterministic, no model secrets, no flake. Per [ADR-0010](docs/adr/0010-sample-novel-and-ci-smoke.md).
## Try it

```bash
# Install dev deps
npm install

# Quality gates
npm run check    # biome check + tsc --noEmit
npm test         # vitest (offline; mocks ModelRegistry)

# Load the extension in pi from the workspace root
pi -e ./extensions/index.ts
```

In pi, type:

```
/novel write
```

The next chapter file opens in your configured editor. Save and exit; the
chapter's `status` frontmatter transitions to `drafted` (or to
`human_editing` once the Writer path runs end-to-end).

## Layout

```
extensions/
  index.ts                       ExtensionAPI default export; registers Director + 5 agents + status widget
  agents/
    director.ts                  thin orchestrator (re-exports registerDirectorTool)
    planner.ts                   writes plan: frontmatter via LLM
    writer.ts                    writes prose: frontmatter via LLM
    critic.ts                    writes review: frontmatter via LLM
    continuity.ts                read + refresh modes (POV-derived knowledge)
  orchestrator/
    director.ts                  registers the Director tool, route-table driven
    route.ts                     loadRouteTable + matchRoute (phrase > keyword > priority)
  novel/
    schemas.ts                   P0 schema interfaces + validators
    canon.ts                     propose/validate/apply/deprecate lifecycle
    canon-approval.ts            gate-decision → ApprovalOutcome
    continuity.ts                parseScenesFromBody, deriveReaderKnowledgeAt, deriveCharacterKnowledgeAt, findDivergences
    continuity-refresh.ts        writes state/character-beliefs.yaml (derived + authored overrides)
    context.ts, plan-context.ts, critic-context.ts   scene-context packets
    resume-scan.ts               chapters/ with non-terminal status
    requires-state.ts            pre-LLM dispatch gates
    yaml-extract.ts              shared YAML fence extractor
  commands/novel-write.ts        /novel write handler
  editor/
    open.ts                      $VISUAL → $EDITOR → platform fallback (Injection type)
    gate.ts                      openApprovalGate + decideOutcome (mtime-based)
  state/path-resolver.ts         novelRepo resolution (Q1 / ADR-0001)
  workflow/
    status.ts                    10-status enum + parseFrontmatter / serializeFrontmatter
    transitions.ts               12-edge graph + canTransition + findPath (BFS)
  tmux/widget.ts                 Phase 7 status widget (works without tmux)
  wiki/
    schema.ts, db.ts (node:sqlite via createRequire)
    fts.ts (FTS5 BM25 candidates), rerank.ts (LLM top-5)
    index.ts (public searchWiki entry)
    cache.ts (ADR-0008: session-scoped rerank cache + budget)
    context.ts (ADR-0008: deterministic query derivation + packet injection)
  tools/wiki-search.ts           pi tool wrapper for wiki_search (tool name; ad-hoc lookups)
config/
  route.yaml                     9 intents (write, plan, review, revise, continue, inspect, investigate, approve, reject)
tests/                           28 vitest spec files (270 tests)
```

## Design docs

| Doc | Purpose |
|---|---|
| [CONTEXT.md](CONTEXT.md) | Canonical glossary of 16 locked architectural terms |
| [.planning/STATE.md](.planning/STATE.md) | Milestone + phase tracker (v0.1+, v0.2, and v0.3 complete; v0.4 scoped — Phase 15 prompt improvement pending) |</oldString>
| [pi-novel-architecture-review.md](pi-novel-architecture-review.md) | Original spec (v0.4 with Update Log) |
| [AGENTS.md](AGENTS.md) | Project guide for agent tools (conventions, rules) |
| [docs/README.md](docs/README.md) | Project-wide doc index |
| [docs/adr/](docs/adr/) | Architecture Decision Records (13 accepted; ADR-0008 amends ADR-0006 §6; ADR-0009 + 0010 cover v0.2; ADR-0012 covers v0.3 Q28–Q32; ADR-0013 covers v0.4 Q33–Q38) |
| [docs/phase-7/README.md](docs/phase-7/README.md) | tmux UI stance + opt-in layout |

## License

MIT
