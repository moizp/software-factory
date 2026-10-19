import * as fs from 'fs';
import * as path from 'path';
import { workflowsDir } from './paths';
import type { WorkflowState } from './state';

/**
 * A workflow's history as an append-only log, one JSON line per event, in `workflows/<id>.events.jsonl`.
 * The log is written before the state snapshot, and the state is always the replay of the log, so a snapshot that
 * is lost or half written can be rebuilt, a run can be audited line by line, and any machine holding the log can
 * carry on. The orchestrator keeps working with a plain state object: events are derived from the difference between
 * the state about to be saved and the state the log already describes (`diffStates`), so no step needs to know.
 */

type Gate = WorkflowState['phases'][number];
type Artifact = WorkflowState['artifacts'][number];
type Exchange = NonNullable<WorkflowState['humanRequests']>[number];

const SCALARS = ['id', 'issueBrief', 'issueNumber', 'startedAt', 'updatedAt', 'currentPhase', 'status', 'tokensUsed', 'config', 'mission', 'lookfeel', 'character', 'language'] as const;
type Scalar = (typeof SCALARS)[number];
type ListField = 'phases' | 'artifacts' | 'notes' | 'humanRequests';

export type EventBody =
  | { type: 'workflow_started'; state: WorkflowState }
  /** A phase gate: an agent's reply arrived, valid or not. A failed reply carries its error here. */
  | { type: 'phase_recorded'; gate: Gate }
  | { type: 'artifact_added'; artifact: Artifact }
  | { type: 'note_added'; note: string }
  | { type: 'human_requested'; exchange: Exchange }
  | { type: 'human_replied'; id: string; answer: NonNullable<Exchange['answer']> }
  /** Any other change to a question already asked, such as a plan sent back being marked as acted on. */
  | { type: 'exchange_updated'; exchange: Exchange }
  /** A list changed other than by adding to its end, such as finished phases being kept on a resume while failed ones are dropped. */
  | { type: 'list_replaced'; field: ListField; value: unknown[] }
  | { type: 'state_changed'; changes: Partial<Record<Scalar, unknown>> };

export type WorkflowEvent = EventBody & { seq: number; at: string };

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** A state as it would read back from disk: undefined fields gone. */
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v));

function listEvents<T>(prev: T[], next: T[], field: ListField, add: (item: T) => EventBody): EventBody[] {
  const extends_ = next.length >= prev.length && prev.every((p, i) => same(p, next[i]));
  return extends_ ? next.slice(prev.length).map(add) : [{ type: 'list_replaced', field, value: plain(next) }];
}

function exchangeEvents(prev: Exchange[], next: Exchange[]): EventBody[] {
  const prevIds = prev.map(e => e.id);
  const kept = next.filter(e => prevIds.includes(e.id));
  const orderKept = prev.length <= next.length && prev.every((p, i) => next[i]?.id === p.id);
  if (!orderKept || kept.length !== prev.length) return [{ type: 'list_replaced', field: 'humanRequests', value: plain(next) }];

  const out: EventBody[] = [];
  next.forEach((e, i) => {
    const p = prev[i];
    if (!p) out.push({ type: 'human_requested', exchange: plain(e) });
    else if (!same(p, e)) {
      const { answer, ...rest } = e;
      const { answer: _old, ...prevRest } = p;
      out.push(!p.answer && answer && same(rest, prevRest)
        ? { type: 'human_replied', id: e.id, answer: plain(answer) }
        : { type: 'exchange_updated', exchange: plain(e) });
    }
  });
  return out;
}

/** The events that take the state described so far (null for a new workflow) to `next`. Empty when nothing changed. */
export function diffStates(prev: WorkflowState | null, next: WorkflowState): EventBody[] {
  if (!prev) return [{ type: 'workflow_started', state: plain(next) }];
  const out: EventBody[] = [
    ...listEvents(prev.phases, next.phases, 'phases', gate => ({ type: 'phase_recorded', gate: plain(gate) })),
    ...listEvents(prev.artifacts, next.artifacts, 'artifacts', artifact => ({ type: 'artifact_added', artifact: plain(artifact) })),
    ...listEvents(prev.notes, next.notes, 'notes', note => ({ type: 'note_added', note })),
    ...exchangeEvents(prev.humanRequests ?? [], next.humanRequests ?? [])
  ];
  const changes: Partial<Record<Scalar, unknown>> = {};
  for (const key of SCALARS) {
    if (!same(prev[key], next[key])) changes[key] = next[key] === undefined ? null : plain(next[key]);
  }
  if (Object.keys(changes).length) out.push({ type: 'state_changed', changes });
  return out;
}

