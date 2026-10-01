import { WorkflowState, PhaseGate, Artifact } from '../state';

export const mockProjectConfig = {
  name: 'Test Project',
  stack: 'ts-react-node',
  features: ['authentication', 'api', 'database'],
  mcp_servers: {
    github: { enabled: true },
    database: { enabled: true }
  }
};

export const createMockWorkflowState = (overrides?: Partial<WorkflowState>): WorkflowState => {
  const now = new Date().toISOString();
  return {
    id: 'wf-test-12345',
    issueBrief: 'Build a user authentication system',
    issueNumber: 42,
    startedAt: now,
    updatedAt: now,
    currentPhase: 'product-manager',
    status: 'running',
    phases: [],
    artifacts: [],
    config: mockProjectConfig,
    notes: [],
    ...overrides
  };
};

export const createMockPhaseGate = (phase: string, valid: boolean = true): PhaseGate => ({
  phase: phase as any,
  valid,
  timestamp: new Date().toISOString(),
  output: {
    agent: phase,
    processedInput: { test: true }
  },
  error: valid ? undefined : `Phase ${phase} failed`
});

export const createMockArtifact = (phase: string, type: string): Artifact => ({
  phase: phase as any,
  type,
  timestamp: new Date().toISOString(),
  content: {
    agent: phase,
    timestamp: new Date().toISOString(),
    data: { test: true }
  }
});

export const createValidWorkflowPath = (): WorkflowState => {
  const state = createMockWorkflowState();
  const phases: PhaseGate[] = [
    createMockPhaseGate('product-manager', true),
    createMockPhaseGate('analyzer', true),
    createMockPhaseGate('architect', true)
  ];

  return {
    ...state,
    phases,
    artifacts: [
      createMockArtifact('product-manager', 'requirements'),
      createMockArtifact('analyzer', 'features'),
      createMockArtifact('architect', 'design')
    ]
  };
};

export const createFailureScenarioState = (failAtPhase: string): WorkflowState => {
  const state = createMockWorkflowState();
  const phases: PhaseGate[] = [];
  const artifacts: Artifact[] = [];

  const phaseSequence = [
    'product-manager',
    'analyzer',
    'architect',
    'backend-builder',
    'frontend-builder'
  ];

  for (const phase of phaseSequence) {
    if (phase === failAtPhase) {
      phases.push(createMockPhaseGate(phase, false));
      break;
    }
    phases.push(createMockPhaseGate(phase, true));
    artifacts.push(createMockArtifact(phase, `${phase}-output`));
  }

  return {
    ...state,
    phases,
    artifacts,
    status: 'failed'
  };
};

export const parallelPhasesInput = [
  {
    phase: 'backend-builder',
    agentName: 'backend-builder',
    input: { architectOutput: { api: 'design' } }
  },
  {
    phase: 'frontend-builder',
    agentName: 'frontend-builder',
    input: { architectOutput: { ui: 'design' } }
  },
  {
    phase: 'infrastructure-builder',
    agentName: 'infrastructure-builder',
    input: { architectOutput: { infra: 'design' } }
  }
];

export const mockAgentResponses = {
  success: {
    phase: 'test-phase',
    valid: true,
    output: { data: 'test' },
    artifacts: [
      {
        type: 'test-artifact',
        content: { result: 'success' }
      }
    ]
  },
  failure: {
    phase: 'test-phase',
    valid: false,
    error: 'Test failure',
    output: undefined
  },
  withoutArtifacts: {
    phase: 'test-phase',
    valid: true,
    output: { data: 'test' }
  }
};

export const invalidJsonVariants = [
  '{ broken json',
  'null',
  '{}',
  '{ "valid": "false" }'
];

export const retryConfig = {
  maxRetries: 3,
  backoffMs: 100
};
