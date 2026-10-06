import * as fs from 'fs';
import * as path from 'path';

/**
 * Project board template (.factory/board.json): statuses, WIP limits, fields, views, labels.
 * The same file is followed by this repo and by apps built with the factory.
 */

export interface BoardStatus {
  name: string;
  rule?: string;
  wip?: number;
}

export interface Board {
  version: 1;
  template: string;
  statuses: BoardStatus[];
  wip_enforcement: { block_new_work: boolean; override_env?: string };
  fields: Array<{ name: string; type: 'single_select' | 'number' | 'text'; options?: string[] }>;
  views: Array<{ name: string; layout: 'board' | 'table' | 'roadmap'; filter?: string; group_by?: string }>;
  labels: Array<{ name: string; color: string; description?: string }>;
  milestones: string[];
}

export interface WipCounts {
  inProgress: number;
  inReview: number;
}

export interface WipDecision {
  canStart: boolean;
  reasons: string[];
}

const IN_PROGRESS = 'In progress';
const IN_REVIEW = 'In review';

export function parseBoard(raw: unknown): Board {
  const fail = (msg: string): never => {
    throw new Error(`Invalid board: ${msg}`);
  };
  if (!raw || typeof raw !== 'object') fail('not an object');
  const b = raw as Record<string, any>;
  if (b.version !== 1) fail('version must be 1');
  if (typeof b.template !== 'string') fail('template is required');
  if (!Array.isArray(b.statuses) || b.statuses.length === 0) fail('statuses must be a non-empty array');

  const names = new Set<string>();
  for (const s of b.statuses) {
    if (!s || typeof s.name !== 'string' || s.name.length === 0) fail('every status needs a name');
    if (names.has(s.name)) fail(`duplicate status "${s.name}"`);
    names.add(s.name);
    if (s.wip !== undefined && !(Number.isInteger(s.wip) && s.wip >= 1)) {
      fail(`status "${s.name}": wip must be an integer >= 1`);
    }
  }
  for (const required of [IN_PROGRESS, IN_REVIEW]) {
    const s = b.statuses.find((x: BoardStatus) => x.name === required);
    if (!s || s.wip === undefined) fail(`status "${required}" must exist and set wip`);
  }
  if (!b.wip_enforcement || typeof b.wip_enforcement.block_new_work !== 'boolean') {
    fail('wip_enforcement.block_new_work must be boolean');
  }
  for (const key of ['fields', 'views', 'labels', 'milestones']) {
    if (!Array.isArray(b[key])) fail(`${key} must be an array`);
  }
  const labelNames = new Set<string>();
  for (const l of b.labels) {
    if (typeof l.name !== 'string' || !/^[0-9A-Fa-f]{6}$/.test(l.color ?? '')) {
      fail(`label "${l?.name}": needs a name and a 6-digit hex color`);
    }
    if (labelNames.has(l.name)) fail(`duplicate label "${l.name}"`);
    labelNames.add(l.name);
  }
  return b as Board;
}

export function loadBoard(file: string): Board {
  return parseBoard(JSON.parse(fs.readFileSync(file, 'utf-8')));
}

/** The repo's board config (cwd first, then next to this module); null when the repo has none. */
export function loadBoardIfPresent(): Board | null {
  const candidates = [path.join(process.cwd(), '.factory', 'board.json'), path.join(__dirname, 'board.json')];
  const file = candidates.find(f => fs.existsSync(f));
  return file ? loadBoard(file) : null;
}

export function wipLimit(board: Board, status: string): number {
  return board.statuses.find(s => s.name === status)?.wip ?? Infinity;
}

/**
 * New work may start only when "In progress" is below its limit AND "In review" is below its limit
 * (a full review column means humans are the bottleneck: finish, don't start).
 */
export function evaluateWip(board: Board, counts: WipCounts): WipDecision {
  const reasons: string[] = [];
  const progressLimit = wipLimit(board, IN_PROGRESS);
  const reviewLimit = wipLimit(board, IN_REVIEW);

  if (counts.inProgress >= progressLimit) {
    reasons.push(`${IN_PROGRESS} is at its limit (${counts.inProgress}/${progressLimit}): finish or merge the open draft PR first`);
  }
  if (counts.inReview >= reviewLimit) {
    reasons.push(`${IN_REVIEW} is at its limit (${counts.inReview}/${reviewLimit}): review and merge waiting PRs first`);
  }
  return { canStart: reasons.length === 0, reasons };
}
