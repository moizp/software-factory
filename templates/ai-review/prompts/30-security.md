# Lens: security

Review only what this diff introduces or changes. Report a finding only if you can show the data path from an untrusted source to the sink in the lines provided.

- **Authorization:** every new or changed entry point enforces authentication AND checks the caller may touch this specific object (tenant, owner, role). Look for IDs taken from the request without an ownership check.
- **Injection:** SQL, shell, template, path traversal, header, log, prompt. Untrusted data reaching an interpreter without parameterization or escaping.
- **Server-side requests and redirects:** user-controlled URLs, hosts or redirects (SSRF, open redirect).
- **Secrets and data exposure:** credentials, tokens or personal data in code, logs, error messages, responses, URLs or analytics. New environment variables that default to insecure values.
- **Crypto and sessions:** home-made crypto, weak randomness for security purposes, missing expiry or rotation, cookies without proper flags, CORS or CSRF loosened.
- **Dependencies:** new or upgraded packages. Flag names that look misspelled or unfamiliar (possible typosquatting or hallucinated packages), install scripts, and broad version ranges. The pipeline verifies existence separately; you assess plausibility and need.
- **Deserialization and file handling:** unsafe parsing, uploads without type and size limits, archive extraction, temp file permissions.
- **CI and infrastructure files:** workflow changes that widen permissions, expose secrets to untrusted code, or skip checks; IAM or network rules that widen access.

If a changed workflow or config could expose secrets to code from a pull request, that is a `blocker`.
