#!/usr/bin/env bash
# Makes this machine an identical writer workspace. Idempotent: safe to re-run after changing versions.env.
# Usage: ./bootstrap.sh [agent-name]       (Debian/Ubuntu, x64 or arm64; needs sudo)
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=versions.env
source "$DIR/versions.env"
AGENT_NAME="${1:-${AGENT_NAME:-agent}}"
SUDO=""; [ "$(id -u)" -eq 0 ] || SUDO="sudo"

log() { printf '==> %s\n' "$*"; }

case "$(uname -m)" in
  x86_64) NODE_ARCH=x64 ;;
  aarch64|arm64) NODE_ARCH=arm64 ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

log "System packages"
$SUDO apt-get update -qq
$SUDO apt-get install -y -qq git tmux jq ripgrep curl ca-certificates xz-utils gh >/dev/null

log "Node.js v$NODE_VERSION"
if [ "$(node -v 2>/dev/null || true)" != "v$NODE_VERSION" ]; then
  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
  base="https://nodejs.org/dist/v$NODE_VERSION"
  file="node-v$NODE_VERSION-linux-$NODE_ARCH.tar.xz"
  curl -fsSL "$base/$file" -o "$tmp/$file"
  curl -fsSL "$base/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
  (cd "$tmp" && grep " $file\$" SHASUMS256.txt | sha256sum -c -)
  $SUDO rm -rf "/opt/node-v$NODE_VERSION" && $SUDO mkdir -p "/opt/node-v$NODE_VERSION"
  $SUDO tar -xJf "$tmp/$file" -C "/opt/node-v$NODE_VERSION" --strip-components=1
  for bin in node npm npx; do $SUDO ln -sf "/opt/node-v$NODE_VERSION/bin/$bin" "/usr/local/bin/$bin"; done
fi

log "Claude Code $CLAUDE_CODE_VERSION"
if ! claude --version 2>/dev/null | grep -q "^$CLAUDE_CODE_VERSION "; then
  $SUDO npm install -g "@anthropic-ai/claude-code@$CLAUDE_CODE_VERSION"
fi

log "Environment (/etc/profile.d/factory-workspace.sh)"
$SUDO tee /etc/profile.d/factory-workspace.sh >/dev/null <<'EOF'
# Writer workspace: Claude Code runs on the subscription login, never on a metered API key.
unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN
export DISABLE_AUTOUPDATER=1
export FACTORY_WORKSPACE=1
EOF

log "Git defaults and the pre-push guard"
$SUDO mkdir -p /opt/factory/git-hooks
$SUDO install -m 0755 "$DIR/git-hooks/pre-push" /opt/factory/git-hooks/pre-push
$SUDO git config --system core.hooksPath /opt/factory/git-hooks
$SUDO git config --system init.defaultBranch main
$SUDO git config --system pull.ff only
$SUDO git config --system push.default current
git config --global user.name "$AGENT_NAME"
git config --global user.email "${AGENT_EMAIL:-$AGENT_NAME@users.noreply.github.com}"

log "Claude Code settings (~/.claude/settings.json)"
mkdir -p "$HOME/.claude"
if [ -f "$HOME/.claude/settings.json" ] && ! cmp -s "$DIR/claude-settings.json" "$HOME/.claude/settings.json"; then
  echo "    existing settings differ from the standard; leaving them. Standard is $DIR/claude-settings.json"
else
  install -m 0644 "$DIR/claude-settings.json" "$HOME/.claude/settings.json"
fi

log "Writer commands (~/.claude/commands)"
COMMANDS_SRC="$DIR/../../.claude/commands"
if [ -d "$COMMANDS_SRC" ]; then
  mkdir -p "$HOME/.claude/commands"
  # Owned by the repo: a file with the same name is replaced so every writer has the same commands.
  for f in "$COMMANDS_SRC"/*.md; do install -m 0644 "$f" "$HOME/.claude/commands/$(basename "$f")"; done
else
  echo "    no .claude/commands next to the workspace scripts (run this from a clone of the repo); skipped"
fi

log "tmux config"
[ -f "$HOME/.tmux.conf" ] || printf 'set -g history-limit 200000\nset -g mouse on\n' > "$HOME/.tmux.conf"

log "Secrets file (never put ANTHROPIC_API_KEY here)"
mkdir -p "$HOME/.config/factory"
if [ ! -f "$HOME/.config/factory/secrets.env" ]; then
  printf '# GITHUB_TOKEN: fine-grained token, this repo only, contents + pull requests, no admin\nGITHUB_TOKEN=\n' > "$HOME/.config/factory/secrets.env"
fi
chmod 600 "$HOME/.config/factory/secrets.env"

log "Doctor"
"$DIR/doctor.sh" || true
echo
echo "Next: run 'claude' once and log in with the subscription account (/login). Never export ANTHROPIC_API_KEY on this machine."
