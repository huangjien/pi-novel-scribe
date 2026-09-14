# AGENTS.md — pi-novel-scribe

> **Project guide for agent tools.** Canonical entrypoint — there is no `CLAUDE.md`.
> Built as a [pi](https://pi.dev/) extension (TypeScript) for long-form novel writing.
> Global orchestrator at `~/.agents/AGENTS.md` (symlinked as `~/AGENTS.md`).

## Project at a glance

- **Name:** pi-novel-scribe — Pi extension for autonomous long-form novel writing
- **Runtime:** [Pi](https://github.com/earendil-works/pi) v0.85+ (Mario Zechner / badlogic)
- **Language:** TypeScript (erasable syntax only — see [Conventions](#conventions))
- **Status:** v0.1 milestone **complete** — `pi-novel-architecture-review.md` v0.4 with Q1–Q16 locked, all 7 implementation phases shipped (Phase 0.5 substrate → Phase 7 tmux UI sketch), 149/149 tests passing.
- **Primary principle:** Pi is the runtime; the extension provides novel-specific orchestration. The author remains the final authority on canon.

## Where to look

| Need | Read |
|---|---|
| **Design decisions, schemas, workflows, agent contracts** | [pi-novel-architecture-review.md](./pi-novel-architecture-review.md) — the spec |
| **Pi extension API, events, tools, commands** | [pi docs: extensions](https://pi.dev/docs/extensions) · [packages](https://pi.dev/docs/packages) · [skills](https://pi.dev/docs/skills) |
| **Global orchestrator** (Major + 7 specialists) | `~/.agents/AGENTS.md` |
| **Global engineering rules** | `~/.copilot/copilot-instructions.md` |

---

## Commands

Run from repo root unless noted.

```bash
# Develop
npm install                                     # install deps (in this repo)
npm run typecheck                               # tsc --noEmit
npm run lint                                    # biome check
npm run format                                  # biome format --write
npm run check                                   # lint + typecheck (matches pi convention)

# Try the extension locally without installing
pi -e ./extensions/index.ts                     # load extension from cwd

# Try a single skill / prompt
pi --skill ./skills/snowflake
pi -e ./extensions/index.ts -p "/novel write"

# Install as a pi package (project-local, after trust)
pi install ./                                   # add to .pi/settings.json
pi install ./ -l                                # explicit project-local install

# Distribute
npm pack                                        # build tarball for `pi install npm:./pkg.tgz`
```

> `npm run check` (lint + typecheck) is the quality gate before marking work done; `npm test` is the regression gate. Both must be clean (exit 0) before any phase is marked complete.

---

## Architecture (1-minute summary)

Full detail in [pi-novel-architecture-review.md](./pi-novel-architecture-review.md). The vertical:

```
Author → Director → Planner → Writer → Human Editor (($VISUAL || $EDITOR))
                    → Critic / Continuity / Canon update → Author approval
```

| Layer | Responsibility | Lives in |
|---|---|---|
| **Director** | Thin orchestrator — interprets intent, picks workflow, delegates | `extensions/agents/director.ts` |
| **Planner** | Structure: premise → snowflake → arc → chapter → scene plans | `extensions/agents/planner.ts` |
| **Writer** | Prose; emits `manuscript + proposed_state_changes` | `extensions/agents/writer.ts` |
| **Critic** | Actionable issues: plot, character, pacing, prose, foreshadowing | `extensions/agents/critic.ts` |
| **Continuity** | Canon authority: facts, timeline, character knowledge, threads | `extensions/agents/continuity.ts` |
| **Subagents** | Narrow specialists (Snowflake Specialist, Scene Planner, Dialogue Specialist, Fact Checker, …) | `extensions/subagents/` |
| **Skills** | Reusable writing methodologies loaded on demand | `skills/<name>/SKILL.md` |
| **Novel State** | Durable canonical information (characters, world, story, chapters, foreshadowing) | The user's novel repo, not this one |
| **External editor** | `$VISUAL` → `$EDITOR` → platform default; awaited, before/after diff | `extensions/editor/` |
| **Workflows** | Resumable state machines exposed as slash commands | `extensions/workflow/` |

Slash commands (MVP): `/novel plan`, `/novel write`, `/novel review`, `/novel revise`, `/novel continue`.

### Five hard design rules

These are non-negotiable. Violating any of them breaks the system.

1. **The author is the final authority on canon.** Writers propose; Continuity validates; the author approves. Never auto-promote a Writer-generated fact to canon. (§8)
2. **Character knowledge ≠ world truth.** Model `fact.truth` separately from `knowledge.{character, reader}` so mystery / dark-line stories stay coherent. (§B in review)
3. **The Writer consumes an approved plan.** Provisional plans are allowed but explicit. Never let the Writer reshape structure while drafting. (§E)
4. **Story Lines track information, not just events.** Bright line + dark line each carry `truth`, `who_knows`, `what_reader_suspects`, `planned_reveal`. (§C, §10)
5. **Scene is first-class.** `Novel → Major Arc → Arc → Chapter → Scene → (Beat)`. Beats can wait; Scenes cannot. (§D)

---

## Layout (planned)

```
pi-novel-scribe/
├── package.json                # pi extension manifest under "pi" key
├── tsconfig.json               # strict, Node strip-only (erasable TS)
├── biome.json                  # lint + format
│
├── extensions/                 # pi auto-loads from this convention dir
│   ├── index.ts                # ExtensionAPI default export; registers tools/commands
│   ├── agents/
│   │   ├── director.ts
│   │   ├── planner.ts
│   │   ├── writer.ts
│   │   ├── critic.ts
│   │   └── continuity.ts
│   ├── subagents/
│   ├── editor/                 # $VISUAL/$EDITOR integration + before/after diff
│   ├── workflow/               # /novel plan|write|review|revise state machines
│   └── tools/                  # novel_state_read, novel_state_write, canon_propose, …
│
├── skills/                     # on-demand methodologies (SKILL.md each)
│   ├── snowflake/
│   ├── story-arc/
│   ├── scene-design/
│   ├── character-arc/
│   ├── show-dont-tell/
│   ├── dialogue/
│   ├── foreshadowing/
│   ├── pacing/
│   ├── cliffhanger/
│   ├── continuity/
│   ├── prose-review/
│   └── rewrite/
│
├── prompts/                    # slash templates (/novel-plan, /novel-review, …)
│   ├── director.md
│   ├── planner.md
│   ├── writer.md
│   ├── critic.md
│   └── continuity.md
│
├── schemas/                    # JSON Schema for novel-state contracts
│   ├── character.schema.json
│   ├── scene.schema.json
│   ├── storyline.schema.json
│   ├── foreshadowing.schema.json
│   └── canon-change.schema.json
│
├── tests/
│   └── …                       # vitest; mock ctx.modelRegistry for offline runs
│
└── docs/
    └── adr/                    # Architecture Decision Records (split from review doc as we ship)
```

> **Layout is the recommended shape**, not carved in stone. The architecture review's §24 / §26 / §29 list the P0 implementation priorities: **Novel State schemas, Character Knowledge model, Scene model, Story Line model** before everything else. Don't add files for layers that don't have a spec yet.

---

## Conventions

### Pi extension conventions (mandatory)

- **Erasable TypeScript only.** No `enum`, no `namespace`, no `parameter properties`, no `import =`, no `export =`. Node strip-only mode. Use `StringEnum` from `@earendil-works/pi-ai` for string unions (Google API compatibility).
- **No `any`.** If you can't type it, narrow the source.
- **No inline imports.** `await import()` is forbidden. Top-level imports only.
- **Check `node_modules` for external API types** — never guess pi-ai / pi-coding-agent / typebox signatures.
- **Truncate tool output.** Use `truncateHead` / `truncateTail` from `@earendil-works/pi-coding-agent`. Default `DEFAULT_MAX_BYTES` (50KB) and `DEFAULT_MAX_LINES` (2000). On truncation, write full output to a temp file and tell the LLM where to find it.
- **File mutations must queue.** Use `withFileMutationQueue(absolutePath, async () => …)` from `@earendil-works/pi-coding-agent` so custom tools don't race with the built-in `edit` / `write` in parallel tool mode. Pass the resolved absolute path (`resolve(ctx.cwd, params.path)` then `realpath`).
- **Tools signal errors by throwing**, not by returning `{ isError: true }`. Throw → caught → `isError: true` on the result.
- **Persisted state belongs in tool `details`**, not in module-level closures. Reconstruct from `ctx.sessionManager.getBranch()` on `session_start` for branch-correct session restore.
- **Output is free-form prose; planning/review/state-changes are structured YAML.** Match §19 of the review.
- **Register custom tools with `promptSnippet`** (one-line description in the `Available tools` section) and **`promptGuidelines` with the tool name in every bullet** (LLMs cannot tell which tool "this" means otherwise).
- **Async factories are fine**; `pi` awaits them before `session_start`. But don't start background processes / sockets / file watchers from the factory — defer to `session_start`.
- **For pi packages, list core pi deps in `peerDependencies`** with `"*"` range (`@earendil-works/pi-ai`, `pi-agent-core`, `pi-coding-agent`, `pi-tui`, `typebox`). Third-party pi packages go in `dependencies` + `bundledDependencies`.

### Project conventions

- **Spec → Task → Code.** Read the relevant section of [pi-novel-architecture-review.md](./pi-novel-architecture-review.md) before writing files. The review is the spec. ADR-only changes get recorded in `docs/adr/`.
- **One responsibility per agent / subagent.** The Director must stay thin (no prose, no canonical logic, no reviews). §20.
- **No silent canon mutations.** Every writer → continuity proposal goes through `extensions/tools/canon_propose.ts`, never through `write` / `edit` directly.
- **State changes are explicit and reversible.** Canon states: `idea → draft → proposed → validated → approved/canon`. Possible: `deprecated`, `contradicted`. (§8)
- **Workflows are resumable.** States: `created → planning → planned → writing → drafted → human_editing → edited → continuity_check → reviewing → revision_required → approved → canonized`. Pi exiting during `human_editing` must not lose work. (§18)
- **Human approval levels** (configurable per novel repo):
  - `0` automatic — read state, generate draft, generate review
  - `1` notify — open editor
  - `2` ask — proposed canon change
  - `3` explicit approval — major storyline change, replace substantial existing prose, delete established canon (§15)
- **Recursion limits are mandatory.** Every delegated operation carries `max_agent_depth`, `max_subagents`, `max_iterations`, `max_tokens`, `max_time`. The Director must eventually require human judgment. (§22)
- **Don't duplicate what the novel repo will own.** This extension is stateless across novels — the novel repository holds `world/`, `characters/`, `story/`, `chapters/`, `reviews/`, `state/`. Don't import novel data into the extension; use the configured `novelRepo` path.
- **Git is infrastructure, not the domain model.** Novel repos are Git-friendly, but versioning logic lives in Novel State (semantic), not in git (historical). (§9, §H)

### Engineering rules (inherited from global)

These come from `~/.copilot/copilot-instructions.md` and apply unless this file overrides them:

- **Surgical changes.** Touch only what the request requires. Match existing style.
- **Read before writing.** Search for existing utilities before adding new ones. Extend, don't duplicate.
- **No backward-compat cruft.** When the architecture review changes, remove the old path instead of adding compatibility shims.
- **No ghost code / commented-out blocks.** Git remembers.
- **Deterministic code, not LLM calls.** Retry policies, validation, routing, thresholds, status-code handling stay in normal code. LLM output is for language reasoning, not control flow.
- **Tests assert behavior, not implementation.** Passing tests ≠ correct tests. Read what the assertion actually checks.

---

## Where to start (when implementing)

The architecture review's §29 names the priority order. For Phase 0 (extension skeleton) this is the path of least resistance:

1. **Scaffold the package** — `package.json` with the `pi` manifest, `tsconfig.json` (strict, erasable), `biome.json`, `extensions/index.ts` that registers `/novel write` as a stub command.
2. **Validate local loading** — `pi -e ./extensions/index.ts` from this repo. Confirm `session_start` fires and the command is visible.
3. **Then tackle §29 in order.** Schemas (Novel State, Character Knowledge, Scene, Story Line) before agents. Agent contracts before implementations.

---

## Project status (v0.1 milestone complete)

- ✅ **Phase 0 — Design review complete** (`pi-novel-architecture-review.md` v0.4 + Q1–Q16 locked; CONTEXT.md; 5 ADRs)
- ✅ **Phase 0.5 — Substrate scaffold** (npm scaffold, biome, tsconfig, `extensions/index.ts`, status state machine, editor primitive, path resolver)
- ✅ **Phase 1 — External editor** (`extensions/editor/open.ts` + `gate.ts`; mtime-based decideOutcome)
- ✅ **Phase 2 — Agent registry + Director route.yaml router** (5 agents + Director; `config/route.yaml` with 9 intents; matchRoute with phrase > keyword priority)
- ✅ **Phase 3 — Writer end-to-end** (`extensions/agents/writer.ts`; composeSceneContext; writes `prose:` to chapter frontmatter)
- ✅ **Phase 3.5 — Planner end-to-end** (`extensions/agents/planner.ts`; extractYamlBlock; writes `plan:` block)
- ✅ **Phase 3.6 — Critic end-to-end** (`extensions/agents/critic.ts`; composeCriticContext; 5-field issue validation; writes `review:` block)
- ✅ **Phase 4 — Continuity** (read-side: `extensions/novel/continuity.ts` derives reader/character knowledge; refresh mode writes `state/character-beliefs.yaml`)
- ✅ **Phase 5 — Novel State** (P0 schemas: Character, Character Knowledge, Scene, StoryLine, Foreshadowing, UnresolvedThread, TimelineEvent, CanonChange; canon propose/apply/deprecate lifecycle)
- ✅ **Phase 6 — Workflow engine** (12-edge transition graph, gate integration, `requires_state` checks, `canon_approve` tool, resume-on-exit scan)
- ✅ **Phase 7 — tmux UI** (optional tmux layout + `extensions/tmux/widget.ts` custom widget — works in plain pi without tmux; 7 widget tests)
- ✅ **Phase 8 — LLM Wiki** (`extensions/wiki/` + `extensions/tools/wiki-search.ts`; read-only SQLite consumer of the wst NovelScribe reference corpus; FTS5 BM25 + LLM rerank top 5; per ADR-0006; 21 tests)

> **170/170 tests passing.** See `.planning/STATE.md` for the phase-by-phase decision log and `docs/phase-7/README.md` for the tmux/UI stance.

Track progress in a `STATE.md` once implementation begins.