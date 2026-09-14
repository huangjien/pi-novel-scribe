#!/usr/bin/env bash
# layout.sh — spawn a tmux session for pi-novel-scribe Phase 7.
#
# Pane layout (from §16 of the architecture review):
#
#   ┌──────────────────────┬──────────────────────┐
#   │ Pi                   │ Editor               │
#   │                      │                      │
#   │ Director             │ chapter-023.md      │
#   │ Writer               │                      │
#   │ Critic               │                      │
#   ├──────────────────────┴──────────────────────┤
#   │ Status / notes (custom widget)              │
#   └────────────────────────────────────────────┘
#
# Usage:
#   ./layout.sh [novelRepo]
#
# If novelRepo is not given, the current working directory is used.

set -eu

NOVEL_REPO="${1:-$(pwd)}"

if [ ! -d "$NOVEL_REPO/chapters" ]; then
  echo "layout.sh: '$NOVEL_REPO/chapters' not found — is this a novel repo?" >&2
  exit 1
fi

SESSION="novel-scribe-$(basename "$NOVEL_REPO")"
NEXT_CHAPTER=$(ls -1 "$NOVEL_REPO/chapters" 2>/dev/null \
  | grep -v 'approved\|canonized' | head -1 || true)

# Spawn detached session, then build the layout.
tmux new-session -d -s "$SESSION" -n pi-novel-scribe -c "$NOVEL_REPO"

# Left pane (default) → run pi.
tmux send-keys -t "${SESSION}:0.0" "pi" "C-m"

# Vertical split — right pane is the editor.
tmux split-window -h -t "${SESSION}:0.0" -c "$NOVEL_REPO"
if [ -n "${NEXT_CHAPTER:-}" ]; then
  tmux send-keys -t "${SESSION}:0.1" "${VISUAL:-${EDITOR:-vi}} 'chapters/${NEXT_CHAPTER}'" "C-m"
fi

# Horizontal split — bottom pane is the Status / notes (≈ 30% height).
tmux split-window -v -t "${SESSION}:0.0" -p 30

# Attach to the session.
tmux attach-session -t "$SESSION"
