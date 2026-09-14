# Pi Novel Extension — Architecture & Implementation Plan

**Status:** Design Review v0.4 (Decisions Locked Q1–Q16, 2026-09-13)
**Implementation:** v0.1 milestone complete — all 8 phases shipped (Phase 0–8), **205/205 tests passing, 82.64% statement coverage**.
**Last updated:** 2026-09-14
**Target:** Pi Extension
**Domain:** Long-form novel writing
**Primary principle:** Pi is the runtime; the extension provides novel-specific orchestration. The author remains the final authority on canon.

> **Companion docs** (added in v0.4, all decisions live here):
> - [CONTEXT.md](../CONTEXT.md) — canonical glossary of 16 locked terms
> - [STATE.md](../.planning/STATE.md) — milestone + phase tracker (v0.1 complete)
> - [AGENTS.md](../AGENTS.md) — project guide for agents (Tool / workflow contracts)
> - [docs/adr/](../docs/adr/) — 6 ADRs (Q1, Q2, Q10, Q13+Q16, Q11, Q17+Q18)

---

## v0.4 Update Log (2026-09-13)

After v0.3, fifteen decisions were resolved through a grilling session. Each
changed how this review is read. The table below lists every section that
evolved and points at the matching decision in `CONTEXT.md` / `docs/adr/`.

| Section | What changed in v0.4 | Decision |
|---|---|---|
| §5 Subagents | Pre-declared subagent list removed; subagents **earned by measured need**. Ship Critic as one LLM w/ `category` field; split out a Story Critic only when segmentation-by-prompt is provably the bottleneck. | Q11 |
| §6 Skills | Skills live as multi-file `SKILL.md` (frontmatter + body per §6 fixed sections) + optional `scripts/` and `references/`. **On-demand loading** — only `description` in system prompt; body via `/skill:name`. | Q15 |
| §7 Novel State | Novel data lives in a **separate novel repo**, identified via `novelRepo` config or `.pi/novel-state.yaml` marker. The extension is a tool, the novel is a peer project. | Q1 / ADR-0001 |
| §8 Canon Model | **Prose-as-source, canon-as-derived.** Approved prose is append-only; any derivable fact (reader-knowledge, character-state-from-POV, etc.) is re-extractable. Authored state lives only where prose is awkward (planning, intentional commitments, pre-written facts). | Q2 / ADR-0002 |
| §13 Three Information Layers | Reader knowledge is **purely derived** from approved prose. Character knowledge is POV-derived by default with `state/character-beliefs.yaml` overrides; world truth lives in `state/world-truth.yaml` for mysteries and unreliable narration. | Q3 |
| §14 Human Editor | Editor is not just for prose; it's also the **approval gate** (see §15 below). Open authored artifact → save = approve/edit; no-change = approve-as-stated; no-save = rollback. | Q8 |
| §15 Human Approval Levels | Level-2 / Level-3 gates open the relevant authored artifact in `$VISUAL` / `$EDITOR`. Save semantics drive the outcome. Level-1 = session log only. Level-0 = silent. | Q8 |
| §17 Workflow Model | Workflows are **prompt-driven** with a **`config/route.yaml` routing table** (modeled on `~/.agents/route.yaml`). The Director LLM matches input → dispatches via route; LLM fallback for ambiguous input. The LLM picks which route / which agents / which order; the extension provides primitives + safety. | Q13, Q16 |
| §18 Workflow State Machine | Canonical workflow `status` lives in **chapter frontmatter** (`status: planned \| writing \| drafted \| … \| canonized`). On `session_start`, the extension scans chapters for non-terminal statuses and offers to resume. `git log` + session.jsonl are audit-trail only. | Q9 |
| §22 Cost and Recursion Controls | **Hybrid safety**: caps in Director prompt + **runtime guards at tool_call boundary**. Depth tracked via `ctx.sessionManager`. Tool calls exceeding caps return `isError: true` with "max_agent_depth exceeded". | Q14 |
| §25 Finding D — Scene first-class | Scene schema split into **authored intent** (`id, pov, location, time, participants, purpose, conflict, turn, advances_lines`) and **derived facts** (`information_revealed, foreshadowing_planted, emotional_state, word_count, tone`). Planner LLM only emits plan-time fields. | Q12 |
| §25 Finding E — Writer consumes approved plans | Reinforced: Writer never re-plans. Even provisional plans must be tagged as such. | Q1, Q2 |
| §29 Priority list | Original ordering kept as roadmap of design decisions, **plus** Q1–Q16 resolved items now sit as architectural ground truth. New priority: substrate-first MVP (ADR-0003); route.yaml router (ADR-0004); subagents earned (ADR-0005). | ADR-0003, ADR-0004, ADR-0005 |