export function applyEvent(state: WorkflowState | null, ev: EventBody): WorkflowState {
  if (ev.type === 'workflow_started') return plain(ev.state);
  if (!state) throw new Error(`event "${ev.type}" came before workflow_started`);
  const next: WorkflowState = { ...state };
  switch (ev.type) {
    case 'phase_recorded': next.phases = [...state.phases, ev.gate]; break;
    case 'artifact_added': next.artifacts = [...state.artifacts, ev.artifact]; break;
    case 'note_added': next.notes = [...state.notes, ev.note]; break;
    case 'human_requested': next.humanRequests = [...(state.humanRequests ?? []), ev.exchange]; break;
    case 'human_replied':
      next.humanRequests = (state.humanRequests ?? []).map(e => (e.id === ev.id ? { ...e, answer: ev.answer } : e));
      break;
    case 'exchange_updated':
      next.humanRequests = (state.humanRequests ?? []).map(e => (e.id === ev.exchange.id ? ev.exchange : e));
      break;
    case 'list_replaced':
      if (ev.field === 'humanRequests' && ev.value.length === 0) delete next.humanRequests;
      else (next as unknown as Record<string, unknown>)[ev.field] = ev.value;
      break;
    case 'state_changed':
      for (const [k, v] of Object.entries(ev.changes)) {
        if (v === null && k !== 'config') delete (next as unknown as Record<string, unknown>)[k];
        else (next as unknown as Record<string, unknown>)[k] = v;
      }
      break;
  }
  return next;
}

/** Rebuilds the state a log describes. Null for an empty log. */
export function replay(events: WorkflowEvent[]): WorkflowState | null {
  return events.reduce<WorkflowState | null>((state, ev) => applyEvent(state, ev), null);
}

export const eventsPath = (workflowId: string): string => path.join(workflowsDir(), `${workflowId}.events.jsonl`);

export interface ReadResult {
  events: WorkflowEvent[];
  /** Lines that could not be read (a write cut short). They are skipped. */
  unreadable: number;
}

export function readEvents(workflowId: string): ReadResult {
  const file = eventsPath(workflowId);
  if (!fs.existsSync(file)) return { events: [], unreadable: 0 };
  const events: WorkflowEvent[] = [];
  let unreadable = 0;
  for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line);
      if (ev && typeof ev.type === 'string' && typeof ev.seq === 'number') events.push(ev as WorkflowEvent);
      else unreadable++;
    } catch {
      unreadable++;
    }
  }
  return { events, unreadable };
}

/** Appends events to the log, numbering them after the last one. A cut-off last line is closed first. */
export function appendEvents(workflowId: string, bodies: EventBody[], now: Date = new Date()): WorkflowEvent[] {
  if (bodies.length === 0) return [];
  const file = eventsPath(workflowId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const { events } = readEvents(workflowId);
  let seq = events.length ? events[events.length - 1].seq : 0;
  const written = bodies.map(b => ({ seq: ++seq, at: now.toISOString(), ...b }) as WorkflowEvent);
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
  const lead = existing && !existing.endsWith('\n') ? '\n' : '';
  fs.appendFileSync(file, lead + written.map(e => JSON.stringify(e)).join('\n') + '\n');
  return written;
}

/**
 * Records the change from what the log already describes to `next`. A workflow that has a snapshot but no log yet (it
 * started before the log existed, or only the snapshot was restored) gets a starting event from that snapshot first.
 */
export function recordState(next: WorkflowState, snapshot: WorkflowState | null, now: Date = new Date()): WorkflowEvent[] {
  const { events } = readEvents(next.id);
  const known = replay(events);
  const bodies: EventBody[] = [];
  let base = known;
  if (!base && snapshot) {
    bodies.push({ type: 'workflow_started', state: plain(snapshot) });
    base = snapshot;
  }
  bodies.push(...diffStates(base, next));
  return appendEvents(next.id, bodies, now);
}

const normalised = (s: WorkflowState): WorkflowState => ({ ...plain(s), humanRequests: s.humanRequests ?? [] });

/** The fields in which two states differ. A missing list of questions and an empty one count as equal. */
export function stateDifferences(a: WorkflowState, b: WorkflowState): string[] {
  const x = normalised(a) as unknown as Record<string, unknown>;
  const y = normalised(b) as unknown as Record<string, unknown>;
  return [...new Set([...Object.keys(x), ...Object.keys(y)])].filter(k => !same(x[k], y[k])).sort();
}

/** One line for a person reading a timeline. */
export function describeEvent(ev: WorkflowEvent): string {
  switch (ev.type) {
    case 'workflow_started': return `workflow started (${ev.state.status})`;
    case 'phase_recorded': return `${ev.gate.phase} ${ev.gate.valid ? 'valid' : `invalid${ev.gate.error ? `: ${ev.gate.error.replace(/\s+/g, ' ').slice(0, 80)}` : ''}`}`;
    case 'artifact_added': return `artifact ${ev.artifact.phase}: ${ev.artifact.type}`;
    case 'note_added': return `note: ${ev.note.replace(/^\[[^\]]*\]\s*/, '').slice(0, 100)}`;
    case 'human_requested': return `question to a person (${ev.exchange.phase}): ${ev.exchange.request.question.slice(0, 80)}`;
    case 'human_replied': return `answer to ${ev.id}${ev.answer.by ? ` from ${ev.answer.by}` : ''}`;
    case 'exchange_updated': return `question ${ev.exchange.id} updated`;
    case 'list_replaced': return `${ev.field} replaced (${ev.value.length} entries)`;
    case 'state_changed': return `state: ${Object.entries(ev.changes).filter(([k]) => k !== 'updatedAt').map(([k, v]) => `${k} ${k === 'config' ? 'changed' : `= ${JSON.stringify(v)}`}`).join(', ') || 'updated'}`;
  }
}
