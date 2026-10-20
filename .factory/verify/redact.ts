/**
 * The report is meant to be pasted somewhere, so anything that looks like a credential is replaced before it is
 * written. This is a safety net: the checks print names of secrets and variables, never their values.
 */
const PATTERNS: Array<[RegExp, string]> = [
  [/AKIA[0-9A-Z]{16}/g, '[aws-key]'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[private-key]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, '[github-token]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, '[github-token]'],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, '[api-key]'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, '[slack-token]'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi, 'Bearer [token]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[jwt]'],
  [/\b([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|KEY))=\S+/g, '$1=[redacted]'],
  [/("[A-Za-z_]*(?:token|secret|password|api_?key)[A-Za-z_]*"\s*:\s*")[^"]{8,}(")/gi, '$1[redacted]$2']
];

export function redact(text: string): string {
  return PATTERNS.reduce((t, [re, to]) => t.replace(re, to), text);
}
