#!/usr/bin/env bash
# Verifies this machine matches the standard writer workspace. Exit code = number of failed checks.
# Usage: ./doctor.sh [path/to/versions.env]
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=versions.env
source "${1:-$DIR/versions.env}"

fails=0
ok()   { printf '  ok    %s\n' "$1"; }
bad()  { printf '  FAIL  %s\n' "$1"; fails=$((fails + 1)); }
info() { printf '  info  %s\n' "$1"; }

echo "Writer workspace doctor"

actual_node="$(node -v 2>/dev/null || echo missing)"
[ "$actual_node" = "v$NODE_VERSION" ] && ok "node $actual_node" || bad "node is $actual_node, expected v$NODE_VERSION"

actual_claude="$(claude --version 2>/dev/null | awk '{print $1}' || true)"
[ "${actual_claude:-missing}" = "$CLAUDE_CODE_VERSION" ] && ok "claude code $actual_claude" || bad "claude code is ${actual_claude:-missing}, expected $CLAUDE_CODE_VERSION"

if [ -n "${ANTHROPIC_API_KEY:-}" ] || [ -n "${ANTHROPIC_AUTH_TOKEN:-}" ]; then
  bad "ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN is set: Claude Code would bill the metered API instead of the subscription"
else
  ok "no metered API credentials in the environment"
fi

[ "${DISABLE_AUTOUPDATER:-}" = "1" ] && ok "auto-update disabled" || bad "DISABLE_AUTOUPDATER is not 1 (versions would drift)"

tmux_major="$(tmux -V 2>/dev/null | grep -oE '[0-9]+' | head -1 || true)"
[ -n "$tmux_major" ] && [ "$tmux_major" -ge "$TMUX_MIN_MAJOR" ] && ok "tmux $(tmux -V)" || bad "tmux missing or older than $TMUX_MIN_MAJOR"

hooks_path="$(git config --get core.hooksPath 2>/dev/null || true)"
if [ -n "$hooks_path" ] && [ -x "$hooks_path/pre-push" ]; then ok "pre-push guard at $hooks_path"; else bad "core.hooksPath/pre-push guard not installed"; fi

[ -n "$(git config --get user.name 2>/dev/null)" ] && [ -n "$(git config --get user.email 2>/dev/null)" ] \
  && ok "git identity $(git config --get user.name)" || bad "git user.name/user.email not set"

settings="$HOME/.claude/settings.json"
if [ -f "$settings" ] && jq -e '.permissions.deny | index("Bash(git push --force*)")' "$settings" >/dev/null 2>&1; then
  ok "claude settings deny force pushes"
else
  bad "$settings missing or lacks the standard deny rules"
fi

secrets="$HOME/.config/factory/secrets.env"
if [ -f "$secrets" ]; then
  [ "$(stat -c %a "$secrets")" = "600" ] && ok "secrets file mode 600" || bad "$secrets must be mode 600"
  grep -q '^ANTHROPIC_API_KEY=' "$secrets" && bad "ANTHROPIC_API_KEY found in $secrets" || ok "no ANTHROPIC_API_KEY in secrets file"
else
  bad "$secrets missing"
fi

free_gb="$(df -Pk "$HOME" | awk 'NR==2 {printf "%d", $4/1024/1024}')"
[ "$free_gb" -ge "$MIN_FREE_DISK_GB" ] && ok "free disk ${free_gb} GB" || bad "free disk ${free_gb} GB < $MIN_FREE_DISK_GB GB"

info "subscription login is not verified here: run 'claude' once and use /login"
echo "$fails check(s) failed"
exit "$fails"