Sections **not affected by v0.4** (preserved verbatim from v0.3): §1, §2, §3, §9, §10, §11, §12, §16, §19, §20, §21, §23, §24, §26, §27, §28. Where a v0.3 section's text is silent on a v0.4 concern, the `CONTEXT.md` glossary is the source of truth.

---

## 1. Executive Decision

Build a **Pi-native novel-writing extension**, not an IDE and not an MCP platform.

The extension should combine:

- **Agents** — stable creative responsibilities
- **Subagents** — narrowly scoped specialists
- **Skills** — reusable writing methodologies
- **Workflows** — controlled orchestration
- **Novel State** — durable canonical information
- **Human Editor** — system-default external editor
- **Optional tmux** — split-pane presentation

The initial architecture deliberately excludes:

- MCP
- VS Code integration
- custom editor UI
- web UI
- cloud database
- vector database
- large autonomous agent swarm

The first objective is to prove one excellent vertical workflow:

```text
Author
  ↓
Director
  ↓
Planner
  ↓
Writer
  ↓
Human Editor
  ↓
Continuity
  ↓
Critic
  ↓
Author approval
  ↓
Canon update
```

---

# 2. Design Principles

## 2.1 Human remains the author

The system should optimize for **author control**, not maximum automation.

AI may:

- propose
- plan
- draft
- critique
- detect contradictions
- suggest revisions

AI should not silently:

- change established canon
- alter character motivations
- rewrite previous chapters
- advance hidden plot lines
- remove unresolved threads

Consequential changes require an approval policy.

---

## 2.2 Agent, Subagent, and Skill are different abstractions

### Agent = responsibility

Examples:

```text
Director
Planner
Writer
Critic
Continuity
```

### Subagent = specialized worker

Examples:

```text
Snowflake Specialist
Scene Planner
Dialogue Specialist
Pacing Critic
Fact Checker
```

### Skill = reusable methodology

Examples:

```text
Snowflake
Show Don't Tell
Character Arc
Scene Design
Foreshadowing
Pacing
Cliffhanger
Dialogue
```

A Skill should not normally have an independent personality or conversation history.

---

# 3. High-Level Architecture

```text
                         ┌──────────────┐
                         │    Author    │
                         └──────┬───────┘
                                │
                                ▼
                       ┌─────────────────┐
                       │ Director Agent  │
                       └────────┬────────┘
                                │
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                 ▼
        ┌──────────┐      ┌──────────┐      ┌──────────┐
        │ Planner  │      │  Writer  │      │  Critic  │
        │  Agent   │      │  Agent   │      │  Agent   │
        └────┬─────┘      └────┬─────┘      └────┬─────┘
             │                 │                 │
             ▼                 ▼                 ▼
         Subagents         Subagents         Subagents
             │                 │                 │
             └─────────────────┼─────────────────┘
                               ▼
                     ┌──────────────────┐
                     │ Continuity Agent │
                     └────────┬─────────┘
                              │
                              ▼
                       ┌─────────────┐
                       │ Novel State │
                       └──────┬──────┘
                              │
                       ┌──────┴──────┐
                       ▼             ▼
                  System Editor     tmux
                    optional       optional
```

The key boundary is:

> **Agents reason. Skills provide methods. Novel State stores facts. Workflows control transitions. The author approves canon.**

---

# 4. Core Agents

The MVP should contain five Agents.

## 4.1 Director

The Director is the orchestration layer.

Responsibilities:

- interpret author intent
- inspect relevant novel state
- select a workflow
- delegate to other Agents
- decide which Skills are relevant
- decide whether review is necessary
- enforce approval boundaries

The Director should generally **not write final prose**.

---

## 4.2 Planner

Responsibilities:

- premise expansion
- Snowflake planning
- arc planning
- chapter planning
- scene planning
- pacing
- bright/dark storyline progression
- setup/payoff planning

Example output:

```yaml
plan:
  objective: "..."
  conflict: "..."
  emotional_turn: "..."
  scenes:
    - id: S1
      purpose: "..."
    - id: S2
      purpose: "..."
  storyline:
    bright: "..."
    dark: "..."
  foreshadowing:
    - F-023
```

