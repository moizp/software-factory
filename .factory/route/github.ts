import { execFileSync } from 'child_process';
import { Permission } from './types';

/** Thin `gh` wrapper. Everything here touches the network, so it stays out of the pure modules and unit tests. */
function gh(args: string[], input?: string): string {
  return execFileSync('gh', args, { encoding: 'utf-8', input, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

const repo = (): string => {
  const r = process.env.GITHUB_REPOSITORY;
  if (!r) throw new Error('GITHUB_REPOSITORY is not set');
  return r;
};

export function collaboratorPermission(login: string): Permission {
  try {
    const p = gh(['api', `repos/${repo()}/collaborators/${encodeURIComponent(login)}/permission`, '--jq', '.permission']);
    return (['admin', 'maintain', 'write', 'triage', 'read'] as Permission[]).includes(p as Permission) ? (p as Permission) : 'none';
  } catch {
    return 'none';
  }
}

export interface IssueInfo {
  number: number;
  labels: string[];
  author: string;
  body: string;
  title: string;
}

export function readIssue(n: number): IssueInfo {
  const j = JSON.parse(gh(['issue', 'view', String(n), '--json', 'number,labels,author,body,title']));
  return {
    number: j.number,
    labels: j.labels.map((l: { name: string }) => l.name),
    author: j.author?.login ?? '',
    body: j.body ?? '',
    title: j.title ?? ''
  };
}

export function ensureLabels(labels: string[]): void {
  for (const l of labels) {
    try { gh(['label', 'create', l, '--force', '--color', l.startsWith('lane:') ? '1D76DB' : '5319E7']); } catch { /* exists */ }
  }
}

export function editLabels(n: number, add: string[], remove: string[]): void {
  ensureLabels(add);
  if (add.length) gh(['issue', 'edit', String(n), '--add-label', add.join(',')]);
  if (remove.length) gh(['issue', 'edit', String(n), '--remove-label', remove.join(',')]);
}

export function postComment(n: number, body: string): number {
  return parseInt(gh(['api', `repos/${repo()}/issues/${n}/comments`, '-F', 'body=@-', '--jq', '.id'], body), 10);
}

export function editComment(id: number, body: string): void {
  gh(['api', '-X', 'PATCH', `repos/${repo()}/issues/comments/${id}`, '-F', 'body=@-'], body);
}

export function setIssueBody(n: number, body: string): void {
  gh(['issue', 'edit', String(n), '--body-file', '-'], body);
}

/** The ledger issue (label agent:ledger). Created on first use. */
export function ledgerIssue(): { number: number; body: string } {
  const found = JSON.parse(gh(['issue', 'list', '--label', 'agent:ledger', '--state', 'open', '--limit', '1', '--json', 'number,body']));
  if (found.length) return { number: found[0].number, body: found[0].body ?? '' };
  ensureLabels(['agent:ledger']);
  const url = gh(['issue', 'create', '--title', 'Agent ledger', '--label', 'agent:ledger', '--body',
    'Monthly usage for the cloud runner lanes. Edited by the router; do not edit by hand.']);
  return { number: parseInt(url.split('/').pop() ?? '', 10), body: '' };
}

/** Open PRs: drafts are In progress, the rest are In review (same rule as the orchestrator). */
export function wipCounts(): { inProgress: number; inReview: number } {
  const prs = JSON.parse(gh(['pr', 'list', '--state', 'open', '--limit', '100', '--json', 'isDraft'])) as Array<{ isDraft: boolean }>;
  const inProgress = prs.filter(p => p.isDraft).length;
  return { inProgress, inReview: prs.length - inProgress };
}

export function variable(name: string): string | null {
  try { return gh(['variable', 'get', name]) || null; } catch { return null; }
}

/** Id of the newest comment on the issue that carries an agent-lease marker, or null. */
export function findLeaseComment(n: number): number | null {
  const out = gh(['api', `repos/${repo()}/issues/${n}/comments`, '--paginate', '--jq',
    '.[] | select(.body | contains("<!-- agent-lease")) | .id']);
  const ids = out.split('\n').filter(Boolean);
  return ids.length ? parseInt(ids[ids.length - 1], 10) : null;
}

/** Oldest open issue that was claimed for the burst lane, or null. Used when the webhook did not carry the issue number. */
export function findBurstIssue(): number | null {
  const found = JSON.parse(gh(['issue', 'list', '--state', 'open', '--label', 'agent:working', '--label', 'lane:burst',
    '--limit', '20', '--json', 'number'])) as Array<{ number: number }>;
  return found.length ? Math.min(...found.map(i => i.number)) : null;
}
