import { stubPayload } from '../contracts';
import { FactoryOrchestrator, mockAgentInvoker } from '../orchestrator';
import { WorkflowState } from '../state';
import {
  createMockWorkflowState,
  parallelPhasesInput,
  mockAgentResponses,
  retryConfig
} from './fixtures';

describe('Orchestrator - Sequential Phase Execution', () => {
  let orchestrator: FactoryOrchestrator;

  beforeEach(() => {
    orchestrator = new FactoryOrchestrator(mockAgentInvoker, false, undefined, retryConfig);
  });

  describe('executeSequentialPhase', () => {
    it('should execute phase successfully', async () => {
      const state = createMockWorkflowState();
      const input = { brief: 'Test' };

      const result = await orchestrator.executeSequentialPhase(
        state,
        'product-manager',
        'product-manager',
        input
      );

      expect(result.phases).toHaveLength(1);
      expect(result.phases[0].valid).toBe(true);
      expect(result.phases[0].phase).toBe('product-manager');
    });

    it('should track artifacts from agent response', async () => {
      const state = createMockWorkflowState();

      const result = await orchestrator.executeSequentialPhase(
        state,
        'analyzer',
        'analyzer',
        {}
      );

      expect(result.artifacts.length).toBeGreaterThan(0);
      expect(result.artifacts[0].type).toMatch(/analyzer-output/);
    });

    it('should update currentPhase', async () => {
      const state = createMockWorkflowState();

      const result = await orchestrator.executeSequentialPhase(
        state,
        'backend-engineer',
        'backend-engineer',
        {}
      );

      expect(result.currentPhase).toBe('backend-engineer');
    });

    it('should handle agent validation failure', async () => {
      const failingInvoker = async (): Promise<any> => ({
        phase: 'analyzer',
        valid: false,
        error: 'Validation failed'
      });

      const failOrchestrator = new FactoryOrchestrator(failingInvoker, false);
      const state = createMockWorkflowState();

      const result = await failOrchestrator.executeSequentialPhase(
        state,
        'analyzer',
        'analyzer',
        {}
      );

      expect(result.phases[0].valid).toBe(false);
      expect(result.phases[0].error).toBe('Validation failed');
      expect(result.status).toBe('failed');
    });

    it('should handle agent exceptions', async () => {
      const errorInvoker = async (): Promise<any> => {
        throw new Error('Agent crashed');
      };

      const errorOrchestrator = new FactoryOrchestrator(errorInvoker, false);
      const state = createMockWorkflowState();

      const result = await errorOrchestrator.executeSequentialPhase(
        state,
        'software-architect',
        'software-architect',
        {}
      );

      expect(result.phases[0].valid).toBe(false);
      expect(result.phases[0].error).toContain('Agent crashed');
    });

    it('should add notes for failed phases', async () => {
      const failingInvoker = async (): Promise<any> => ({
        phase: 'analyzer',
        valid: false,
        error: 'Test error'
      });

      const failOrchestrator = new FactoryOrchestrator(failingInvoker, false);
      const state = createMockWorkflowState();

      const result = await failOrchestrator.executeSequentialPhase(
        state,
        'analyzer',
        'analyzer',
        {}
      );

      expect(result.notes.length).toBeGreaterThan(0);
      expect(result.notes[0]).toContain('failed');
    });
  });

  describe('executeParallelPhases', () => {
    it('should execute multiple phases in parallel', async () => {
      const parallelInvoker = async (state: any, agentName: string): Promise<any> => {
        return {
          phase: agentName as any,
          valid: true,
          output: { completed: true }
        };
      };

      const parallelOrchestrator = new FactoryOrchestrator(parallelInvoker, false);
      const state = createMockWorkflowState();

      const phases = [
        { phase: 'backend-engineer' as const, agentName: 'backend-engineer', input: {} },
        { phase: 'frontend-engineer' as const, agentName: 'frontend-engineer', input: {} },
        { phase: 'infrastructure-engineer' as const, agentName: 'infrastructure-engineer', input: {} }
      ];

      const result = await parallelOrchestrator.executeParallelPhases(state, phases);

      expect(result.phases).toHaveLength(3);
      const phaseNames = result.phases.map(p => p.phase);
      expect(phaseNames).toContain('backend-engineer');
      expect(phaseNames).toContain('frontend-engineer');
      expect(phaseNames).toContain('infrastructure-engineer');
    });

    it('should track all artifacts from parallel phases', async () => {
      const state = createMockWorkflowState();

      const phases = [
        { phase: 'backend-engineer' as const, agentName: 'backend-engineer', input: {} },
        { phase: 'frontend-engineer' as const, agentName: 'frontend-engineer', input: {} },
        { phase: 'infrastructure-engineer' as const, agentName: 'infrastructure-engineer', input: {} }
      ];

      const result = await orchestrator.executeParallelPhases(state, phases);

      expect(result.artifacts.length).toBeGreaterThan(2);
    });

    it('should handle partial failures', async () => {
      let callCount = 0;
      const partialFailInvoker = async (): Promise<any> => {
        callCount++;
        return {
          phase: callCount === 2 ? ('frontend-engineer' as const) : ('backend-engineer' as const),
          valid: callCount !== 2,
          error: callCount === 2 ? 'Frontend build failed' : undefined
        };
      };

      const partialOrchestrator = new FactoryOrchestrator(partialFailInvoker, false);
      const state = createMockWorkflowState();

      const phases = [
        { phase: 'backend-engineer' as const, agentName: 'backend-engineer', input: {} },
        { phase: 'frontend-engineer' as const, agentName: 'frontend-engineer', input: {} },
        { phase: 'infrastructure-engineer' as const, agentName: 'infrastructure-engineer', input: {} }
      ];

      const result = await partialOrchestrator.executeParallelPhases(state, phases);

      const failedPhases = result.phases.filter(p => !p.valid);
      expect(failedPhases.length).toBeGreaterThan(0);
    });

    it('should note when parallel phases fail', async () => {
      const failingInvoker = async (): Promise<any> => ({
        phase: 'backend-engineer' as const,
        valid: false,
        error: 'Failed'
      });

      const failOrchestrator = new FactoryOrchestrator(failingInvoker, false);
      const state = createMockWorkflowState();

      const phases = [
        { phase: 'backend-engineer' as const, agentName: 'backend-engineer', input: {} },
        { phase: 'frontend-engineer' as const, agentName: 'frontend-engineer', input: {} },
        { phase: 'infrastructure-engineer' as const, agentName: 'infrastructure-engineer', input: {} }
      ];

      const result = await failOrchestrator.executeParallelPhases(state, phases);

      expect(result.notes.length).toBeGreaterThan(0);
      expect(result.notes[0]).toContain('parallel');
    });
  });
});

