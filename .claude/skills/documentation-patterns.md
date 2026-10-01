# Documentation Patterns Skill

Reusable documentation templates and formats for user guides, API docs, and deployment guides.

## Help Article Template

```markdown
# How to [Complete Task]

## Overview
One-sentence explanation of what this guide covers and why it matters.

## Prerequisites
- Item 1 (e.g., "Active account")
- Item 2 (e.g., "Admin permissions")
- Item 3 (e.g., "At least one project created")

## Step-by-Step

### Step 1: [Action]
1. Navigate to [Location]
2. Click on [Element]
3. Verify that [Expected Result]

**Tip:** [Helpful hint or shortcut]

### Step 2: [Action]
[Detailed steps...]

**Note:** [Important warning or clarification]

## Result
You have successfully [Completed task]. [Brief explanation of what changed or what's next].

## Troubleshooting

### Problem: [Common issue]
**Cause:** [Why this happens]  
**Solution:** [How to fix it]

### Problem: [Another issue]
**Cause:** [Why this happens]  
**Solution:** [How to fix it]

## Next Steps
- [Related guide 1]
- [Related guide 2]
- [Link to support]

## Related Articles
- [Link 1](#)
- [Link 2](#)
```

## FAQ Entry Template

```markdown
## Q: [User's actual question]

**A:** [Direct answer, 1-2 sentences]

[Optional: More context or explanation if needed]

[Optional: Code example or screenshot]

**Learn more:** [Link to detailed guide if available]
```

## API Documentation Template

```markdown
# API Reference

## Base URL
```
https://api.example.com/v1
```

## Authentication

All requests require a Bearer token:

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" https://api.example.com/v1/users/me
```

### Getting a Token

1. [Login endpoint]
2. [Store token]
3. [Include in requests]

## Endpoints

### POST /resource

Create a new resource.

**Request**

```bash
curl -X POST https://api.example.com/v1/resource \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Example",
    "description": "A test resource"
  }'
```

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | Yes | Name of the resource |
| description | string | No | Detailed description |

**Response (201 Created)**

```json
{
  "id": "res_123",
  "name": "Example",
  "description": "A test resource",
  "createdAt": "2024-01-15T10:30:00Z"
}
```

**Error Responses**

| Code | Message | Meaning |
|------|---------|---------|
| 400 | Missing required field: name | Validation failed |
| 401 | Unauthorized | Token invalid or missing |
| 409 | Resource already exists | Name must be unique |

### GET /resource/{id}

Retrieve a single resource by ID.

**Response (200 OK)**

```json
{
  "id": "res_123",
  "name": "Example",
  "description": "A test resource",
  "createdAt": "2024-01-15T10:30:00Z"
}
```

## Error Handling

All errors follow this format:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": {
      "field": "name",
      "issue": "too_short"
    }
  }
}
```

## Rate Limiting

- **Limit:** 100 requests per minute
- **Header:** `X-RateLimit-Remaining`
- **Retry After:** Check `Retry-After` header if 429

## Pagination

List endpoints support pagination:

```
GET /resources?limit=10&offset=0
```

Response includes `_meta`:

```json
{
  "data": [...],
  "_meta": {
    "total": 150,
    "limit": 10,
    "offset": 0,
    "hasMore": true
  }
}
```

## Webhooks

[If applicable, document webhook format and events]

## SDKs

- [JavaScript SDK](#)
- [Python SDK](#)
```

## Deployment Guide Template

```markdown
# Deployment to [Platform]

## Prerequisites

- [ ] [Requirement 1]
- [ ] [Requirement 2]
- [ ] [Requirement 3]

## Step 1: Prepare Environment

Set up environment variables:

```bash
DATABASE_URL=postgresql://user:pass@localhost:5432/db
API_KEY=your_api_key_here
NODE_ENV=production
```

## Step 2: Build Application

```bash
npm install
npm run build
```

Verify build completed successfully:

```bash
ls dist/
# Should show: index.js, config/, lib/
```

## Step 3: Run Migrations

```bash
npm run migrate
```

Expected output:

```
Migrations applied successfully
Tables: users, items, sessions
Schema version: 3
```

## Step 4: Deploy

```bash
[Platform-specific deploy command]
```

## Step 5: Verify Deployment

Check health endpoint:

```bash
curl https://your-app.com/health
```

Expected response:

```json
{
  "status": "healthy",
  "database": "connected",
  "uptime": "12345"
}
```

## Troubleshooting

### Issue: Database connection failed

**Error message:**
```
ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:5432
```

**Solution:**
1. Check DATABASE_URL is correct
2. Verify database is running: `psql $DATABASE_URL`
3. Run migrations: `npm run migrate`

### Issue: Application crashed after deploy

**Solution:**
1. Check logs: `[Platform] logs --tail 100`
2. Verify all env vars are set: `[Platform] config:get`
3. Rollback to previous version: `[Platform] releases:rollback`

## Monitoring

After deploy, monitor:

- **Logs:** [Platform] logs --follow
- **Metrics:** [Dashboard URL]
- **Alerts:** Set up in [Monitoring tool]

## Rollback

If deployment fails:

```bash
[Platform-specific rollback command]
```

## Next Steps

- [Link to monitoring guide]
- [Link to scaling guide]
- [Link to support]
```

