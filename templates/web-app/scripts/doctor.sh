#!/usr/bin/env bash
# Checks the local setup and says how to fix each problem. Safe to run any time: it only reads.
# Usage: npm run doctor
cd "$(dirname "$0")/.." || exit 1
fail=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n    fix: %s\n' "$1" "$2"; fail=1; }
note() { printf '  \033[33m!\033[0m %s\n' "$1"; }

echo "Node and packages"
want=$(tr -d 'v \n' < .nvmrc 2>/dev/null | cut -d. -f1)
have=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null)
if [ -z "$have" ]; then bad "Node is not installed" "install Node ${want:-24} (nvm install)";
elif [ -n "$want" ] && [ "$have" != "$want" ]; then bad "Node $have, the project uses $want" "nvm install && nvm use";
else ok "Node $have"; fi
if [ ! -d node_modules ]; then bad "node_modules is missing" "npm install";
elif [ package-lock.json -nt node_modules ]; then bad "package-lock.json is newer than node_modules" "npm install";
else ok "dependencies are installed and current"; fi

echo "Environment"
if [ ! -f .env ]; then bad ".env is missing" "cp .env.example .env";
else
  missing=""
  while IFS='=' read -r key _; do
    case "$key" in ''|\#*) continue;; esac
    grep -Eq "^${key}=.+" .env || missing="$missing $key"
  done < .env.example
  if [ -n "$missing" ]; then bad "variables in .env.example but not set in .env:$missing" "add them to .env (see .env.example)"; else ok ".env sets every variable in .env.example"; fi
fi

echo "Ports"
port=$(grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2); port=${port:-5173}
if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then note "port $port is in use (fine if the dev server is already running)"; else ok "port $port is free"; fi

if grep -q '^  db:' docker-compose.yml 2>/dev/null; then
  echo "Database"
  if ! command -v docker >/dev/null 2>&1; then note "docker is not installed: use your own Postgres and set DATABASE_URL";
  elif (exec 3<>"/dev/tcp/127.0.0.1/5432") 2>/dev/null; then ok "something is listening on 5432";
  else bad "nothing is listening on 5432" "npm run db:up"; fi
fi

echo "Developer tools"
if [ "$(git config core.hooksPath 2>/dev/null)" = ".githooks" ]; then ok "git hooks are on (format and lint on commit)"; else bad "git hooks are off" "npm run prepare"; fi

echo
if [ $fail -eq 0 ]; then echo "All good. Start with: npm run dev"; else echo "Fix the items marked ✗, then run: npm run doctor"; exit 1; fi
