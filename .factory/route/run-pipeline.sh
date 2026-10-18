#!/usr/bin/env bash
# Runs the factory pipeline for one claimed issue with a lease heartbeat. Shared by the Actions composite action
# (hosted and Oracle lanes) and burst.sh (Buddy lane). The exit code is the pipeline's.
#
# Env: ISSUE_NUMBER LANE UNTIL LEASE_COMMENT_ID RUN_ID GH_TOKEN, and for credentials AUTHOR_TOKEN SHARED_TOKEN API_KEY.
set -u

: "${ISSUE_NUMBER:?}" "${LANE:?}" "${UNTIL:?}" "${LEASE_COMMENT_ID:?}" "${RUN_ID:?}"
AUTHOR_TOKEN="${AUTHOR_TOKEN:-}"; SHARED_TOKEN="${SHARED_TOKEN:-}"; API_KEY="${API_KEY:-}"

# Exactly one credential, never both: with ANTHROPIC_API_KEY present Claude Code would bill the API instead of the
# account. GITHUB_TOKEN is deliberately not exported, so the orchestrator cannot open or merge pull requests.
if [ -n "$AUTHOR_TOKEN" ]; then
  export CLAUDE_CODE_OAUTH_TOKEN="$AUTHOR_TOKEN"; unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN
elif [ -n "$SHARED_TOKEN" ]; then
  export CLAUDE_CODE_OAUTH_TOKEN="$SHARED_TOKEN"; unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN
elif [ -n "$API_KEY" ]; then
  export ANTHROPIC_API_KEY="$API_KEY"; unset CLAUDE_CODE_OAUTH_TOKEN ANTHROPIC_AUTH_TOKEN
elif [ "$LANE" = "long" ]; then
  # Oracle runner: the writer's local login is used. A key in the environment would shadow it.
  if [ -n "${ANTHROPIC_API_KEY:-}${ANTHROPIC_AUTH_TOKEN:-}" ]; then
    echo "ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN is set on the runner; remove it so the account login is used."; exit 1
  fi
else
  echo "No Claude credential for the $LANE lane (author account, shared account or API key)."; exit 1
fi
unset AUTHOR_TOKEN SHARED_TOKEN API_KEY
command -v claude >/dev/null || { echo "claude CLI not found on this machine"; exit 1; }

# The heartbeat gets its own stdio: a sleep left running after the kill below must not hold this step's output open.
( while true; do sleep "${HEARTBEAT_SECONDS:-600}"; npx ts-node .factory/route/cli.ts beat || true; done ) </dev/null >/dev/null 2>&1 &
HEARTBEAT=$!

# Issue text is data: it goes into one quoted argument, never into the script.
BRIEF="$(gh issue view "$ISSUE_NUMBER" --json title,body --jq '.title + "\n\n" + .body')"
FACTORY_IGNORE_WIP=1 npx ts-node .factory/cli.ts start "$BRIEF" "$ISSUE_NUMBER" --until "$UNTIL"
RESULT=$?
pkill -P "$HEARTBEAT" 2>/dev/null || true
kill "$HEARTBEAT" 2>/dev/null || true
exit "$RESULT"
