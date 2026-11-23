import { Manifest } from './capture';

export type Change = 'changed' | 'unchanged' | 'new' | 'removed';

export interface Row {
  check: string;
  width: number;
  before?: string;
  after?: string;
  change: Change;
}

/** Pairs the two sets by screen and width. A screen that did not change is said so rather than hidden. */
export function pair(before: Manifest, after: Manifest): Row[] {
  const key = (s: { check: string; width: number }) => `${s.check}@${s.width}`;
  const b = new Map(before.shots.map(s => [key(s), s]));
  const a = new Map(after.shots.map(s => [key(s), s]));
  const keys = [...new Set([...after.shots.map(key), ...before.shots.map(key)])];
  return keys.map(k => {
    const x = b.get(k), y = a.get(k);
    const s = (y ?? x)!;
    return {
      check: s.check,
      width: s.width,
      before: x?.file,
      after: y?.file,
      change: !x ? 'new' : !y ? 'removed' : x.sha256 === y.sha256 ? 'unchanged' : 'changed'
    } as Row;
  });
}

const short = (c: string): string => c.slice(0, 7);

/**
 * The "Evidence" section for a pull request or an issue comment. `urlFor(label, file)` says where a picture is
 * published; images are shown at a fixed width so a table of them stays readable.
 */
export function renderEvidence(before: Manifest, after: Manifest, urlFor: (label: 'before' | 'after', file: string) => string): string {
  const rows = pair(before, after);
  const img = (label: 'before' | 'after', file: string | undefined, alt: string): string => (file ? `<img src="${urlFor(label, file)}" alt="${alt}" width="300">` : 'none');
  const changed = rows.filter(r => r.change !== 'unchanged').length;
  return [
    '## Evidence',
    `Before: \`${short(before.commit)}\`. After: \`${short(after.commit)}\`. ${rows.length} picture(s), ${changed} with a visible difference. Taken by \`npm run evidence:capture\` with a fixed viewport, no animation and UTC time, so a difference is a difference in the app.`,
    '',
    '| Screen | Width | Before | After | Change |',
    '|---|---|---|---|---|',
    ...rows.map(r => `| ${r.check} | ${r.width} | ${img('before', r.before, `${r.check} before`)} | ${img('after', r.after, `${r.check} after`)} | ${r.change} |`)
  ].join('\n');
}
