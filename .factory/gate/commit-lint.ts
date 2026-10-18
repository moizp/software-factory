import { lintProse } from './prose-lint';

/**
 * Commit message rules from CONTRIBUTING.md, checked without a model: a single line, conventional type, imperative
 * mood is left to the writer, no trailing period, no attribution. Used by the /commit writer command.
 */

export const COMMIT_TYPES = ['feat', 'fix', 'docs', 'chore', 'test', 'ci', 'perf', 'refactor'] as const;

/** CONTRIBUTING.md says 50. Beyond the hard limit a message is an error; between the two it is a warning. */
export const SOFT_LIMIT = 50;
export const HARD_LIMIT = 72;

export interface CommitReport {
  errors: string[];
  warnings: string[];
}

export function lintCommitMessage(message: string): CommitReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const text = message.replace(/\r\n/g, '\n').replace(/\n+$/, '');

  if (!text.trim()) return { errors: ['the message is empty'], warnings };
  if (text.includes('\n')) errors.push('the message must be a single line: no body, no trailers (the branch history is kept by merge commits, so each commit says it all in one line)');

  const subject = text.split('\n')[0];
  const m = /^([a-z]+)(\([a-z0-9-]+\))?(!)?: (\S.*)$/.exec(subject);
  if (!m) {
    errors.push(`the subject must look like "type: description" with type one of ${COMMIT_TYPES.join(', ')}`);
  } else {
    if (!(COMMIT_TYPES as readonly string[]).includes(m[1])) errors.push(`unknown type "${m[1]}"; use one of ${COMMIT_TYPES.join(', ')}`);
    if (/^[A-Z]/.test(m[4])) warnings.push('start the description in lower case');
  }
  if (/[.!?]$/.test(subject)) errors.push('no trailing punctuation');
  if (subject.length > HARD_LIMIT) errors.push(`the subject is ${subject.length} characters; the limit is ${HARD_LIMIT}, aim for ${SOFT_LIMIT}`);
  else if (subject.length > SOFT_LIMIT) warnings.push(`the subject is ${subject.length} characters; aim for ${SOFT_LIMIT}`);

  for (const v of lintProse(text)) (v.severity === 'error' ? errors : warnings).push(`${v.rule} ("${v.match}")`);
  return { errors, warnings };
}

export function renderCommitReport(r: CommitReport): string {
  if (!r.errors.length && !r.warnings.length) return 'Commit message: no issues.';
  return ['Commit message:', ...r.errors.map(e => `- error: ${e}`), ...r.warnings.map(w => `- warning: ${w}`)].join('\n');
}