---

## 4.3 Writer

Responsibilities:

- generate prose
- revise prose
- preserve character voice
- obey approved plans
- apply relevant Skills
- avoid inventing canon without flagging it

Writer output should distinguish:

```text
manuscript
+
proposed_state_changes
```

---

## 4.4 Critic

Responsibilities:

- plot coherence
- character consistency
- pacing
- conflict
- prose
- dialogue
- emotional impact
- foreshadowing
- reveal timing

Critic output should be actionable rather than merely numerical.

Preferred format:

```yaml
issues:
  - category: pacing
    severity: high
    evidence: "..."
    impact: "..."
    recommendation: "..."
```

---

## 4.5 Continuity

Continuity is the canonical consistency authority.

Responsibilities:

- character facts
- character relationships
- timeline
- locations
- world rules
- established events
- unresolved threads
- foreshadowing
- knowledge state

Continuity should be conservative:

> If something is not established, it should be treated as unknown rather than invented.

---

# 5. Subagents

Initial set:

```text
Planner
 ├── Snowflake Specialist
 ├── Arc Designer
 └── Scene Planner

Writer
 ├── Dialogue Specialist
 └── Description Specialist

Critic
 ├── Story Critic
 ├── Character Critic
 ├── Pacing Critic
 └── Prose Critic

Continuity
 └── Fact Checker
```

Subagents should only be introduced when they provide meaningful isolation or quality improvement.

### Delegation rules

Every delegation should have:

- parent Agent
- task
- relevant context
- allowed Skills
- expected output schema
- maximum depth
- budget
- timeout

Avoid unrestricted recursive delegation.

---

# 6. Skills

Suggested initial Skills:

```text
skills/
├── snowflake/
├── story-arc/
├── chapter-design/
├── scene-design/
├── character-arc/
├── show-dont-tell/
├── dialogue/
├── foreshadowing/
├── pacing/
├── cliffhanger/
├── continuity/
├── prose-review/
└── rewrite/
```

A Skill should contain:

```text
Purpose
When to use
Inputs
Procedure
Constraints
Output
Failure conditions
Examples
```

Skills should be versioned independently.

Example:

```text
skills/snowflake/SKILL.md
```

The Planner can load the Skill when needed rather than permanently embedding every methodology in its system prompt.

---

# 7. Novel State

For a 2.5-million-word novel, durable Novel State is more important than chat history.

Suggested structure:

```text
novel/
├── novel.yaml
│
├── world/
│   ├── world.md
│   ├── geography.md
│   ├── politics.md
│   └── rules.md
│
├── characters/
│   ├── protagonist.md
│   ├── antagonist.md
│   └── ...
│
├── story/
│   ├── premise.md
│   ├── snowflake.md
│   ├── arcs/
│   ├── story-lines/
│   └── timeline.md
│
├── chapters/
│   ├── 0001.md
│   ├── 0002.md
│   └── ...
│
├── reviews/
│   └── ...
│
└── state/
    ├── current.yaml
    ├── characters.yaml
    ├── unresolved.yaml
    └── foreshadowing.yaml
```

This is a logical model, not yet a final file layout.

---

# 8. Canon Model

This is one of the most important areas requiring explicit design.

Information should have lifecycle states:

```text
idea
  ↓
draft
  ↓
proposed
  ↓
validated
  ↓
approved/canon
```

Potentially:

```text
deprecated
contradicted
```

A Writer-generated fact must not automatically become canon.

Example:

```yaml
state_changes:
  - type: character
    id: protagonist
    changes:
      emotional_state: suspicious
      knowledge_added:
        - antagonist_survived
```

Flow:

```text
Writer
  ↓
Proposed State Change
  ↓
Continuity Agent
  ↓
validation
  ↓
Author/Director approval
  ↓
Canon
```

---

# 9. Novel State Must Be Versionable

The manuscript and canon are both valuable historical artifacts.

Recommended first implementation:

> Keep the project Git-friendly, but do not make Git itself the domain model.

For example:

```text
Chapter 42
 ├── current.md
 └── metadata.yaml
```

Git provides historical revisions.

Novel State provides semantic state.

Do not duplicate all versioning logic inside the Extension unless a real requirement emerges.

---

# 10. Bright Line / Dark Line

Multiple Story Lines should be first-class entities.

