import { Finding } from './types';

/** Collapses whitespace so indentation and wrapping differences do not break a match. */
export function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Splits a unified diff into per-file text made of the added and context lines
 * (the lines a reviewer can legitimately quote), keyed by the new path.
 */
export function diffByFile(diff: string): Map<string, string> {
  const files = new Map<string, string[]>();
  let current: string | null = null;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const m = / b\/(.+)$/.exec(line);
      current = m ? m[1] : null;
      if (current && !files.has(current)) files.set(current, []);
      continue;
    }
    if (!current) continue;
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) continue;
    if (line.startsWith('+') || line.startsWith(' ') || line.startsWith('-')) {
      files.get(current)!.push(line.slice(1));
    }
  }
  const out = new Map<string, string>();
  for (const [file, lines] of files) out.set(file, normalize(lines.join('\n')));
  return out;
}

export interface Grounded {
  kept: Finding[];
  dropped: Finding[];
}

/**
 * The anti-hallucination filter: a finding survives only if its evidence_quote appears in the
 * diff of the file it names. The model never gets to assert a defect it cannot quote.
 */
export function groundFindings(diff: string, findings: Finding[]): Grounded {
  const byFile = diffByFile(diff);
  const kept: Finding[] = [];
  const dropped: Finding[] = [];
  for (const f of findings) {
    const quote = normalize(f.evidence_quote ?? '');
    const text = byFile.get(f.file);
    if (quote.length >= 3 && text !== undefined && text.includes(quote)) kept.push(f);
    else dropped.push(f);
  }
  return { kept, dropped };
}
