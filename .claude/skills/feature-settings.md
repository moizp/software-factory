# Feature Settings Skill

Runtime feature toggles for generated SaaS apps, stored in the backend and managed from an admin login. Not a vendor flag service. Deploy and release stay separate: code can ship dark and be switched on later, per environment.

## Data model

```sql
CREATE TABLE feature_settings (
  env         TEXT    NOT NULL,   -- test | demo | prod (each env also has its own DB)
  key         TEXT    NOT NULL,   -- must exist in the code registry
  enabled     BOOLEAN NOT NULL,
  updated_by  TEXT    NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (env, key)
);

CREATE TABLE feature_settings_audit (
  id          BIGSERIAL PRIMARY KEY,
  env         TEXT NOT NULL,
  key         TEXT NOT NULL,
  old_value   BOOLEAN,
  new_value   BOOLEAN NOT NULL,
  changed_by  TEXT NOT NULL,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## Code registry (source of truth for what can exist)

```typescript
export const FEATURES = {
  'billing.invoices': { description: 'Invoice module', default: false, owner: 'payments-team' },
} as const;
export type FeatureKey = keyof typeof FEATURES;
```

- A missing row falls back to the registry default (default off for new features).
- The admin UI and API only accept keys in the registry.
- Remove a registry entry and its rows once a feature is permanently on or off (flag rot).

## API

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /api/config/features` | any signed-in user | Resolved flags for the frontend (cache 30-60 s) |
| `GET /api/admin/features` | admin | Registry merged with current values and last change |
| `PUT /api/admin/features/:key` | admin | Set `enabled`, write the audit row in one transaction |
| `GET /api/admin/features/audit` | admin | Change history |

## Rules

- Enforce security-relevant flags on the server; the frontend flag only hides UI.
- Admin role only (RBAC). No secrets in this table.
- Every change writes an audit row (who, when, old, new).
- Provide config export/import so settings can be reviewed and restored (they are not in git).
- Tests cover both states of every flag.

## Who does what

- software-architect: add the tables, the registry, and the admin API to the design.
- backend-engineer: implement the endpoints, the cache, and the audit log.
- frontend-engineer: read `/api/config/features` once per session; build the admin screen.