Minimum:

```text
story-lines/
├── bright-line.md
└── dark-line.md
```

Possible state:

```yaml
story_lines:
  bright:
    objective: "..."
    current_state: "..."
    next_milestone: "..."

  dark:
    objective: "..."
    hidden_information: "..."
    reveal_stage: "..."
```

The Critic should evaluate:

- bright-line progress
- dark-line progress
- reveal timing
- information asymmetry
- convergence points
- whether a chapter advances neither line

---

# 11. Long-Form Pacing

The planned long-form structure should be represented explicitly.

Target:

```text
Novel
 ├── Major Arc ~300k
 │    ├── milestones ~30k
 │    ├── milestones ~30k
 │    └── major climax
 ├── Major Arc ~300k
 └── ...
```

These are configurable targets, not hard rules.

Pacing analysis can produce:

```yaml
pacing:
  current_word_count: 27400
  next_milestone: 30000
  tension_estimate: 4.2
  target_tension: 7.5
  recommendation: "..."
```

The system must not optimize for word count at the expense of narrative quality.

---

# 12. Context Architecture

A 2.5-million-word manuscript cannot be sent wholesale to every Agent.

Use context packages.

For a Writer working on Chapter 42:

```text
Novel metadata
+
Current major arc
+
Current storyline state
+
Relevant character profiles
+
Relevant world rules
+
Previous chapter summary
+
Current chapter plan
+
Relevant unresolved threads
+
Relevant foreshadowing
```

Avoid:

```text
all previous chapters
```

Context construction should therefore be a first-class subsystem.

---

# 13. Three Information Layers

Separate:

### Session Context

Temporary conversation information.

```text
current Pi session
```

### Novel State

Durable canonical information.

```text
characters
timeline
world
storylines
foreshadowing
```

### Derived Context

Regenerable summaries and retrieval artifacts.

```text
chapter summaries
arc summaries
character summaries
```

Authority:

```text
Novel State > Derived Context > Session Context
```

Derived context may be regenerated.

Session context may be discarded.

---

# 14. Human Editor

The external editor is intentionally simple.

Core primitive:

```text
edit_file(path)
```

Workflow:

```text
Agent
  ↓
prepare file
  ↓
open system editor
  ↓
human edits
  ↓
editor exits
  ↓
re-read file
  ↓
compare before/after
  ↓
continue workflow
```

Editor resolution:

```text
$VISUAL
↓
$EDITOR
↓
platform default
```

Fallback examples:

```text
Windows → notepad
macOS   → TextEdit or configured editor
Linux   → configured terminal editor
```

The process must be awaited.

Before/after content should be compared so the system knows whether the author actually changed anything.

---

# 15. Human Approval Levels

Not every operation should interrupt the author.

Suggested policy:

```text
Level 0 — automatic
Level 1 — notify
Level 2 — ask
Level 3 — explicit approval
```

Examples:

| Operation | Level |
|---|---:|
| Read novel state | 0 |
| Generate draft | 0 |
| Generate review | 0 |
| Open editor | 1 |
| Proposed canon change | 2 |
| Major storyline change | 3 |
| Replace substantial existing prose | 3 |
| Delete established canon | 3 |

This should be configurable.

---

# 16. tmux

tmux is an optional UI adapter.

Initial implementation:

```text
Pi → $EDITOR → Pi
```

Later:

```text
┌──────────────────────┬──────────────────────┐
│ Pi                   │ Editor               │
│                      │                      │
│ Director             │ chapter-023.md      │
│ Writer               │                      │
│ Critic               │                      │
├──────────────────────┴──────────────────────┤
│ Status / notes                              │
└─────────────────────────────────────────────┘
```

Potential future adapters:

```text
direct
tmux
zellij
```

Do not make tmux a dependency of the core workflow engine.

---

# 17. Workflow Model

The user should think in workflows, not Agent wiring.

Initial commands:

```text
/novel plan
/novel write
/novel review
/novel revise
/novel continue
```

### Plan

```text
Director
  ↓
Planner
  ↓
Skills
  ↓
Author approval
```

### Write

```text
Director
  ↓
Planner / approved plan
  ↓
Writer
  ↓
Continuity validation
  ↓
Human Editor
```

### Review

```text
Critic
 ├── Story
 ├── Character
 ├── Pacing
 └── Prose
       ↓
Review Report
```

### Revise

