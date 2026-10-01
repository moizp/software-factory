import * as fs from 'fs';
import * as path from 'path';

export type Phase =
  | 'product-manager'
  | 'analyzer'
  | 'architect'
  | 'backend-builder'
  | 'frontend-builder'
  | 'infrastructure-builder'
  | 'backend-tester'
  | 'frontend-tester'
  | 'infrastructure-tester'
  | 'e2e-tester'
  | 'reviewer'
  | 'customer-support'
  | 'completed'
  | 'failed';

export interface PhaseGate {
  phase: Phase;
  valid: boolean;
  timestamp: string;
  output?: Record<string, unknown>;
  error?: string;
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
}

const WORKFLOWS_DIR = path.join(__dirname, '..', 'workflows');

function ensureWorkflowsDir(): void {
  if (!fs.existsSync(WORKFLOWS_DIR)) {
    fs.mkdirSync(WORKFLOWS_DIR, { recursive: true });
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

export function saveWorkflowState(state: WorkflowState): void {
  ensureWorkflowsDir();
  const filePath = path.join(WORKFLOWS_DIR, `${state.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
}

export function loadWorkflowState(workflowId: string): WorkflowState | null {
  ensureWorkflowsDir();
  const filePath = path.join(WORKFLOWS_DIR, `${workflowId}.json`);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content) as WorkflowState;
}

export function listWorkflowStates(): WorkflowState[] {
  ensureWorkflowsDir();

  if (!fs.existsSync(WORKFLOWS_DIR)) {
    return [];
  }

  return fs.readdirSync(WORKFLOWS_DIR)
    .filter(file => file.endsWith('.json'))
    .map(file => {
      const content = fs.readFileSync(path.join(WORKFLOWS_DIR, file), 'utf-8');
      return JSON.parse(content) as WorkflowState;
    })
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
}

export function updatePhase(
  state: WorkflowState,
  phase: Phase,
  valid: boolean,
  output?: Record<string, unknown>,
  error?: string
): WorkflowState {
  const now = new Date().toISOString();

  const updatedState = {
    ...state,
    currentPhase: phase,
    updatedAt: now,
    phases: [
      ...state.phases,
      {
        phase,
        valid,
        timestamp: now,
        output,
        error
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
