# Branch Specification Files

Each branch can contain a `.branchspec.json` file that controls automation, review requirements, and merge behavior for autonomous agents.

## Purpose

Branch specs allow you to:
- ✅ Control whether agents can auto-merge PRs
- ✅ Require specific approval counts or reviewers
- ✅ Enforce test coverage and CI requirements
- ✅ Protect critical files from autonomous changes
- ✅ Define scope and impact of the branch
- ✅ Document special handling needed

## File Location

Place `.branchspec.json` in the **root of your branch** (same level as package.json, README.md).

```
feature/your-feature/
├── .branchspec.json  ← Create this file
├── package.json
├── README.md
└── ...
```

## Schema

```json
{
  "$schema": "https://example.com/branchspec-schema.json",
  "version": "1.0",
  "description": "What this branch does",
  
  "automation": {
    "auto_merge": false,
    "allow_agent_approval": false,
    "require_human_review": true
  },
  
  "review_requirements": {
    "minimum_approvals": 1,
    "require_code_owner_approval": false,
    "require_specific_reviewers": false,
    "reviewers": ["alice@example.com", "bob@example.com"]
  },
  
  "testing": {
    "require_tests": true,
    "minimum_coverage": 70,
    "required_test_files": [
      ".factory/__tests__/**/*.test.ts"
    ]
  },
  
  "ci": {
    "required_checks": ["build", "test", "lint"],
    "allow_ci_failures": false
  },
  
  "protected_areas": {
    "critical_files": [
      ".factory/orchestrator.ts",
      ".factory/state.ts",
      ".github/workflows/**"
    ],
    "require_extra_review_for_critical": true
  },
  
  "scope": {
    "type": "feature",
    "description": "Description of what this branch adds",
    "components_affected": ["orchestrator", "state-management"],
    "breaking_changes": false
  }
}
```

## Configuration Options

### `automation`

Controls whether autonomous agents can perform actions on this branch.

```json
{
  "automation": {
    "auto_merge": false,
    "allow_agent_approval": false,
    "require_human_review": true
  }
}
```

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `auto_merge` | boolean | false | Agent can merge PR after approval |
| `allow_agent_approval` | boolean | false | Agent can approve its own PR |
| `require_human_review` | boolean | true | Human must review before merge |

**Agent Behavior:**
- `auto_merge: true` + `allow_agent_approval: true` = Agent can review AND merge
- `auto_merge: true` + `allow_agent_approval: false` = Agent can merge IF human approved
- `auto_merge: false` = Agent creates PR, waits for human approval & merge

### `review_requirements`

Controls who must review and approve.

```json
{
  "review_requirements": {
    "minimum_approvals": 1,
    "require_code_owner_approval": false,
    "require_specific_reviewers": false,
    "reviewers": ["alice@example.com"]
  }
}
```

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `minimum_approvals` | number | 1 | How many approvals needed |
| `require_code_owner_approval` | boolean | false | CODEOWNERS file must approve |
| `require_specific_reviewers` | boolean | false | Specific people must review |
| `reviewers` | array | [] | Email addresses of required reviewers |

### `testing`

Controls test requirements before merge.

```json
{
  "testing": {
    "require_tests": true,
    "minimum_coverage": 70,
    "required_test_files": [".factory/__tests__/**/*.test.ts"]
  }
}
```

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `require_tests` | boolean | true | Tests must exist and pass |
| `minimum_coverage` | number | 70 | Minimum code coverage % |
| `required_test_files` | array | [] | Test files that must exist |

### `ci`

Controls CI/CD requirements.

```json
{
  "ci": {
    "required_checks": ["build", "test", "lint"],
    "allow_ci_failures": false
  }
}
```

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `required_checks` | array | [] | CI checks that must pass |
| `allow_ci_failures` | boolean | false | Merge if CI fails |

### `protected_areas`

Mark critical files that need extra review.

```json
{
  "protected_areas": {
    "critical_files": [
      ".factory/orchestrator.ts",
      ".factory/state.ts",
      ".github/workflows/**"
    ],
    "require_extra_review_for_critical": true
  }
}
```

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `critical_files` | array | [] | Glob patterns of protected files |
| `require_extra_review_for_critical` | boolean | true | Extra approval if critical files change |

### `scope`

Describes what this branch does (informational for agents).

```json
{
  "scope": {
    "type": "feature",
    "description": "Add skeptical-reviewer agent",
    "components_affected": ["agents", "orchestrator"],
    "breaking_changes": false
  }
}
```

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `type` | string | "feature" | feature\|fix\|chore\|enhancement\|hotfix |
| `description` | string | "" | What this branch accomplishes |
| `components_affected` | array | [] | Which parts of the system change |
| `breaking_changes` | boolean | false | Does this break backward compatibility |

## Usage Examples

### Example 1: Simple Feature (Agent Can Merge)

```json
{
  "version": "1.0",
  "description": "Add UI Designer agent",
  "automation": {
    "auto_merge": true,
    "allow_agent_approval": true,
    "require_human_review": false
  },
  "review_requirements": {
    "minimum_approvals": 0
  },
  "testing": {
    "require_tests": true,
    "minimum_coverage": 70
  },
  "ci": {
    "required_checks": ["build", "test"]
  },
  "scope": {
    "type": "feature",
    "description": "Implement UI Designer agent for design system generation",
    "components_affected": ["agents"],
    "breaking_changes": false
  }
}
```

### Example 2: Orchestrator Fix (Requires Human Review)

