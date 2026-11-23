import { section } from '../gate/evidence';
import { globToRegExp } from '../policy-engine';
import { Tier } from '../review/types';

/** Files that change what a person sees. Anything the factory itself owns is left out. */
const UI = ['**/*.{tsx,jsx,vue,svelte,css,scss,sass,less,html,astro}', '**/components/**', '**/pages/**', '**/views/**', '**/styles/**', '**/public/**/*.{svg,png,jpg,jpeg,webp,gif}'];
const NOT_UI = ['docs/**', 'templates/**', '.claude/**', '.github/**', '.factory/**', '**/__tests__/**', '**/*.test.*', '**/*.spec.*', '**/*.stories.*', '**/*.md'];

// {a,b} is not understood by globToRegExp, so expand it here
function expand(glob: string): string[] {
  const m = /^(.*)\{([^}]+)\}(.*)$/.exec(glob);
  return m ? m[2].split(',').flatMap(alt => expand(`${m[1]}${alt}${m[3]}`)) : [glob];
}
const regexes = (globs: string[]): RegExp[] => globs.flatMap(expand).map(globToRegExp);
const UI_RE = regexes(UI);
const NOT_UI_RE = regexes(NOT_UI);

export const uiFiles = (files: string[]): string[] => files.filter(f => UI_RE.some(r => r.test(f)) && !NOT_UI_RE.some(r => r.test(f)));

export interface VisualIssue {
  /** R2 and R3 changes fail the check; a smaller one only warns. */
  severity: 'error' | 'warning';
  rule: string;
  message: string;
}

const IMAGE = /!\[[^\]]*\]\([^)]+\)|<img\s[^>]*src=/i;
const NOT_APPLICABLE = /^\s*not applicable\s*:\s*(.{10,})$/im;

/**
 * A change that touches the interface shows before and after pictures under an "Evidence" heading, or says in one line
 * why it cannot ("Not applicable: ..."). The pictures come from `npm run evidence:capture`, not from the author's hand.
 */
export function checkVisualEvidence(body: string, files: string[], tier: Tier): VisualIssue[] {
  const ui = uiFiles(files);
  if (ui.length === 0) return [];
  const text = section(body, /^evidence\b/i) ?? section(body, /^(?:screenshots?|before and after)\b/i);
  if (text && (IMAGE.test(text) || NOT_APPLICABLE.test(text))) return [];
  const sample = ui.slice(0, 3).join(', ') + (ui.length > 3 ? ', ...' : '');
  return [{
    severity: tier === 'R2' || tier === 'R3' ? 'error' : 'warning',
    rule: 'visual-evidence-missing',
    message: `the change touches the interface (${sample}) but the body has no Evidence section with before and after pictures. Run \`npm run evidence:capture\` for "before" and "after", then \`npm run evidence:publish\`; or write "Not applicable: <reason>" under an Evidence heading`
  }];
}
