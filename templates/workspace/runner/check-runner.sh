#!/usr/bin/env bash
# Verifies the Oracle lane on this VM. Exit code = number of failed checks.
# Usage: ./check-runner.sh [--user runner]
set -uo pipefail

RUNNER_USER="runner"
[ "${1:-}" = "--user" ] && RUNNER_USER="${2:-runner}"
fails=0
ok()  { printf '  ok    %s\n' "$1"; }
bad() { printf '  FAIL  %s\n' "$1"; fails=$((fails + 1)); }

echo "Oracle runner check"

systemctl list-units 'actions.runner.*' --state=active --no-legend 2>/dev/null | grep -q . \
  && ok "runner service active" || bad "no active actions.runner service"
systemctl is-enabled --quiet oracle-heartbeat.timer 2>/dev/null \
  && ok "heartbeat timer enabled" || bad "oracle-heartbeat.timer not enabled"
[ -f /etc/factory/oracle.env ] && grep -q '^REPO=' /etc/factory/oracle.env \
  && ok "/etc/factory/oracle.env names the repository" || bad "/etc/factory/oracle.env missing REPO"

home="$(getent passwd "$RUNNER_USER" | cut -d: -f6)"
tokenfile="$home/.config/factory/heartbeat.env"
if [ -f "$tokenfile" ]; then
  [ "$(stat -c %a "$tokenfile")" = "600" ] && ok "heartbeat token file mode 600" || bad "$tokenfile must be mode 600"
  grep -q '^GH_TOKEN=.\+' "$tokenfile" && ok "heartbeat token present" || bad "GH_TOKEN empty in $tokenfile"
else
  bad "$tokenfile missing"
fi

[ -d "$home/.claude" ] && ok "claude login directory exists for $RUNNER_USER" || bad "$RUNNER_USER has not logged in to claude yet"
if [ -n "${ANTHROPIC_API_KEY:-}${ANTHROPIC_AUTH_TOKEN:-}" ]; then bad "API credentials set in this shell"; else ok "no API credentials in this shell"; fi
grep -rqs 'ANTHROPIC_API_KEY\|ANTHROPIC_AUTH_TOKEN' /opt/actions-runner/.env /etc/factory/oracle.env "$home/.config/factory/heartbeat.env" \
  && bad "an API key is set in a runner or heartbeat env file" || ok "no API key in runner or heartbeat env files"

last="$(systemctl show oracle-heartbeat.service -p ExecMainStatus --value 2>/dev/null || true)"
[ "$last" = "0" ] && ok "last heartbeat run succeeded" || bad "last heartbeat run did not succeed (status ${last:-unknown}); see: journalctl -u oracle-heartbeat"

echo "$fails check(s) failed"
exit "$fails"
