#!/usr/bin/env bash
# Entry point of the Buddy.works burst lane: the pipeline's single "Run Bash" action is `bash .factory/route/burst.sh`.
# It runs in the checkout of the default branch. It finds the claimed issue, runs the pipeline with the lease heartbeat,
# then hands the issue back and charges the ledger.
#
# Buddy pipeline variables (secrets marked): GH_TOKEN (secret; issues write on this repo only), GITHUB_REPOSITORY (owner/name),
# CLAUDE_CODE_OAUTH_TOKEN (secret) or ANTHROPIC_API_KEY (secret). ISSUE_NUMBER arrives from the webhook; if it does not,
# the oldest open issue labelled agent:working and lane:burst is used.
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
: "${GH_TOKEN:?GH_TOKEN is not set}" "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is not set (owner/name)}"
for tool in gh node npm npx; do command -v "$tool" >/dev/null || { echo "$tool is not installed on this Buddy image"; exit 1; }; done

cli() { npx ts-node .factory/route/cli.ts "$@"; }

npm ci >/dev/null || { echo "npm ci failed"; exit 1; }

ISSUE_NUMBER="${ISSUE_NUMBER:-$(cli find-burst)}"
[[ "$ISSUE_NUMBER" =~ ^[0-9]+$ ]] || { echo "no claimed burst issue found"; exit 1; }
export ISSUE_NUMBER
LEASE_COMMENT_ID="$(cli lease-id)" || { echo "no lease comment on issue #$ISSUE_NUMBER"; exit 1; }
UNTIL="$(cli until)"
export LEASE_COMMENT_ID UNTIL LANE=burst RUN_ID="${BUDDY_EXECUTION_ID:-buddy}"

START_EPOCH="$(date +%s)"
JOB_RESULT=failure
if AUTHOR_TOKEN="" SHARED_TOKEN="${CLAUDE_CODE_OAUTH_TOKEN:-}" API_KEY="${ANTHROPIC_API_KEY:-}" bash .factory/route/run-pipeline.sh; then
  JOB_RESULT=success
fi

RUN_URL="${BUDDY_EXECUTION_URL:-https://app.buddy.works}" START_EPOCH="$START_EPOCH" JOB_RESULT="$JOB_RESULT" cli finish
[ "$JOB_RESULT" = "success" ]