## Release Notes Template

```markdown
# Version X.Y.Z - [Date]

## Overview
[Brief summary of this release's purpose and impact]

## New Features

### [Feature Name]
[Description of what changed and why]

**Example usage:**
```
[Code example if applicable]
```

### [Feature Name]
[Description]

## Improvements

- [Performance improvement with metrics if available]
- [UX improvement description]
- [Optimization description]

## Bug Fixes

- [Fixed: description of what was broken and is now fixed]
- [Fixed: another bug]

## Breaking Changes

⚠️ This release includes breaking changes.

### [Breaking Change Name]

**Before:**
```
[Code example]
```

**After:**
```
[Updated code example]
```

**Migration guide:** [Link or instructions]

## Deprecations

The following are deprecated and will be removed in v[X+1].0:

- `oldFunction()` → Use `newFunction()` instead
- `oldProperty` → Use `newProperty` instead

## Performance

[If applicable, include performance improvements]

- API response time: 45ms → 20ms (55% improvement)
- Bundle size: 150KB → 120KB (20% reduction)

## Known Issues

- [Issue description and workaround if available]

## Migration Guide

For users upgrading from v[X-1]:

1. [Update command or steps]
2. [Run migrations if needed]
3. [Test procedure]

## Contributors

Thanks to [@user1](#), [@user2](#) for contributions to this release.

## Downloads

- [Changelog](releases/v[X.Y.Z].md)
- [Source Code](github.com/...)
- [Docs](docs/v[X.Y.Z])

---

[Link to previous release]
```

## Onboarding Email Series Template

### Day 0: Welcome

**Subject:** Welcome to [Product]! 🚀

```
Hi [Name],

Your account is ready to go. Here's what you can do now:

1. [First action] - Takes 2 minutes
2. [Second action] - Takes 5 minutes
3. [Third action] - Takes 10 minutes

[CTA Button: Get Started]

Questions? Reply to this email or contact support@example.com

Best,
[Your Name]
```

### Day 1: Getting Started

**Subject:** 5-minute guide: Your first [item]

```
Hi [Name],

Ready to create your first [item]? Follow this quick guide:

1. Go to [Link]
2. Click [Button]
3. Fill in [Fields]
4. Click Save

[Video link if available]

You're doing great!
[Your Name]
```

### Day 3: Going Deeper

**Subject:** Advanced tips for [Product]

```
Hi [Name],

Now that you've created your first [item], try these power features:

- Feature 1: [Description]
- Feature 2: [Description]
- Feature 3: [Description]

[Link to advanced guide]

[Your Name]
```

### Day 7: We're Here

**Subject:** How we can help

```
Hi [Name],

You're part of the [Product] community! We're here to support you:

- [Help center link]
- [Community forum link]
- [Contact support email]

Don't hesitate to reach out.

[Your Name]
```

## Error Message Template

| Scenario | Message | Action |
|----------|---------|--------|
| Missing required field | "Email is required" | Show field highlight |
| Invalid format | "Please enter a valid email address" | Show example format |
| Item not found | "Workspace not found" | Suggest alternatives |
| Permission denied | "You don't have access to this workspace" | Show admin contact |
| Server error | "Something went wrong. Please try again." | Show retry button |
| Network error | "Check your connection and try again" | Show offline indicator |
| Timeout | "Request took too long. Please try again." | Show retry button |

## Checklist for Documentation

- [ ] Audience identified (users, developers, admins)
- [ ] Goals stated (what should reader accomplish?)
- [ ] Prerequisites listed
- [ ] Steps are numbered and clear
- [ ] Each step has expected result
- [ ] Screenshots/diagrams included where helpful
- [ ] Troubleshooting covers common issues
- [ ] Related articles linked
- [ ] Grammar and tone consistent
- [ ] Examples are correct and tested
- [ ] Links are working
- [ ] Mobile-friendly formatting
