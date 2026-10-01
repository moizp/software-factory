#!/bin/bash

# Validate .branchspec.json file in current branch

set -e

BRANCHSPEC_FILE=".branchspec.json"

echo "🔍 Validating branch specification..."

# Check if file exists
if [ ! -f "$BRANCHSPEC_FILE" ]; then
  echo "⚠️  No $BRANCHSPEC_FILE found. Using default conservative settings."
  echo "   (All changes will require human review)"
  exit 0
fi

# Check JSON validity
if ! jq . "$BRANCHSPEC_FILE" > /dev/null 2>&1; then
  echo "❌ Invalid JSON in $BRANCHSPEC_FILE"
  echo ""
  echo "Run: jq . .branchspec.json"
  echo "to see the error."
  exit 1
fi

# Get values
SCHEMA=$(jq -r '.version // "unknown"' "$BRANCHSPEC_FILE")
AUTO_MERGE=$(jq -r '.automation.auto_merge // false' "$BRANCHSPEC_FILE")
ALLOW_AGENT_APPROVAL=$(jq -r '.automation.allow_agent_approval // false' "$BRANCHSPEC_FILE")
REQUIRE_HUMAN=$(jq -r '.automation.require_human_review // true' "$BRANCHSPEC_FILE")
MIN_APPROVALS=$(jq -r '.review_requirements.minimum_approvals // 1' "$BRANCHSPEC_FILE")
REQUIRE_TESTS=$(jq -r '.testing.require_tests // true' "$BRANCHSPEC_FILE")
MIN_COVERAGE=$(jq -r '.testing.minimum_coverage // 70' "$BRANCHSPEC_FILE")
SCOPE_TYPE=$(jq -r '.scope.type // "unknown"' "$BRANCHSPEC_FILE")
BREAKING=$(jq -r '.scope.breaking_changes // false' "$BRANCHSPEC_FILE")

echo "✅ Valid JSON"
echo ""
echo "📋 Branch Specification:"
echo "  Version: $SCHEMA"
echo "  Type: $SCOPE_TYPE"
echo ""
echo "🔐 Automation Rules:"
echo "  Auto-merge: $AUTO_MERGE"
echo "  Agent can approve: $ALLOW_AGENT_APPROVAL"
echo "  Require human review: $REQUIRE_HUMAN"
echo ""
echo "👥 Review Requirements:"
echo "  Minimum approvals: $MIN_APPROVALS"
echo ""
echo "✅ Testing Requirements:"
echo "  Tests required: $REQUIRE_TESTS"
echo "  Minimum coverage: $MIN_COVERAGE%"
echo ""
echo "⚠️  Breaking Changes: $BREAKING"
echo ""

# Warnings
if [ "$AUTO_MERGE" == "true" ] && [ "$REQUIRE_TESTS" == "false" ]; then
  echo "⚠️  WARNING: auto_merge=true but require_tests=false"
  echo "   Consider requiring tests before auto-merge."
fi

if [ "$AUTO_MERGE" == "true" ] && [ "$MIN_APPROVALS" == "0" ]; then
  echo "⚠️  WARNING: auto_merge=true but no approvals required"
  echo "   This branch can merge without human review!"
fi

if [ "$BREAKING" == "true" ] && [ "$MIN_APPROVALS" -lt "2" ]; then
  echo "⚠️  WARNING: Breaking changes marked but only $MIN_APPROVALS approval(s) required"
  echo "   Consider requiring 2+ approvals for breaking changes."
fi

echo ""
echo "✅ Branch spec is valid!"
