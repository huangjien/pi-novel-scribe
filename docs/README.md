# pi-novel-scribe — docs index

Project documentation. Read top-to-bottom on first contact; jump to a
specific doc only when you know what you're looking for.

## Top-level

| Doc | Audience | Read when |
|---|---|---|
| [README.md](../README.md) | humans (project landing) | You want a 60-second tour. |
| [AGENTS.md](../AGENTS.md) | agent tools (Copilot / Claude / Pi itself) | You need conventions, commands, status table. |
| [CONTEXT.md](../CONTEXT.md) | all | You want the canonical glossary of 16 locked terms. |
| [pi-novel-architecture-review.md](../pi-novel-architecture-review.md) | design reviewers | You want the original spec (v0.4) and the Update Log. |
| [.planning/STATE.md](../.planning/STATE.md) | maintainers | You want milestone + phase + ADR tracking. |

## Architecture Decision Records

ADR directory: [`adr/`](./adr/)

| ADR | Decision | Locks |
|---|---|---|
| [0001](./adr/0001-separate-novel-repo.md) | Separate novel repo | Q1 |
| [0002](./adr/0002-prose-as-source-canon-derived.md) | Prose-as-source, canon-as-derived | Q2 |
| [0003](./adr/0003-substrate-first-mvp.md) | Substrate-first MVP | Q10 |
| [0004](./adr/0004-director-route-yaml-router.md) | Director as `route.yaml` router with LLM fallback | Q13 + Q16 |
| [0005](./adr/0005-subagents-earned-not-declared.md) | Subagents earned, not declared | Q11 |
| [0006](./adr/0006-llm-wiki.md) | LLM Wiki — cross-project SQLite reference corpus | Q17 + Q18 |

Six issued, zero open. Every locked Q-decision traces to an ADR.

## Per-phase

| Phase | Doc |
|---|---|
| Phase 7 — tmux UI | [phase-7/README.md](./phase-7/README.md) |

(Phase 7 is the only phase with its own doc — it's the one with user-facing
opt-in configuration. The other phases ship in `extensions/` and `tests/`
with their conventions captured in `AGENTS.md`.)

## How this doc set fits together

```
README.md               ← humans: 60-second tour
   │
   ├─► AGENTS.md        ← agent tools + humans: conventions, commands, status
   │
   ├─► CONTEXT.md       ← all: 16 locked terms (glossary)
   │
   ├─► pi-novel-architecture-review.md   ← design reviewers: v0.4 + Update Log
   │
   ├─► .planning/STATE.md ← maintainers: phase + ADR tracking
   │
   └─► docs/
         ├─► README.md  (this file)   ← project-wide doc index
         ├─► adr/                      ← 5 ADRs (Q1, Q2, Q10, Q13+Q16, Q11)
         └─► phase-7/                  ← Phase 7 tmux stance + opt-in layout
```

Update `STATE.md` first when milestones change, then mirror the change into
`AGENTS.md` and `README.md`. ADRs are append-only — never edit an issued
ADR; supersede it with a new ADR.
