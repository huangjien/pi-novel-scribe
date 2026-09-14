# CONTEXT.md — pi-novel-scribe glossary

> **Canonical domain language** for the pi-novel-scribe project. Terms here are
> the contract between architecture, code, and prose. New terms land here as
> they resolve. Implementation detail does not belong here — only language that
> domain experts (the author + future agents) need to agree on.

## Core separation

### **Novel repo** — the durable artifact

A standalone git repository that owns everything **about one novel**:
chapters, characters, world, story plans, foreshadowing, canon state. One
install of pi-novel-scribe can serve N novel repos; each novel repo is
independent and author-owned. The extension never writes into the novel repo
*through* itself; it reads/writes via filesystem paths declared by the repo.

> **Decision:** Separate novel repo, configured path. The extension is a
> tool; the novel repo is a peer project. (Locked 2026-09-13, Q1.)

## Actors

### **Author**

The human running pi. Final authority on canon (hard design rule #1). Pi is
the runtime; the extension provides novel-specific orchestration. The author
is not a passive consumer — they make the consequential calls.

## Boundaries

### **Extension repo** (this repo: `pi-novel-scribe`)

TypeScript pi extension. Owns the agents, skills, tools, workflows. **No
novel prose lives here.** Stateless across novels.

### **Novel repo** (declarative path)

Sibling/cousin git repo declared via `.pi/settings.json` `novelRepo` key, or
a marker file (`novel-state.yaml`) the extension discovers upward from cwd.
The novel repo is the source of truth for canon, manuscript, and durable
state.

## Canon model

### **Canon**

The set of facts a reader can treat as true **if and only if** they have
read up to a given chapter. Authoritative canon is **derived from approved
prose**, never authored independently.

### **Approved prose**

Prose with `status: approved` in its chapter frontmatter. **Append-only**
from approval onward: prose edits require a new chapter version (the
extension refuses to overwrite approved prose in place). This is what makes
"canon = derivation of prose" cheap — the input never mutates.

### **Authored state** (outside prose)

Things the author commits to **before** they appear in prose: planned
chapters, scene scaffolds, character profiles (psychology, not state),
pre-written facts (`<!-- planned -->`), intentional foreshadowing
commitments. These are *author intent*, not canon — they become canon only
when the relevant prose is approved.

> **Decision:** Prose-as-source, canon-as-derived. Authored state lives
> only where prose is awkward to query (planning, intentional commitments,
> pre-written facts). (Locked 2026-09-13, Q2.)

### **Knowledge model** — how to represent "Sara knows X"

Three layers, in increasing order of explicitness:

1. **Reader knowledge** — pure derivation. "Reader knows F at chapter N" =
   any approved chapter ≤ N that mentions F (or has POV access to whoever
   mentions it). No store.
2. **Character knowledge** — POV-derived by default; overrides via authored
   file. A fact is known by character C if prose in a scene where C POVs
   states it (or C narrates it to someone). When prose disagrees with
   author intent (unreliable narrator, mystery), the authored belief file
   is the override.
3. **World truth** — authored commitment only. "What is actually true in
   this fiction, regardless of who knows it." Required for mysteries and
   unreliable narration. Lives in `state/world-truth.yaml`.

Beliefs file (`state/character-beliefs.yaml`) shape (proposed):

```yaml
characters:
  sara:
    believes:
      - "john betrayed the team"
      - "the lighthouse was abandoned in 1987"
  john:
    believes:
      - "he did not betray the team"
```

> **Decision:** POV-derived knowledge + authored overrides. (Locked
> 2026-09-13, Q3.)

## Story structure

### **Story Line** — a named, tracked narrative thread

A novel has **N story lines**, each named (`sara-investigation`,
`the-watcher`). Each line carries a `kind` (`bright | dark | subplot |
red-herring`) and an independent state machine: `objective / state /
next_target / hidden_information / planned_reveal`. The critic walks the
*active* set on each chapter review; bright and dark are attributes, not
separate entity types.

> **Decision:** Named N-lines, `kind: bright | dark | subplot |
> red-herring` per line. (Locked 2026-09-13, Q4.)

> **Decision:** Inline scene markers, markdown-safe syntax (not HTML
> comments — survives most editors). (Locked 2026-09-13, Q5.)

### **Character profile** — the authored, prose-independent self

A character has two distinct files:

1. `characters/sara/profile.yaml` — hand-authored, **stable**. Identity
   (name, ID, pronouns, role), voice (register, sample lines, vocabulary),
   psychology (goals, fears, blind spots, dominant emotion), relevant
   backstory.
2. `state/character-beliefs.yaml` — auto-derived from POV + prose, with
   author overrides (Q3). Frequently updated by continuity runs.

The Writer reads both at scene-draft time but writes only the first; the
extension writes only the second.

> **Decision:** Two-file read (profile + beliefs), single-file write for
> each. (Locked 2026-09-13, Q6.)

### **Scene context packet** — the composable prompt for scene-level agents

When Writer, Critic, or Continuity operates on a specific scene, the
extension deterministically assembles a `scene-context.yaml` packet
containing: chapter plan, scene plan, POV character profile, POV character
beliefs (filtered to ≤ current chapter), story lines advanced by this scene,
and the last paragraph of prior prose for register continuity. The packet
is a pure function of `(novelRepo, sceneId)` and uses the cached
provenance per agent run — no LLM-judgment in composition, no `git`-style
Drift. Skills are loaded per-agent into the packet wrapper.

> **Decision:** Deterministic composition by the extension, not by an
> LLM. (Locked 2026-09-13, Q7.)

### **Approval gate** — level-2/level-3 pauses

Level-2 (ask) and Level-3 (explicit approval) gates pause the workflow and
open the relevant authored artifact in `$VISUAL` / `$EDITOR`. On editor
exit:

- **Save & quit** → edited artifact becomes the new state; workflow
  proceeds.
- **No-change (no diff)** → original proposal is approved as-stated.
- **Quit without save** → rollback to pre-proposal state; workflow aborts
  gracefully, surfaces the rollback reason.

A session-log entry records every gate decision (file path, before/after
state hash, user text note if any) so a later `/resume` can replay the
context. Level-1 (notify) gates emit only the session log; level-0
(automatic) emits nothing.

> **Decision:** Level-2/3 opens the artifact in user's editor;
> editor-save semantics drive the approval outcome. (Locked 2026-09-13,
> Q8.)

### **Workflow state** — chapter frontmatter, not session.jsonl

Each chapter carries a `status` field in its frontmatter, value from the
§18 enum (`planned | writing | drafted | human_editing | edited |
continuity_check | reviewing | revision_required | approved | canonized`).
On `session_start`, the extension scans chapters for non-terminal
statuses and offers to resume (`"Resume chapter 0005 in editor? [Y/n]"`).

Transition history lives in **git diff of chapter frontmatter** +
session-log audit entries. Two stores, neither is the workflow store
itself.

> **Decision:** Chapter frontmatter is the canonical workflow state.
> Session.jsonl holds only the chat-level replay. (Locked 2026-09-13,
> Q9.)

## Implementation strategy

### **Substrate-first MVP** — extension + editor + status, no LLM

The first vertical shipped under pi-novel-scribe is **substrate-only**:
the extension loads via `pi -e ./extensions/index.ts`, registers
`/novel write`, opens the next chapter file in `$EDITOR`, and updates the
chapter `status` frontmatter based on save/quit semantics. No LLM calls
yet — the substrate (novel-repo separation, editor roundtrip, status
machine, chapter frontmatter parsing) is what fails first if it fails,
and agents layered on top of broken substrate amplify the failure.

Agent prompts (Director, Planner, Writer, Critic, Continuity) are drafted
as plain Markdown alongside the substrate code from day 1 — they can be
read and iterated independently of the TypeScript agent code that
eventually loads them.

> **Decision:** Substrate-first MVP. Ship the chain, not the agents.
> (Locked 2026-09-13, Q10.)

### **Subagent** — earned, not declared

A subagent is a narrower LLM call invoked by a parent agent. We do not
pre-declare the §5 subagent list as shipped modules. The Critic, for
example, ships as **one LLM call** whose prompt asks for issues
segmented by `category: story | character | pacing | prose`. Real
subagents (e.g., a stand-alone Story Critic) are added only when
review-quality metrics show that segmentation-by-prompt is provably the
bottleneck.

> **Decision:** Subagents are earned by measured need, not declared up
> front. (Locked 2026-09-13, Q11.)

### **Scene schema** — authored intent vs derived facts

Each scene has two field classes:

1. **Plan-time (authored)** — emitted by Planner / set by author in
   the `@scene` marker: `id, pov, location, time, participants,
   purpose, conflict, turn, advances_lines`.
2. **Post-draft (derived)** — extracted by the extension after
   drafting: `information_revealed, foreshadowing_planted,
   emotional_state (before/after), word_count, tone`.

The Planner LLM only emits authored fields; the extension extracts the
rest. Single source of truth per field. Continuity / Critic consume the
derived fields in the scene-context packet.

> **Decision:** Authored vs derived split. Planner intents, extension
> derives. (Locked 2026-09-13, Q12.)

### **Workflow** — prompt-driven orchestration with route.yaml

Workflows (`/novel plan|write|review|revise|continue`) are defined as
slash commands backed by the Director. The Director's primary
mechanism is `config/route.yaml` (Q16): match input to a route, then
dispatch to the route's primary + support agents. For ambiguous input,
the Director falls back to LLM-determined orchestration.

> **Decision:** Routing-table workflows with LLM fallback. The
> Director is a router, not a free-form orchestrator. (Locked 2026-09-13,
> Q13 + Q16.)

### **Recursion safety** — hybrid (prompt + runtime guards)

The Director's prompt carries explicit caps (`max_agent_depth`,
`max_subagents_per_task`, `max_iterations`, `max_tokens`, `max_time`).
**In addition**, the extension tracks active depth via
`ctx.sessionManager` (per-agent counter as a session entry) and refuses
tool calls that would exceed caps. Tool calls return `isError: true`
with a "max_agent_depth exceeded" message. Caps are config-driven
(`config/novel-scribe.json` or `.pi/settings.json`).

