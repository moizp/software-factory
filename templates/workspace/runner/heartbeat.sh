#!/usr/bin/env bash
# Tells the router this VM can take long jobs: sets the repository variable ORACLE_LAST_SEEN to the current UTC time.
# It only does so when the machine is healthy, so a broken runner stops receiving work within ten minutes.
# Run by oracle-heartbeat.timer every five minutes. Needs REPO and GH_TOKEN (fine-grained token: this repo only,
# Variables read and write, nothing else).
set -uo pipefail

REPO="${REPO:?REPO is not set (owner/name)}"
MIN_FREE_DISK_GB="${MIN_FREE_DISK_GB:-2}"

fail() { echo "heartbeat withheld: $*" >&2; exit 1; }

systemctl list-units 'actions.runner.*' --state=active --no-legend 2>/dev/null | grep -q . \
  || fail "no active actions.runner service"

claude --version >/dev/null 2>&1 || fail "claude CLI not working"

# A key in the environment would make Claude Code bill the API instead of the account login.
[ -z "${ANTHROPIC_API_KEY:-}${ANTHROPIC_AUTH_TOKEN:-}" ] || fail "ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN is set"

free_gb="$(df -Pk "${HOME:-/}" | awk 'NR==2 {printf "%d", $4/1024/1024}')"
[ "$free_gb" -ge "$MIN_FREE_DISK_GB" ] || fail "free disk ${free_gb} GB is below ${MIN_FREE_DISK_GB} GB"

[ -n "${GH_TOKEN:-}" ] || fail "GH_TOKEN is not set"
gh variable set ORACLE_LAST_SEEN --repo "$REPO" --body "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >/dev/null \
  || fail "could not set ORACLE_LAST_SEEN (check the token's Variables permission)"
echo "heartbeat sent for $REPO"