```text
Review
  ↓
Writer
  ↓
Critic
  ↓
Human approval
```

---

# 18. Workflow State Machine

A workflow should be resumable.

Recommended states:

```text
created
  ↓
planning
  ↓
planned
  ↓
writing
  ↓
drafted
  ↓
human_editing
  ↓
edited
  ↓
continuity_check
  ↓
reviewing
  ↓
revision_required ──────┐
  │                     │
  └──── revise ─────────┘
  ↓
approved
  ↓
canonized
```

If Pi exits during `human_editing`, the workflow should be recoverable rather than lost.

---

# 19. Agent Output Contracts

Agent-to-Agent communication should use structured results where possible.

Example:

```yaml
result:
  status: success
  summary: "..."
  artifacts:
    - type: chapter_plan
      path: "..."
  proposed_state_changes: []
  issues: []
  next_action: "..."
```

Manuscript prose is naturally free-form.

Planning, review, state changes, and orchestration should be structured.

This separation is important for reliability.

---

# 20. Director Should Not Become a God Agent

A major risk is putting all logic into the Director.

Avoid:

```text
Director knows every writing technique
Director writes prose
Director maintains all state
Director performs every review
```

Instead:

```text
Director
  = orchestration

Planner
  = structure

Writer
  = prose

Critic
  = evaluation

Continuity
  = canon consistency

Skills
  = methodology
```

The Director should be relatively thin.

---

# 21. Model Assignment

Do not hard-code a single LLM.

Example:

```yaml
agents:
  director:
    model: MiniMax-M3

  planner:
    model: MiniMax-M3

  writer:
    model: MiniMax-M3

  critic:
    model: GLM-5

  continuity:
    model: GLM-5
```

The actual model names should be configuration values.

Different tasks may benefit from different models.

---

# 22. Cost and Recursion Controls

Every delegated operation should have limits:

```text
max_agent_depth
max_subagents
max_iterations
max_tokens
max_time
```

Example:

```yaml
limits:
  max_agent_depth: 2
  max_subagents_per_task: 4
  max_revision_cycles: 2
```

The Director should not endlessly repeat:

```text
Writer → Critic → Writer → Critic → ...
```

A workflow must eventually require human judgment.

---

# 23. Evaluation

Quality evaluation should focus on actionable problems.

Possible dimensions:

```text
Plot coherence
Character consistency
Pacing
Conflict
Foreshadowing
Dialogue
Prose
Emotional impact
Continuity
Originality
```

Avoid making a single aggregate score the main metric.

Prefer:

```yaml
issue:
  category: character
  severity: high
  evidence: "..."
  impact: "..."
  recommendation: "..."
```

Scores can supplement this.

---

# 24. Recommended Project Structure

```text
pi-novel/
├── package.json
├── tsconfig.json
├── README.md
│
├── src/
│   ├── index.ts
│   │
│   ├── agents/
│   │   ├── registry.ts
│   │   ├── director.ts
│   │   ├── planner.ts
│   │   ├── writer.ts
│   │   ├── critic.ts
│   │   └── continuity.ts
│   │
│   ├── subagents/
│   │   ├── registry.ts
│   │   ├── snowflake.ts
│   │   ├── scene.ts
│   │   ├── dialogue.ts
│   │   ├── story-critic.ts
│   │   └── fact-checker.ts
│   │
│   ├── skills/
│   │   ├── loader.ts
│   │   └── resolver.ts
│   │
│   ├── workflow/
│   │   ├── runner.ts
│   │   ├── state.ts
│   │   └── definitions.ts
│   │
│   ├── novel/
│   │   ├── state.ts
│   │   ├── canon.ts
│   │   └── context.ts
│   │
│   ├── editor/
│   │   ├── editor.ts
│   │   ├── detect.ts
│   │   └── tmux.ts
│   │
│   └── commands/
│       ├── novel.ts
│       ├── edit.ts
│       └── agents.ts
│
├── skills/
│   ├── snowflake/
│   ├── story-arc/
│   ├── scene-design/
│   └── ...
│
├── prompts/
│   ├── director.md
│   ├── planner.md
│   ├── writer.md
│   ├── critic.md
│   └── continuity.md
│
└── schemas/
    ├── novel-state.schema.json
    ├── chapter.schema.json
    ├── review.schema.json
    └── state-change.schema.json
```

---

# 25. Review Findings

The architecture is viable, but the following points should be resolved before significant implementation.