```json
{
  "version": "1.0",
  "description": "Fix critical orchestrator bug",
  "automation": {
    "auto_merge": false,
    "allow_agent_approval": false,
    "require_human_review": true
  },
  "review_requirements": {
    "minimum_approvals": 2,
    "require_specific_reviewers": true,
    "reviewers": ["alice@example.com"]
  },
  "testing": {
    "require_tests": true,
    "minimum_coverage": 80,
    "required_test_files": [
      ".factory/__tests__/orchestrator.test.ts"
    ]
  },
  "ci": {
    "required_checks": ["build", "test", "lint"],
    "allow_ci_failures": false
  },
  "protected_areas": {
    "critical_files": [
      ".factory/orchestrator.ts",
      ".factory/state.ts"
    ],
    "require_extra_review_for_critical": true
  },
  "scope": {
    "type": "fix",
    "description": "Fix parallel phase artifact collection bug",
    "components_affected": ["orchestrator", "state-management"],
    "breaking_changes": false
  }
}
```

### Example 3: Infrastructure Change (Lock Down)

```json
{
  "version": "1.0",
  "description": "Update GitHub Actions workflows",
  "automation": {
    "auto_merge": false,
    "allow_agent_approval": false,
    "require_human_review": true
  },
  "review_requirements": {
    "minimum_approvals": 2,
    "require_code_owner_approval": true,
    "require_specific_reviewers": true,
    "reviewers": ["devops-team@example.com"]
  },
  "testing": {
    "require_tests": true
  },
  "ci": {
    "required_checks": ["build", "test"],
    "allow_ci_failures": false
  },
  "protected_areas": {
    "critical_files": [
      ".github/workflows/**",
      ".factory/orchestrator.ts"
    ],
    "require_extra_review_for_critical": true
  },
  "scope": {
    "type": "chore",
    "description": "Update CI/CD pipelines for parallel execution",
    "components_affected": ["ci-cd", "infrastructure"],
    "breaking_changes": false
  }
}
```

### Example 4: Hotfix (Agent Can Merge After Human Approves)

```json
{
  "version": "1.0",
  "description": "Critical production hotfix",
  "automation": {
    "auto_merge": true,
    "allow_agent_approval": false,
    "require_human_review": true
  },
  "review_requirements": {
    "minimum_approvals": 1
  },
  "testing": {
    "require_tests": true,
    "minimum_coverage": 80
  },
  "ci": {
    "required_checks": ["build", "test"],
    "allow_ci_failures": false
  },
  "scope": {
    "type": "hotfix",
    "description": "Fix security vulnerability in credential handling",
    "components_affected": ["security", "claude-bridge"],
    "breaking_changes": false
  }
}
```

## Agent Behavior

When an agent encounters a branch with `.branchspec.json`, it:

1. **Reads the spec** — Checks automation and review requirements
2. **Creates PR** — Always creates a PR (never commits directly)
3. **Checks auto_merge** — Does merge permission allow it?
   - If `auto_merge: true` → waits for human approval, then merges
   - If `auto_merge: false` → stops after PR creation, waits for human merge
4. **Respects approval requirements** — Won't merge without required approvals
5. **Validates CI/tests** — Won't merge if tests fail or coverage too low
6. **Documents findings** — Includes branch spec info in PR description

### Agent PR Comment

When creating a PR, agent includes:

```markdown
## Branch Specification

**Automation:** Manual merge required
**Minimum Approvals:** 2
**Coverage Required:** 80%
**Protected Files:** orchestrator.ts, state.ts
**Scope:** fix — Fix parallel phase artifact collection

---

[Agent can auto-merge after requirements met: false]
```

## Creating a Branch Spec

### Quick Start

```bash
# 1. Create your feature branch
git checkout -b feature/my-feature

# 2. Copy the example template
cp .branchspec.json.example .branchspec.json

# 3. Edit to match your branch's requirements
nano .branchspec.json

# 4. Commit the spec
git add .branchspec.json
git commit -m "docs: add branch spec"

# 5. Push and create PR
git push -u origin feature/my-feature
```

### Validation

Check your branch spec is valid:

```bash
# Validate JSON format
npm run validate:branchspec

# Or manually
jq . .branchspec.json > /dev/null && echo "✅ Valid"
```

## Default Behavior (No Spec File)

If a branch has **no `.branchspec.json`**, agents use these defaults:

```json
{
  "automation": {
    "auto_merge": false,
    "allow_agent_approval": false,
    "require_human_review": true
  },
  "review_requirements": {
    "minimum_approvals": 1
  },
  "testing": {
    "require_tests": true,
    "minimum_coverage": 70
  },
  "ci": {
    "required_checks": ["build", "test"]
  }
}
```

**In other words:** Conservative defaults. All branches require human review unless explicitly configured otherwise.

## Best Practices

✅ **DO**
- Add `.branchspec.json` to **every feature branch**
- Be specific about what's critical
- Keep requirements realistic
- Document why you need extra reviewers
- Use globs for protected file patterns
- Include breaking change notice

❌ **DON'T**
- Leave branches without specs if they touch core files
- Set `auto_merge: true` for untested changes
- Require reviewers who don't exist
- Use `allow_ci_failures: true` for important branches
- Skip test requirements for infrastructure changes

## Examples in This Repo

See existing branch specs:

```bash
# Feature branch example
git show origin/feature/add-skeptical-reviewer:.branchspec.json

# Hotfix example
git show origin/hotfix/security-fix:.branchspec.json
```

---

**Last Updated:** 2026-10-01

See also: [CONTRIBUTING.md](../CONTRIBUTING.md), [CLAUDE.md](../.claude/CLAUDE.md)
