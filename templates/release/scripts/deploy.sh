#!/usr/bin/env bash
# Deploy contract used by .github/workflows/promote.yml.
#
#   ./scripts/deploy.sh <env> <sha>
#
# Inputs (env vars): DEPLOY_ENV (test|demo|prod), DEPLOY_SHA, DEPLOY_TOKEN
# Exit 0 only when the environment is deployed AND healthy (run a health check
# before returning). Any non-zero exit stops the promotion.
#
# Implement for the platform this app uses (Vercel, Netlify, Cloudflare Pages,
# a VPS over SSH, ...). The infrastructure-engineer agent generates this file.
set -euo pipefail

echo "deploy.sh is not implemented for this app (env=${1:-?} sha=${2:-?})" >&2
exit 1