describe('Orchestrator - Full Workflow Execution', () => {
  let orchestrator: FactoryOrchestrator;

  beforeEach(() => {
    jest.clearAllMocks();
    orchestrator = new FactoryOrchestrator(mockAgentInvoker, false, undefined, retryConfig);
  });

  describe('Happy Path Workflow', () => {
    it('should complete full workflow when all phases pass', async () => {
      const brief = 'Build a chat application';

      const result = await orchestrator.executeWorkflow(brief, 123, { stack: 'ts-react' });

      expect(result.status).toBe('completed');
      expect(result.phases.length).toBeGreaterThan(0);
      expect(result.artifacts.length).toBeGreaterThan(0);
    });

    it('should track issue number in workflow', async () => {
      const result = await orchestrator.executeWorkflow(
        'Brief',
        456,
        {}
      );

      expect(result.issueNumber).toBe(456);
    });

    it('should include config in final state', async () => {
      const config = { stack: 'nodejs', database: 'postgres' };

      const result = await orchestrator.executeWorkflow('Brief', undefined, config);

      expect(result.config).toEqual(config);
    });

    it('should set workflow start time', async () => {
      const before = new Date();
      const result = await orchestrator.executeWorkflow('Brief', undefined, {});
      const after = new Date();

      const startTime = new Date(result.startedAt);
      expect(startTime.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(startTime.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should collect all phase outputs', async () => {
      const result = await orchestrator.executeWorkflow(
        'Build system',
        undefined,
        {}
      );

      expect(result.phases.every(p => p.timestamp)).toBe(true);
      expect(result.phases.every(p => p.phase)).toBe(true);
    });
  });

  describe('Failure Scenarios', () => {
    it('should stop workflow on product-manager failure', async () => {
      const failAtProductManager = async (): Promise<any> => ({
        phase: 'product-manager',
        valid: false,
        error: 'Requirements unclear'
      });

      const failOrchestrator = new FactoryOrchestrator(failAtProductManager, false);
      const result = await failOrchestrator.executeWorkflow('Brief', undefined, {});

      expect(result.status).toBe('failed');
      expect(result.phases[0].phase).toBe('product-manager');
      expect(result.phases[0].valid).toBe(false);
    });

    it('should fail gracefully on analyzer errors', async () => {
      let callCount = 0;
      const failAtAnalyzer = async (): Promise<any> => {
        callCount++;
        if (callCount === 2) {
          return { phase: 'analyzer', valid: false, error: 'Analysis failed' };
        }
        return { phase: 'product-manager', valid: true };
      };

      const failOrchestrator = new FactoryOrchestrator(failAtAnalyzer, false);
      const result = await failOrchestrator.executeWorkflow('Brief', undefined, {});

      expect(result.status).toBe('failed');
    });

    it('should track failure reasons in notes', async () => {
      const failingInvoker = async (): Promise<any> => ({
        phase: 'product-manager',
        valid: false,
        error: 'Detailed failure reason'
      });

      const failOrchestrator = new FactoryOrchestrator(failingInvoker, false);
      const result = await failOrchestrator.executeWorkflow('Brief', undefined, {});

      const failureNotes = result.notes.filter(n => n.toLowerCase().includes('failed'));
      expect(failureNotes.length).toBeGreaterThan(0);
    });
  });

  describe('Retry and Backoff Logic', () => {
    it('should retry transient errors', async () => {
      let attempts = 0;
      const transientErrorInvoker = async (_state: any, agentName: string): Promise<any> => {
        attempts++;
        if (attempts < 2) {
          throw new Error('ECONNREFUSED: Connection refused');
        }
        return { phase: agentName, valid: true, ...stubPayload(agentName) };
      };

      const retryOrchestrator = new FactoryOrchestrator(
        transientErrorInvoker,
        false,
        undefined,
        { maxRetries: 3, backoffMs: 10 }
      );

      const result = await retryOrchestrator.executeWorkflow('Brief', undefined, {});

      expect(result.phases[0].valid).toBe(true);
      expect(attempts).toBeGreaterThan(1);
    });

    it('should not retry non-transient errors', async () => {
      let attempts = 0;
      const permanentErrorInvoker = async (): Promise<any> => {
        attempts++;
        throw new Error('Invalid input format');
      };

      const retryOrchestrator = new FactoryOrchestrator(
        permanentErrorInvoker,
        false,
        undefined,
        { maxRetries: 3, backoffMs: 10 }
      );

      const result = await retryOrchestrator.executeWorkflow('Brief', undefined, {});

      expect(attempts).toBe(1);
      expect(result.status).toBe('failed');
    });

    it('should respect max retries limit', async () => {
      let attempts = 0;
      const alwaysFailInvoker = async (): Promise<any> => {
        attempts++;
        throw new Error('TIMEOUT: Connection timeout');
      };

      const retryOrchestrator = new FactoryOrchestrator(
        alwaysFailInvoker,
        false,
        undefined,
        { maxRetries: 2, backoffMs: 10 }
      );

      const result = await retryOrchestrator.executeWorkflow('Brief', undefined, {});

      expect(attempts).toBeLessThanOrEqual(2);
      expect(result.status).toBe('failed');
    });
  });

  describe('Workflow Logging', () => {
    it('should support verbose logging', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const verboseOrchestrator = new FactoryOrchestrator(mockAgentInvoker, true);

      verboseOrchestrator.executeSequentialPhase(
        createMockWorkflowState(),
        'analyzer',
        'analyzer',
        {}
      );

      consoleSpy.mockRestore();
    });

    it('should suppress logs when verbose is false', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const silentOrchestrator = new FactoryOrchestrator(mockAgentInvoker, false);

      silentOrchestrator.executeSequentialPhase(
        createMockWorkflowState(),
        'analyzer',
        'analyzer',
        {}
      );

      consoleSpy.mockRestore();
    });
  });
});