> **Decision:** Hybrid: prompt-instructed + runtime-enforced caps.
> (Locked 2026-09-13, Q14.)

### **Skills** — multi-file SKILL.md, on-demand loading

A skill is a directory under `skills/<name>/` with:

- `SKILL.md` — pi frontmatter (`name`, `description`) + body. Body
  follows the review §6 fixed sections: Purpose / When to use / Inputs /
  Procedure / Constraints / Output / Failure conditions / Examples.
- `scripts/` (optional) — companion code the LLM can call (e.g., a
  pacing-analyzer's measurement script).
- `references/` (optional) — auxiliary docs the LLM reads on demand.

Skills ship with the extension. Only the description (`description`
field) is in the system prompt; the body is loaded via `/skill:name` on
demand. Skills version with the extension repo (git).

> **Decision:** Multi-file SKILL.md + on-demand loading per pi
> convention. (Locked 2026-09-13, Q15.)

### **Director** — routing-table orchestrator with LLM fallback

The Director is **not** a free-form orchestrator. It owns a
`config/route.yaml` (modeled on `~/.agents/route.yaml`) that lists
novel-specific intents, each with:

- `intent` (e.g., `write_chapter`, `plan_chapter`, `review_chapter`,
  `revise_chapter`, `continue_novel`, `inspect_novel_state`,
  `investigate_continuity`).
- `triggers` (keywords + phrases + optional regex).
- `primary` (workflow or agent).
- `support` (parallel agents; optional).
- `priority` (tie-break).
- `recursion_caps` (per-route overrides for Q14 limits).

The Director LLM's first job is route matching: try the table first.
If a route confidently matches, dispatch to its primary + support
agents. If none match, fall back to LLM-determined dispatch (Q13's
"prompt-driven" behavior). If still ambiguous, ask one clarifying
question — no ping-pong.

`config/route.yaml` ships with the extension (default intents for
novel-writing) and is overridable per-novel via `.pi/novel-state.yaml`.

> **Decision:** Routing-table orchestrator with LLM fallback,
> following the `~/.agents/route.yaml` pattern. (Locked 2026-09-13,
> Q16 — refines Q13.)

---

<!-- open terms, not yet resolved, go below -->

