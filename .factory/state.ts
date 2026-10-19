import * as fs from 'fs';
import * as path from 'path';
import { AgentName } from './pipeline';
import { workflowsDir } from './paths';
import type { HumanExchange } from './human';
import { readEvents, recordState, replay } from './events';
import type { Mission } from './mission';

export type Phase = AgentName | 'completed' | 'failed';

/** Measured by the Claude CLI per agent call. costUsd is the API-equivalent figure, not necessarily billed. */
export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  costUsd: number;
  turns: number;
}

export interface PhaseGate {
  phase: Phase;
  valid: boolean;
  timestamp: string;
  output?: Record<string, unknown>;
  error?: string;
  usage?: Usage;
}

export interface Artifact {
  phase: Phase;
  type: string;
  path?: string;
  content?: Record<string, unknown>;
  timestamp: string;
}

export interface WorkflowState {
  id: string;
  issueBrief: string;
  issueNumber?: number;
  startedAt: string;
  updatedAt: string;
  currentPhase: Phase;
  status: 'running' | 'paused' | 'completed' | 'failed';
  phases: PhaseGate[];
  artifacts: Artifact[];
  config: Record<string, unknown>;
  notes: string[];
  /** Total tokens used across all phases and resumes, for the budget guard */
  tokensUsed?: number;
  /** Questions agents have put to a person, with the answers received. At most one is unanswered. */
  humanRequests?: HumanExchange[];
  /** The project's mission when the workflow started (MISSION.md). Kept so a resume plans against the same one. */
  mission?: Mission;
}


function ensureWorkflowsDir(): void {
  if (!fs.existsSync(workflowsDir())) {
    fs.mkdirSync(workflowsDir(), { recursive: true });
  }
}

export function createWorkflowState(
  issueBrief: string,
  issueNumber?: number,
  config?: Record<string, unknown>
): WorkflowState {
  const id = `wf-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const now = new Date().toISOString();

  return {
    id,
    issueBrief,
    issueNumber,
    startedAt: now,
    updatedAt: now,
    currentPhase: 'product-manager',
    status: 'running',
    phases: [],
    artifacts: [],
    config: config || {},
    notes: []
  };
}

export function readSnapshot(workflowId: string): WorkflowState | null {
  const filePath = path.join(workflowsDir(), `${workflowId}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as WorkflowState;
  } catch {
    return null;
  }
}

/**
 * Saves the state. The change is appended to the event log first and the snapshot is written after, so the log is never
 * behind the snapshot. A failure to write the log is reported but never stops the run.
 */
export function saveWorkflowState(state: WorkflowState): void {
  ensureWorkflowsDir();
  try {
    recordState(state, readSnapshot(state.id));
  } catch (error) {
    console.warn(`[State] Could not append to the event log for ${state.id}: ${error instanceof Error ? error.message : error}`);
  }
  writeSnapshot(state);
}

/** Writes the snapshot only. Used when the snapshot is rebuilt from the log, which already describes it. */
export function writeSnapshot(state: WorkflowState): void {
  ensureWorkflowsDir();
  fs.writeFileSync(path.join(workflowsDir(), `${state.id}.json`), JSON.stringify(state, null, 2));
}

/** The saved state; when the snapshot is missing or unreadable, the state the event log describes. */
export function loadWorkflowState(workflowId: string): WorkflowState | null {
  ensureWorkflowsDir();
  return readSnapshot(workflowId) ?? replay(readEvents(workflowId).events);
}

export function listWorkflowStates(): WorkflowState[] {
  ensureWorkflowsDir();

  if (!fs.existsSync(workflowsDir())) {
    return [];
  }

  return fs.readdirSync(workflowsDir())
    .filter(file => file.endsWith('.json'))
    .map(file => {
      const content = fs.readFileSync(path.join(workflowsDir(), file), 'utf-8');
      return JSON.parse(content) as WorkflowState;
    })
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
}

export function updatePhase(
  state: WorkflowState,
  phase: Phase,
  valid: boolean,
  output?: Record<string, unknown>,
  error?: string,
  usage?: Usage
): WorkflowState {
  const now = new Date().toISOString();

  const updatedState = {
    ...state,
    tokensUsed: (state.tokensUsed ?? 0) + (usage?.totalTokens ?? 0),
    currentPhase: phase,
    updatedAt: now,
    phases: [
      ...state.phases,
      {
        phase,
        valid,
        timestamp: now,
        output,
        error,
        usage
      }
    ],
    status: !valid ? 'failed' : state.status
  };

  return updatedState;
}

export function addArtifact(
  state: WorkflowState,
  type: string,
  content: Record<string, unknown>,
  filePath?: string
): WorkflowState {
  return {
    ...state,
    artifacts: [
      ...state.artifacts,
      {
        phase: state.currentPhase,
        type,
        content,
        path: filePath,
        timestamp: new Date().toISOString()
      }
    ]
  };
}

export function addNote(state: WorkflowState, note: string): WorkflowState {
  return {
    ...state,
    notes: [...state.notes, `[${new Date().toISOString()}] ${note}`]
  };
}