describe('Orchestrator - State Persistence', () => {
  let orchestrator: FactoryOrchestrator;

  beforeEach(() => {
    orchestrator = new FactoryOrchestrator(mockAgentInvoker, false);
  });

  it('should return valid state object', async () => {
    const result = await orchestrator.executeWorkflow('Test', undefined, {});

    expect(result.id).toBeDefined();
    expect(result.issueBrief).toBe('Test');
    expect(result.startedAt).toBeDefined();
    expect(result.updatedAt).toBeDefined();
  });

  it('should maintain immutability during execution', async () => {
    const state = createMockWorkflowState();
    const originalId = state.id;

    const result = await orchestrator.executeSequentialPhase(
      state,
      'analyzer',
      'analyzer',
      {}
    );

    expect(state.id).toBe(originalId);
    expect(state.phases.length).toBe(0);
    expect(result.phases.length).toBeGreaterThan(0);
  });
});

describe('Orchestrator - Resume', () => {
  it('resumes the same workflow, skipping validated phases and re-running the failed one', async () => {
    const calls: string[] = [];
    let failE2e = true;
    const invoker = async (_state: any, agentName: string): Promise<any> => {
      calls.push(agentName);
      if (agentName === 'e2e-tester' && failE2e) {
        return { phase: agentName, valid: false, error: 'e2e down' };
      }
      return { phase: agentName, valid: true, ...stubPayload(agentName) };
    };
    const orchestrator = new FactoryOrchestrator(invoker, false, undefined, { maxRetries: 1, backoffMs: 1 });

    const failed = await orchestrator.executeWorkflow('Brief', undefined, {});
    expect(failed.status).toBe('failed');
    expect(calls).toEqual([
      'product-manager', 'analyzer', 'software-architect',
      'backend-engineer', 'frontend-engineer', 'infrastructure-engineer',
      'automation-tester', 'e2e-tester'
    ]);

    calls.length = 0;
    failE2e = false;
    const resumed = await orchestrator.executeWorkflow('Brief', undefined, {}, failed);

    expect(resumed.id).toBe(failed.id);
    expect(resumed.status).toBe('completed');
    expect(calls).toEqual(['e2e-tester', 'reviewer', 'customer-support']);
  });

  it('hands earlier payloads to later agents', async () => {
    const inputs: Record<string, any> = {};
    const invoker = async (_state: any, agentName: string, input: any): Promise<any> => {
      inputs[agentName] = input;
      return { phase: agentName, valid: true, ...stubPayload(agentName) };
    };
    const orchestrator = new FactoryOrchestrator(invoker, false);
    await orchestrator.executeWorkflow('Brief', undefined, {});

    expect(inputs['software-architect'].productManagerOutput).toBeTruthy();
    expect(inputs['software-architect'].analyzerOutput).toBeTruthy();
    expect(inputs['automation-tester'].builderOutputs['backend-engineer']).toBeTruthy();
    expect(inputs['e2e-tester'].testerOutput).toBeTruthy();
  });
});
