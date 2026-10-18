#!/usr/bin/env bash
# Starts the Buddy.works pipeline for a claimed issue. Env: BUDDY_WEBHOOK_URL (a secret: the URL carries the token), ISSUE_NUMBER.
# Never prints the URL. The request body is built in one place so the format is easy to correct.
set -euo pipefail

: "${BUDDY_WEBHOOK_URL:?BUDDY_WEBHOOK_URL is not set}" "${ISSUE_NUMBER:?}"
[[ "$ISSUE_NUMBER" =~ ^[0-9]+$ ]] || { echo "ISSUE_NUMBER must be a number" >&2; exit 2; }

body="$(printf '{"variables":[{"key":"ISSUE_NUMBER","value":"%s"}]}' "$ISSUE_NUMBER")"
if ! curl -fsS --max-time 30 -X POST -H 'Content-Type: application/json' --data "$body" "$BUDDY_WEBHOOK_URL" >/dev/null; then
  echo "Buddy webhook call failed" >&2
  exit 1
fi
echo "Buddy pipeline requested for issue #$ISSUE_NUMBER"
