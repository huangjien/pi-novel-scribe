# ADR-0001: Separate novel repo, extension is a tool

**Status:** Accepted
**Date:** 2026-09-13
**Author:** pi-novel-scribe (grilling session Q1)

## Context

We need to decide how pi-novel-scribe relates to the user's novel. Options
considered:

- **A. Single repo.** This extension's repo *is* the novel repo.
- **B. Separate novel repo, configured path.** (Chosen.)
- **C. Novel state lives in extension's `novels/<id>/`.**

## Decision

The novel lives in its own git repository, completely independent of the
pi-novel-scribe extension. The extension locates it via `novelRepo` config
(`.pi/settings.json` key or upward-scanned `.pi/novel-state.yaml` marker
file). The extension never owns the novel's git history, never edits
prose on the author's behalf without explicit approval, and never inlines
novel data into the extension repo.

The extension is **stateless across novels**: one installation of
pi-novel-scribe serves N novel repos, and each novel repo is independent.

## Consequences

**Easier:**

- Switching authoring tools (Claude Code, Codex, OpenCode, manual
  writing) is non-disruptive — the novel repo continues to exist
  independently.
- The novel is a normal artifact the author can back up, branch, or
  redistribute without bundling the writing tool.
- Multiple novels per install: a single `pi -e ./extensions/index.ts`
  run with `novelRepo` set differently serves each novel.
- Novel repos have a clean git history with no tool-noise commits.

**Harder:**

- Every agent needs path-resolution logic to find the novel repo. The
  `path-resolver.ts` module is non-trivial on first implementation.
- The "discovery" UX (how does the user point at a novel repo?) is more
  complex than "open this folder."
- Two-repo context switching requires the author to keep pi cwd in the
  novel repo (or the extension must accept a `--novel` flag).

**Rejected alternatives:**

- A (single repo): makes the extension a one-shot tool per novel. Forces
  copy/fork per novel. Adds technical debt from day 1.
- C (extension-owned novels): couples novel versioning to extension
  versioning; novels aren't first-class repos; the "where does my novel
  live" question comes back.

## Compliance

The implementation must:

1. Read the novel repo path from `novelRepo` config *or* the
   `.pi/novel-state.yaml` marker.
2. Refuse to write anywhere outside the resolved novel repo.
3. Treat the novel repo's `.git/` as off-limits to the extension (no
   `git commit`, no branch operations — read-only).
