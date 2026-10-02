import { stubPayload } from '../contracts';
import { FactoryOrchestrator } from '../orchestrator';
import { createWorkflowState, updatePhase, addArtifact } from '../state';
import {
  createValidWorkflowPath,
  createFailureScenarioState,
  mockProjectConfig
} from './fixtures';

describe('Integration Tests - Agent Sequencing', () => {
  describe('Happy Path - Complete Workflow', () => {
    it('should execute product-manager → analyzer → architect sequence', async () => {
      const phaseSequence: string[] = [];
      const sequenceInvoker = async (state: any, agentName: string): Promise<any> => {
        phaseSequence.push(agentName);
        return {
          phase: agentName,
          valid: true,
          output: { completed: true },
          ...stubPayload(agentName)
        };
      };

      const orchestrator = new FactoryOrchestrator(sequenceInvoker, false);

      const briefState = createWorkflowState('Build system', 1, mockProjectConfig);
      let state = briefState;

      state = await orchestrator.executeSequentialPhase(
        state,
        'product-manager',
        'product-manager',
        { brief: 'Build auth system' }
      );

      expect(phaseSequence[0]).toBe('product-manager');
      expect(state.phases[0].valid).toBe(true);
    });

    it('should pass artifacts between sequential phases', async () => {
      const artifactMap: Map<string, any> = new Map();

      const artifactInvoker = async (state: any, agentName: string, input: any): Promise<any> => {
        artifactMap.set(agentName, input);
        return {
          phase: agentName,
          valid: true,
          ...stubPayload(agentName),
          output: { data: `output-from-${agentName}` },
          artifacts: [
            {
              type: `${agentName}-artifact`,
              content: { phase: agentName, data: 'test' }
            }
          ]
        };
      };

      const orchestrator = new FactoryOrchestrator(artifactInvoker, false);
      let state = createWorkflowState('Build', undefined, mockProjectConfig);

      state = await orchestrator.executeSequentialPhase(
        state,
        'product-manager',
        'product-manager',
        { brief: 'test' }
      );

      state = await orchestrator.executeSequentialPhase(
        state,
        'analyzer',
        'analyzer',
        { productOutput: state.artifacts[0]?.content }
      );

      expect(state.artifacts).toHaveLength(2);
      expect(state.phases).toHaveLength(2);
    });

    it('should execute all three builders in parallel', async () => {
      const startTimes: Map<string, number> = new Map();
      const endTimes: Map<string, number> = new Map();

      const parallelInvoker = async (state: any, agentName: string): Promise<any> => {
        const startTime = Date.now();
        startTimes.set(agentName, startTime);

        await new Promise(resolve => setTimeout(resolve, 10));

        endTimes.set(agentName, Date.now());

        return {
          phase: agentName,
          valid: true,
          output: { built: true }
        };
      };

      const orchestrator = new FactoryOrchestrator(parallelInvoker, false);
      let state = createWorkflowState('Build', undefined, mockProjectConfig);

      const parallelPhases = [
        { phase: 'backend-engineer', agentName: 'backend-engineer', input: {} },
        { phase: 'frontend-engineer', agentName: 'frontend-engineer', input: {} },
        { phase: 'infrastructure-engineer', agentName: 'infrastructure-engineer', input: {} }
      ];

      state = await orchestrator.executeParallelPhases(state, parallelPhases as any);

      const builders = Array.from(startTimes.keys());
      expect(builders).toContain('backend-engineer');
      expect(builders).toContain('frontend-engineer');
      expect(builders).toContain('infrastructure-engineer');
    });
  });

  describe('Failure Scenarios - Early Termination', () => {
    it('should stop on product-manager validation failure', async () => {
      const invocationCount: Map<string, number> = new Map();

      const countingInvoker = async (state: any, agentName: string): Promise<any> => {
        const count = (invocationCount.get(agentName) || 0) + 1;
        invocationCount.set(agentName, count);

        if (agentName === 'product-manager') {
          return {
            phase: agentName,
            valid: false,
            error: 'Requirements not clear'
          };
        }

        return {
          phase: agentName,
          valid: true
        };
      };

      const orchestrator = new FactoryOrchestrator(countingInvoker, false);

      await orchestrator.executeWorkflow('Unclear brief', 1, mockProjectConfig);

      expect(invocationCount.get('product-manager')).toBe(1);
      expect(invocationCount.get('analyzer')).toBeUndefined();
    });

    it('should stop on analyzer validation failure', async () => {
      let phaseOrder: string[] = [];

      const sequenceTracker = async (state: any, agentName: string): Promise<any> => {
        phaseOrder.push(agentName);

        if (agentName === 'analyzer') {
          return {
            phase: agentName,
            valid: false,
            error: 'Stack detection failed'
          };
        }

        return {
          phase: agentName,
          valid: true,
          ...stubPayload(agentName),
          artifacts: [{ type: 'output', content: {} }]
        };
      };

      const orchestrator = new FactoryOrchestrator(sequenceTracker, false);

      await orchestrator.executeWorkflow('Build', 1, mockProjectConfig);

      expect(phaseOrder).toContain('product-manager');
      expect(phaseOrder).toContain('analyzer');
      expect(phaseOrder).not.toContain('software-architect');
    });

    it('should skip remaining phases on builder failure', async () => {
      let phaseOrder: string[] = [];

      const failingBuilderInvoker = async (state: any, agentName: string): Promise<any> => {
        phaseOrder.push(agentName);

        if (agentName === 'backend-engineer') {
          return {
            phase: agentName,
            valid: false,
            error: 'API generation failed'
          };
        }

        if (['product-manager', 'analyzer', 'software-architect'].includes(agentName)) {
          return { phase: agentName, valid: true };
        }

        return { phase: agentName, valid: true };
      };

      const orchestrator = new FactoryOrchestrator(failingBuilderInvoker, false);

      await orchestrator.executeWorkflow('Build', 1, mockProjectConfig);

      expect(phaseOrder).not.toContain('e2e-tester');
      expect(phaseOrder).not.toContain('reviewer');
    });
  });

  describe('Complex Retry Scenarios', () => {
    it('should retry phase 3 times before giving up', async () => {
      let attempts = 0;

      const retriableInvoker = async (): Promise<any> => {
        attempts++;
        if (attempts < 3) {
          throw new Error('ECONNREFUSED: Connection refused');
        }
        return {
          phase: 'analyzer',
          valid: true,
          ...stubPayload('analyzer')
        };
      };

      const orchestrator = new FactoryOrchestrator(retriableInvoker, false, undefined, {
        maxRetries: 3,
        backoffMs: 10
      });

      const state = createWorkflowState('Build');
      const result = await orchestrator.executeSequentialPhase(
        state,
        'analyzer',
        'analyzer',
        {}
      );

      expect(attempts).toBe(3);
      expect(result.phases[0].valid).toBe(true);
    });

    it('should fail after max retries exceeded', async () => {
      let attempts = 0;

      const persistentErrorInvoker = async (): Promise<any> => {
        attempts++;
        throw new Error('ECONNREFUSED: Connection refused');
      };

      const orchestrator = new FactoryOrchestrator(persistentErrorInvoker, false, undefined, {
        maxRetries: 2,
        backoffMs: 10
      });

      const state = createWorkflowState('Build');
      const result = await orchestrator.executeSequentialPhase(
        state,
        'analyzer',
        'analyzer',
        {}
      );

      expect(attempts).toBeLessThanOrEqual(2);
      expect(result.phases[0].valid).toBe(false);
    });
  });

  describe('State Consistency', () => {
    it('should maintain consistent workflow ID throughout execution', async () => {
      const orchestrator = new FactoryOrchestrator(
        async (state) => ({
          phase: state.currentPhase as any,
          valid: true,
          output: {}
        }),
        false
      );

      const state = createWorkflowState('Build', 1);
      const originalId = state.id;

      const result = await orchestrator.executeSequentialPhase(
        state,
        'analyzer',
        'analyzer',
        {}
      );

      expect(result.id).toBe(originalId);
    });

    it('should track all phase gates in order', async () => {
      const phases = ['product-manager', 'analyzer', 'software-architect'];
      let phaseIndex = 0;

      const orderedInvoker = async (state: any, agentName: string): Promise<any> => {
        phaseIndex++;
        return {
          phase: agentName,
          valid: true,
          output: { index: phaseIndex }
        };
      };

      const orchestrator = new FactoryOrchestrator(orderedInvoker, false);
      let state = createWorkflowState('Build', 1);

      for (const phase of phases) {
        state = await orchestrator.executeSequentialPhase(
          state,
          phase as any,
          phase,
          {}
        );
      }

      expect(state.phases).toHaveLength(3);
      expect(state.phases[0].phase).toBe('product-manager');
      expect(state.phases[1].phase).toBe('analyzer');
      expect(state.phases[2].phase).toBe('software-architect');
    });

    it('should accumulate artifacts across phases', async () => {
      const orchestrator = new FactoryOrchestrator(
        async (state, agentName) => ({
          phase: agentName as any,
          valid: true,
          ...stubPayload(agentName),
          artifacts: [
            {
              type: `${agentName}-output`,
              content: { phase: agentName }
            }
          ]
        }),
        false
      );

      let state = createWorkflowState('Build', 1);

      state = await orchestrator.executeSequentialPhase(
        state,
        'product-manager',
        'product-manager',
        {}
      );

      state = await orchestrator.executeSequentialPhase(
        state,
        'analyzer',
        'analyzer',
        {}
      );

      state = await orchestrator.executeSequentialPhase(
        state,
        'software-architect',
        'software-architect',
        {}
      );

      expect(state.artifacts).toHaveLength(3);
      expect(state.artifacts[0].type).toBe('product-manager-output');
      expect(state.artifacts[1].type).toBe('analyzer-output');
      expect(state.artifacts[2].type).toBe('software-architect-output');
    });
  });

  describe('Partial Parallel Failures', () => {
    it('should handle 1 of 3 builders failing', async () => {
      let builderAttempts = 0;

      const partialFailInvoker = async (state: any, agentName: string): Promise<any> => {
        if (agentName.endsWith('-engineer')) {
          builderAttempts++;
          if (agentName === 'frontend-engineer') {
            return {
              phase: agentName,
              valid: false,
              error: 'React build failed'
            };
          }
        }

        return {
          phase: agentName,
          valid: true,
          ...stubPayload(agentName),
          artifacts: [{ type: 'output', content: {} }]
        };
      };

      const orchestrator = new FactoryOrchestrator(partialFailInvoker, false);

      const phases = [
        { phase: 'backend-engineer', agentName: 'backend-engineer', input: {} },
        { phase: 'frontend-engineer', agentName: 'frontend-engineer', input: {} },
        { phase: 'infrastructure-engineer', agentName: 'infrastructure-engineer', input: {} }
      ];

      const state = createWorkflowState('Build', 1);
      const result = await orchestrator.executeParallelPhases(state, phases as any);

      const failedPhases = result.phases.filter(p => !p.valid);
      expect(failedPhases).toHaveLength(1);
      expect(failedPhases[0].phase).toBe('frontend-engineer');
    });
  });
});
