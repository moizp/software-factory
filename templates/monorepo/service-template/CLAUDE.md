# Service: <name>

Scope: only change files under `services/<name>/`. Anything under `contracts/` or `libs/` is shared: do not edit it as part of a service change; propose it as a separate PR.

## Commands
- Build: `<build command>`
- Test: `<test command>` (must pass before every push)
- Run locally: `<run command>`

## Conventions
- Language, framework and layout: <fill in>
- Public interface (what other services may call): documented in `contracts/<name>/`. Never change a published contract without a versioned, backwards-compatible path.
- Data: this service owns its tables; no other service reads them directly.

## Risk notes for the writer
- R3 areas in this service: <auth, money, migrations, deploy script>
- Always state the risk tier you expect in the PR body.
