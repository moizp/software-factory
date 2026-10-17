#!/usr/bin/env bash
# Turns this VM into the Oracle lane: a self-hosted GitHub Actions runner labelled `oracle`, plus the heartbeat timer.
# Run bootstrap.sh first (Node, Claude Code, git guard). Run as a sudo-capable user; the runner itself runs as RUNNER_USER.
#
# Usage: install-runner.sh --repo owner/name [--user runner] [--version X.Y.Z --sha256 HASH] [--dry-run]
#   Registration needs a short-lived token: either RUNNER_TOKEN in the environment, or `gh` logged in as a repo admin
#   (it then asks GitHub for one). The runner uses its user's Claude login; log in once with `claude` and /login.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../versions.env
source "$DIR/../versions.env"

REPO=""; RUNNER_USER="runner"; VERSION="${RUNNER_VERSION:-}"; SHA256=""; DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    --user) RUNNER_USER="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    --sha256) SHA256="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ "$REPO" =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]] || { echo "--repo owner/name is required" >&2; exit 2; }
[[ "$RUNNER_USER" =~ ^[a-z_][a-z0-9_-]*$ ]] || { echo "invalid --user" >&2; exit 2; }
if [ -n "${ANTHROPIC_API_KEY:-}${ANTHROPIC_AUTH_TOKEN:-}" ]; then
  echo "ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN is set: unset it, jobs on this runner must use the account login." >&2; exit 1
fi

SUDO=""; [ "$(id -u)" -eq 0 ] || SUDO="sudo"
log() { printf '==> %s\n' "$*"; }
run() { if [ "$DRY" -eq 1 ]; then printf '[dry-run] %s\n' "$*"; else "$@"; fi; }

case "$(uname -m)" in
  x86_64) ARCH=x64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

if [ -z "$VERSION" ]; then
  log "Resolving the latest runner release"
  VERSION="$(gh api repos/actions/runner/releases/latest --jq .tag_name | sed 's/^v//')"
  echo "    using $VERSION; set RUNNER_VERSION=$VERSION in versions.env once it works"
fi
if [ -z "$SHA256" ]; then
  log "Reading the published checksum for linux-$ARCH"
  SHA256="$(gh api "repos/actions/runner/releases/tags/v$VERSION" --jq .body \
    | grep -o "BEGIN SHA linux-$ARCH -->[0-9a-f]\{64\}" | grep -o '[0-9a-f]\{64\}' | head -1)"
  [ -n "$SHA256" ] || { echo "could not find a checksum for v$VERSION linux-$ARCH; pass --sha256" >&2; exit 1; }
fi

FILE="actions-runner-linux-$ARCH-$VERSION.tar.gz"
URL="https://github.com/actions/runner/releases/download/v$VERSION/$FILE"
HOME_DIR=/opt/actions-runner

log "Runner user $RUNNER_USER"
id "$RUNNER_USER" >/dev/null 2>&1 || run $SUDO useradd --create-home --shell /bin/bash "$RUNNER_USER"

log "Download and verify $FILE"
if [ "$DRY" -eq 1 ]; then
  echo "[dry-run] curl -fsSL $URL, check sha256 $SHA256, extract to $HOME_DIR"
else
  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
  curl -fsSL "$URL" -o "$tmp/$FILE"
  echo "$SHA256  $tmp/$FILE" | sha256sum -c -
  $SUDO mkdir -p "$HOME_DIR"
  $SUDO tar -xzf "$tmp/$FILE" -C "$HOME_DIR"
  $SUDO chown -R "$RUNNER_USER":"$RUNNER_USER" "$HOME_DIR"
fi

log "Register with $REPO (label: oracle)"
TOKEN="${RUNNER_TOKEN:-}"
if [ -z "$TOKEN" ] && [ "$DRY" -eq 0 ]; then
  TOKEN="$(gh api -X POST "repos/$REPO/actions/runners/registration-token" --jq .token)"
fi
if [ "$DRY" -eq 1 ]; then
  echo "[dry-run] $HOME_DIR/config.sh --unattended --url https://github.com/$REPO --labels oracle --name $(hostname)-oracle --replace (as $RUNNER_USER)"
else
  $SUDO -u "$RUNNER_USER" "$HOME_DIR/config.sh" --unattended --url "https://github.com/$REPO" --token "$TOKEN" \
    --labels oracle --name "$(hostname)-oracle" --replace
fi

log "Runner environment and service"
if [ "$DRY" -eq 1 ]; then
  echo "[dry-run] write $HOME_DIR/.env (DISABLE_AUTOUPDATER=1), $HOME_DIR/svc.sh install $RUNNER_USER, svc.sh start"
else
  echo "DISABLE_AUTOUPDATER=1" | $SUDO tee "$HOME_DIR/.env" >/dev/null
  (cd "$HOME_DIR" && $SUDO ./svc.sh install "$RUNNER_USER" && $SUDO ./svc.sh start)
fi

log "Heartbeat timer"
run $SUDO mkdir -p /opt/factory/runner /etc/factory
run $SUDO install -m 0755 "$DIR/heartbeat.sh" /opt/factory/runner/heartbeat.sh
if [ "$DRY" -eq 1 ]; then
  echo "[dry-run] write /etc/factory/oracle.env (REPO=$REPO), install the .service and .timer, systemctl enable --now oracle-heartbeat.timer"
else
  printf 'REPO=%s\nMIN_FREE_DISK_GB=%s\n' "$REPO" "$MIN_FREE_DISK_GB" | $SUDO tee /etc/factory/oracle.env >/dev/null
  $SUDO sed "s/^User=runner$/User=$RUNNER_USER/" "$DIR/oracle-heartbeat.service" | $SUDO tee /etc/systemd/system/oracle-heartbeat.service >/dev/null
  $SUDO install -m 0644 "$DIR/oracle-heartbeat.timer" /etc/systemd/system/oracle-heartbeat.timer
  $SUDO systemctl daemon-reload
  $SUDO systemctl enable --now oracle-heartbeat.timer
fi

cat <<NEXT

Done. Remaining by hand:
  1. As $RUNNER_USER: run 'claude' once and log in with the account that should pay for long jobs (/login).
  2. As $RUNNER_USER: create ~/.config/factory/heartbeat.env (mode 600) containing GH_TOKEN=<fine-grained token for $REPO,
     Variables read and write only>. Without it the heartbeat is withheld and the router sends no long jobs here.
  3. Check: ./check-runner.sh   (waits for the first heartbeat; the repository variable ORACLE_LAST_SEEN should appear)
NEXT