## Finding A — Novel State needs a precise schema

This is the largest unresolved design issue.

We need explicit schemas for:

- Character
- Character knowledge
- Relationship
- Location
- World rule
- Story Line
- Arc
- Chapter
- Scene
- Timeline Event
- Foreshadowing
- Unresolved Thread
- Canon Change
- Review

Without this, Agents will gradually create incompatible representations.

**Priority: P0**

---

## Finding B — Character knowledge must be separate from objective truth

This is particularly important for mystery, suspense, and dark-line stories.

The system needs to distinguish:

```text
World Truth
Character A knows
Character B believes
Reader knows
Reader suspects
```

These are not equivalent.

Example:

```yaml
fact:
  id: F-023
  truth: "Antagonist survived"

knowledge:
  protagonist: false
  antagonist: true
  reader: false
```

This should become a core Novel State concept.

**Priority: P0**

---

## Finding C — Storyline state should track information, not just events

A dark line is not merely a list of events.

It should track:

```text
truth
who knows truth
what reader suspects
what has been revealed
what remains hidden
planned reveal
```

This will make suspense and foreshadowing substantially more reliable.

**Priority: P0**

---

## Finding D — Scene should become a first-class object

A chapter is too coarse for long-form orchestration.

Recommended hierarchy:

```text
Novel
 └── Major Arc
      └── Arc
           └── Chapter
                └── Scene
                     └── Beat
```

The first implementation does not need full Beat modeling, but Scene should be first-class.

A Scene can contain:

```yaml
scene:
  purpose: ...
  pov: ...
  location: ...
  time: ...
  participants: []
  conflict: ...
  turn: ...
  information_revealed: []
  foreshadowing: []
  emotional_state:
    before: ...
    after: ...
```

**Priority: P0**

---

## Finding E — Writer should not directly control planning

The Writer should consume an approved or explicitly provisional plan.

Otherwise it can gradually reshape the story while writing.

Recommended:

```text
Planner
  ↓
Plan
  ↓
Human/Director approval
  ↓
Writer
```

For exploratory drafting, the Writer may propose plan changes, but those changes should be explicit.

**Priority: P1**

---

## Finding F — Critic should review against explicit criteria

The Critic should not receive only:

```text
"Review this chapter."
```

It should receive:

```text
chapter
+
chapter plan
+
arc objective
+
character state
+
storyline state
+
review rubric
```

Otherwise it will generate generic literary criticism.

**Priority: P1**

---

## Finding G — Context retrieval is needed eventually, but not initially

A large novel will eventually require targeted retrieval.

However, this does **not** imply MCP or a vector database.

Start with deterministic sources:

```text
current chapter
previous chapter
arc summary
character files
timeline
storyline files
foreshadowing
```

Only introduce semantic retrieval after measuring an actual failure mode.

**Priority: P1**

---

## Finding H — Git is a useful infrastructure primitive

Because the novel is file-based and long-lived, Git provides:

- revision history
- rollback
- branching
- experimentation
- diff
- backup integration

The Extension should remain Git-friendly but should not become a Git management application.

**Priority: P1**

---

# 26. Revised MVP

The smallest meaningful prototype should be:

```text
Pi Extension
│
├── 1. Agent Registry
│     ├── Director
│     ├── Planner
│     ├── Writer
│     ├── Critic
│     └── Continuity
│
├── 2. Skill Loader
│     ├── Snowflake
│     └── Scene Design
│
├── 3. Basic Novel State
│     ├── novel
│     ├── characters
│     ├── story
│     └── chapters
│
├── 4. External Editor
│
└── 5. /novel write
```

One complete test should be:

```text
User:
"Write the next chapter."

        ↓

Director

        ↓

Planner

        ↓

Scene Plan

        ↓

Human approval

        ↓

Writer

        ↓

External Editor

        ↓

Continuity

        ↓

Critic

        ↓

Revision proposal

        ↓

Human approval

        ↓

Canon update
```

If this works well, the architecture has been validated.

---

# 27. Development Roadmap

> **All 8 phases shipped (Phase 0–8, 2026-09-13).** This section is preserved for historical context — every item below is now `✅ shipped`. See [STATE.md](../.planning/STATE.md) for the per-phase test counts and [AGENTS.md §"Project status"](../AGENTS.md) for one-line summaries.

## ✅ Phase 0 — Pi Extension Skeleton

