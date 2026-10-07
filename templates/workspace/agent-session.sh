#!/usr/bin/env bash
# Starts (or re-attaches to) a long-lived Claude Code session for one agent and one branch.
# Usage: agent-session.sh <agent-name> <repo-dir> <branch> [task-brief-file]
set -euo pipefail

[ $# -ge 3 ] || { echo "Usage: $0 <agent-name> <repo-dir> <branch> [task-brief-file]" >&2; exit 2; }
name="$1"; repo="$2"; branch="$3"; brief="${4:-}"
session="agent-$name"

case "$branch" in
  main|master|release/*|www-*) echo "Refusing to work directly on '$branch'." >&2; exit 1 ;;
esac

if tmux has-session -t "$session" 2>/dev/null; then
  echo "Session $session exists; attaching."
else
  git -C "$repo" fetch -q origin
  if git -C "$repo" rev-parse -q --verify "$branch" >/dev/null; then
    git -C "$repo" checkout -q "$branch"
  else
    git -C "$repo" checkout -q -b "$branch" origin/main
  fi
  tmux new-session -d -s "$session" -c "$repo" claude
  if [ -n "$brief" ]; then
    # Give the session its task; the brief should state intent, scope and risk (see the hand-off protocol).
    sleep 3
    tmux send-keys -t "$session" "$(cat "$brief")" Enter
  fi
fi

if [ -n "${TMUX:-}" ]; then tmux switch-client -t "$session"; else tmux attach -t "$session"; fi