Goal:

```text
Pi
 ↓
Extension
 ↓
Command
 ↓
Agent
 ↓
Result
```

No complex Novel State.

---

## ✅ Phase 1 — External Editor

Implement:

```text
edit_file(path)
```

Requirements:

- `$VISUAL`
- `$EDITOR`
- Windows fallback
- macOS fallback
- Linux fallback
- await process
- detect changes

---

## ✅ Phase 2 — Agent Registry

Implement the five core Agents.

---

## ⏸ Phase 3 — Skill System (deferred per ADR-0005)

Implement:

- discovery
- loading
- versioning
- Agent-to-Skill resolution

Start with only:

```text
Snowflake
Scene Design
```

---

## ⏸ Phase 4 — Subagent Delegation (deferred per ADR-0005)

Add the first useful specialists:

```text
Scene Planner
Dialogue Specialist
Story Critic
Fact Checker
```

Do not implement every proposed Subagent yet.

---

## ✅ Phase 5 — Novel State

Define and implement P0 schemas.

Especially:

```text
Character
Character Knowledge
Scene
Story Line
Timeline Event
Foreshadowing
Unresolved Thread
Canon Change
```

---

## ✅ Phase 6 — Workflow Engine

Implement:

```text
/novel plan
/novel write
/novel review
/novel revise
```

Make workflows resumable.

---

## ✅ Phase 7 — tmux

Add tmux only after direct editor interaction is stable.

---

# 28. Final Architecture

```text
                         AUTHOR
                           │
                           ▼
                    ┌──────────────┐
                    │   DIRECTOR   │
                    └──────┬───────┘
                           │
             ┌─────────────┼─────────────┐
             ▼             ▼             ▼
          PLANNER        WRITER        CRITIC
             │             │             │
             └─────────────┼─────────────┘
                           ▼
                      CONTINUITY
                           │
                           ▼
                     NOVEL STATE
                           │
                 ┌─────────┴─────────┐
                 ▼                   ▼
              $EDITOR              tmux
```

Cross-cutting:

```text
Skills → Agents
Workflow → Agents/Subagents
Context → Novel State
Approval → Human
```

The most important architectural decision is:

> **Do not build a giant autonomous writing agent. Build a controlled writing system in which small specialized Agents operate against an explicit Novel State and the author remains the final authority.**

---

> **All 10 items resolved (2026-09-13).** Original ordering kept for historical context. Outcomes map to:
> 1–4 → `extensions/novel/schemas.ts` (P0 schemas: Character, Character Knowledge, Scene, Story Line, plus TimelineEvent, Foreshadowing, UnresolvedThread, CanonChange)
> 5 → ADR-0004 (Director route.yaml router)
> 6 → ADR-0005 (subagents earned, not declared)
> 7 → ADR-0005 + the 5 pre-declared agents that ship the body inline
> 8 → `config/route.yaml` (9 intents) + `extensions/orchestrator/route.ts`
> 9 → ADR-0002 + `extensions/editor/gate.ts` (decideOutcome) + `extensions/workflow/transitions.ts`
> 10 → Phase 0–8 shipped — see [AGENTS.md §"Project status"](../AGENTS.md)

Before implementation, the next design session should focus on these items in order:

1. ✅ **Novel State schema** — landed in `extensions/novel/schemas.ts` (P0)
2. ✅ **Character Knowledge model** — POV-derived + `state/character-beliefs.yaml` overrides (Q3)
3. ✅ **Scene model** — authored intent + derived facts split (Q12)
4. ✅ **Story Line / Dark Line model** — named N-lines w/ `kind: bright | dark | subplot | red-herring` (Q4)
5. ✅ **Agent Contract** — TypeBox schemas in each `extensions/agents/*.ts`
6. ⏸ **Subagent Contract** — deferred per ADR-0005 (earned, not declared)
7. ✅ **Skill format** — multi-file `SKILL.md` (Q15) + on-demand body loading
8. ✅ **Workflow definition format** — `config/route.yaml` + `matchRoute` (Q13+Q16 / ADR-0004)
9. ✅ **Human approval protocol** — editor-as-gate with mtime-based `decideOutcome` (Q8)
10. ✅ **Minimal Pi Extension implementation** — `extensions/index.ts` + 8 phases shipped
9. **Human approval protocol**
10. **Minimal Pi Extension implementation**

These are more important than choosing the final folder structure or tmux layout.

