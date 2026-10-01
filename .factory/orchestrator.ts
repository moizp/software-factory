import {
  WorkflowState,
  Phase,
  createWorkflowState,
  saveWorkflowState,
  updatePhase,
  addArtifact,
  addNote
} from './state';
import { GitHubAPI } from './github-integration';

interface AgentResponse {
  phase: Phase;
  valid: boolean;
  output?: Record<string, unknown>;
  error?: string;
  artifacts?: Array<{
    type: string;
    content: Record<string, unknown>;
  }>;
}

type AgentInvoker = (
  state: WorkflowState,
  agentName: string,
  input: Record<string, unknown>
) => Promise<AgentResponse>;

export class FactoryOrchestrator {
  private invokeAgent: AgentInvoker;
  private verbose: boolean;
  private githubAPI: GitHubAPI | null;
  private prNumber: number | null = null;

  constructor(invokeAgent: AgentInvoker, verbose: boolean = false, githubToken?: string) {
    this.invokeAgent = invokeAgent;
    this.verbose = verbose;
    try {
      this.githubAPI = new GitHubAPI(githubToken);
    } catch {
      this.githubAPI = null;
    }
  }

  private log(message: string): void {
    if (this.verbose) {
      console.log(`[Orchestrator] ${message}`);
    }
  }

  async executeSequentialPhase(
    state: WorkflowState,
    phase: Phase,
    agentName: string,
    input: Record<string, unknown>
  ): Promise<WorkflowState> {
    this.log(`Starting phase: ${phase}`);

    try {
      const response = await this.invokeAgent(state, agentName, input);

      let updatedState = updatePhase(
        state,
        phase,
        response.valid,
        response.output,
        response.error
      );

      if (response.artifacts) {
        for (const artifact of response.artifacts) {
          updatedState = addArtifact(
            updatedState,
            artifact.type,
            artifact.content
          );
        }
      }

      if (!response.valid) {
        this.log(`Phase ${phase} failed validation`);
        updatedState = addNote(updatedState, `Phase ${phase} failed: ${response.error}`);
        return updatedState;
      }

      this.log(`Phase ${phase} completed successfully`);
      return updatedState;
    } catch (error) {
      this.log(`Phase ${phase} threw error: ${error}`);
      const errorMsg = error instanceof Error ? error.message : String(error);
      return updatePhase(state, phase, false, undefined, errorMsg);
    }
  }

  async executeParallelPhases(
    state: WorkflowState,
    phases: Array<{
      phase: Phase;
      agentName: string;
      input: Record<string, unknown>;
    }>
  ): Promise<WorkflowState> {
    this.log(`Starting parallel phases: ${phases.map(p => p.phase).join(', ')}`);

    const results = await Promise.all(
      phases.map(({ phase, agentName, input }) =>
        this.invokeAgent(state, agentName, input).catch(error => ({
          phase,
          valid: false,
          error: error instanceof Error ? error.message : String(error)
        }))
      )
    );

    let updatedState = state;

    for (let i = 0; i < results.length; i++) {
      const response = results[i] as AgentResponse;
      updatedState = updatePhase(
        updatedState,
        response.phase,
        response.valid,
        response.output,
        response.error
      );

      if (response.artifacts) {
        for (const artifact of response.artifacts) {
          updatedState = addArtifact(
            updatedState,
            artifact.type,
            artifact.content
          );
        }
      }

      if (!response.valid) {
        this.log(`Parallel phase ${response.phase} failed`);
      } else {
        this.log(`Parallel phase ${response.phase} completed`);
      }
    }

    const allValid = results.every(r => r.valid);
    if (!allValid) {
      updatedState = addNote(updatedState, 'One or more parallel phases failed');
    }

    return updatedState;
  }

  async executeWorkflow(
    issueBrief: string,
    issueNumber?: number,
    config?: Record<string, unknown>
  ): Promise<WorkflowState> {
    let state = createWorkflowState(issueBrief, issueNumber, config);
    state = addNote(state, `Workflow started with brief: ${issueBrief.substring(0, 100)}...`);
    saveWorkflowState(state);

    // Create GitHub PR for workflow
    if (this.githubAPI && process.env.GITHUB_OWNER && process.env.GITHUB_REPO) {
      try {
        this.prNumber = await this.githubAPI.createPR({
          owner: process.env.GITHUB_OWNER,
          repo: process.env.GITHUB_REPO,
          title: `Factory Workflow: ${issueBrief.substring(0, 50)}`,
          body: `## Software Factory Workflow\n\n**Brief:** ${issueBrief}\n\n**Workflow ID:** ${state.id}\n\n**Status:** Starting execution\n\n### Phase Progress\n- [ ] Product Manager\n- [ ] Analyzer\n- [ ] Architect\n- [ ] Builders\n- [ ] Testers\n- [ ] E2E Tester\n- [ ] Reviewer\n- [ ] Customer Support`,
          branch: `factory/${state.id}`,
          base: 'main'
        });
        state = addNote(state, `GitHub PR created: #${this.prNumber}`);
      } catch (error) {
        this.log(`Failed to create GitHub PR: ${error}`);
      }
    }

    // Phase 1: Product Manager (sequential)
    state = await this.executeSequentialPhase(
      state,
      'product-manager',
      'product-manager',
      { brief: issueBrief }
    );
    saveWorkflowState(state);

    if (!this.getLatestPhaseGate(state)?.valid) {
      state = addNote(state, 'Workflow stopped at product-manager phase');
      state.status = 'failed';
      saveWorkflowState(state);

      if (this.githubAPI && this.prNumber) {
        try {
          await this.githubAPI.postComment(
            this.prNumber,
            `❌ Workflow failed at phase: **product-manager**\n\nError: ${state.phases[state.phases.length - 1]?.error || 'Unknown error'}`
          );
        } catch (error) {
          this.log(`Failed to post failure comment: ${error}`);
        }
      }

      return state;
    }

    // Phase 2: Analyzer (sequential)
    state = await this.executeSequentialPhase(
      state,
      'analyzer',
      'analyzer',
      { brief: issueBrief, productManagerOutput: this.getLatestArtifact(state) }
    );
    saveWorkflowState(state);

    if (!this.getLatestPhaseGate(state)?.valid) {
      state = addNote(state, 'Workflow stopped at analyzer phase');
      state.status = 'failed';
      saveWorkflowState(state);

      if (this.githubAPI && this.prNumber) {
        try {
          await this.githubAPI.postComment(
            this.prNumber,
            `❌ Workflow failed at phase: **analyzer**\n\nError: ${state.phases[state.phases.length - 1]?.error || 'Unknown error'}`
          );
        } catch (error) {
          this.log(`Failed to post failure comment: ${error}`);
        }
      }

      return state;
    }

    // Phase 3: Architect (sequential)
    state = await this.executeSequentialPhase(
      state,
      'architect',
      'architect',
      { analyzerOutput: this.getLatestArtifact(state) }
    );
    saveWorkflowState(state);

    if (!this.getLatestPhaseGate(state)?.valid) {
      state = addNote(state, 'Workflow stopped at architect phase');
      state.status = 'failed';
      saveWorkflowState(state);

      if (this.githubAPI && this.prNumber) {
        try {
          await this.githubAPI.postComment(
            this.prNumber,
            `❌ Workflow failed at phase: **architect**\n\nError: ${state.phases[state.phases.length - 1]?.error || 'Unknown error'}`
          );
        } catch (error) {
          this.log(`Failed to post failure comment: ${error}`);
        }
      }

      return state;
    }

    // Phase 4: Builders (parallel)
    state = await this.executeParallelPhases(state, [
      {
        phase: 'backend-builder',
        agentName: 'backend-builder',
        input: { architectOutput: this.getLatestArtifact(state) }
      },
      {
        phase: 'frontend-builder',
        agentName: 'frontend-builder',
        input: { architectOutput: this.getLatestArtifact(state) }
      },
      {
        phase: 'infrastructure-builder',
        agentName: 'infrastructure-builder',
        input: { architectOutput: this.getLatestArtifact(state) }
      }
    ]);
    saveWorkflowState(state);

    const buildersPassed = state.phases
      .filter(p => p.phase === 'backend-builder' || p.phase === 'frontend-builder' || p.phase === 'infrastructure-builder')
      .every(p => p.valid);

    if (!buildersPassed) {
      state = addNote(state, 'Workflow stopped: one or more builders failed');
      state.status = 'failed';
      saveWorkflowState(state);

      if (this.githubAPI && this.prNumber) {
        try {
          const failedBuilders = state.phases
            .filter(p => (p.phase === 'backend-builder' || p.phase === 'frontend-builder' || p.phase === 'infrastructure-builder') && !p.valid)
            .map(p => p.phase);
          await this.githubAPI.postComment(
            this.prNumber,
            `❌ Workflow failed at builders phase\n\nFailed builders: ${failedBuilders.join(', ')}`
          );
        } catch (error) {
          this.log(`Failed to post failure comment: ${error}`);
        }
      }

      return state;
    }

    // Phase 5: Testers (parallel)
    state = await this.executeParallelPhases(state, [
      {
        phase: 'backend-tester',
        agentName: 'backend-tester',
        input: { builderOutput: this.getLatestArtifactByPhase(state, 'backend-builder') }
      },
      {
        phase: 'frontend-tester',
        agentName: 'frontend-tester',
        input: { builderOutput: this.getLatestArtifactByPhase(state, 'frontend-builder') }
      },
      {
        phase: 'infrastructure-tester',
        agentName: 'infrastructure-tester',
        input: { builderOutput: this.getLatestArtifactByPhase(state, 'infrastructure-builder') }
      }
    ]);
    saveWorkflowState(state);

    const testersPassed = state.phases
      .filter(p => p.phase === 'backend-tester' || p.phase === 'frontend-tester' || p.phase === 'infrastructure-tester')
      .every(p => p.valid);

    if (!testersPassed) {
      state = addNote(state, 'Workflow stopped: one or more testers failed');
      state.status = 'failed';
      saveWorkflowState(state);

      if (this.githubAPI && this.prNumber) {
        try {
          const failedTesters = state.phases
            .filter(p => (p.phase === 'backend-tester' || p.phase === 'frontend-tester' || p.phase === 'infrastructure-tester') && !p.valid)
            .map(p => p.phase);
          await this.githubAPI.postComment(
            this.prNumber,
            `❌ Workflow failed at testers phase\n\nFailed testers: ${failedTesters.join(', ')}`
          );
        } catch (error) {
          this.log(`Failed to post failure comment: ${error}`);
        }
      }

      return state;
    }

    // Phase 6: E2E Tester (sequential)
    state = await this.executeSequentialPhase(
      state,
      'e2e-tester',
      'e2e-tester',
      { builderOutputs: this.getAllArtifactsByPhases(state, ['backend-builder', 'frontend-builder', 'infrastructure-builder']) }
    );
    saveWorkflowState(state);

    if (!this.getLatestPhaseGate(state)?.valid) {
      state = addNote(state, 'Workflow stopped at e2e-tester phase');
      state.status = 'failed';
      saveWorkflowState(state);

      if (this.githubAPI && this.prNumber) {
        try {
          await this.githubAPI.postComment(
            this.prNumber,
            `❌ Workflow failed at phase: **e2e-tester**\n\nError: ${state.phases[state.phases.length - 1]?.error || 'Unknown error'}`
          );
        } catch (error) {
          this.log(`Failed to post failure comment: ${error}`);
        }
      }

      return state;
    }

    // Phase 7: Reviewer (sequential)
    state = await this.executeSequentialPhase(
      state,
      'reviewer',
      'reviewer',
      { allArtifacts: state.artifacts }
    );
    saveWorkflowState(state);

    if (!this.getLatestPhaseGate(state)?.valid) {
      state = addNote(state, 'Workflow stopped at reviewer phase');
      state.status = 'failed';
      saveWorkflowState(state);

      if (this.githubAPI && this.prNumber) {
        try {
          await this.githubAPI.postComment(
            this.prNumber,
            `❌ Workflow failed at phase: **reviewer**\n\nError: ${state.phases[state.phases.length - 1]?.error || 'Unknown error'}`
          );
        } catch (error) {
          this.log(`Failed to post failure comment: ${error}`);
        }
      }

      return state;
    }

    // Phase 8: Customer Support (sequential)
    state = await this.executeSequentialPhase(
      state,
      'customer-support',
      'customer-support',
      { allArtifacts: state.artifacts, brief: issueBrief }
    );
    saveWorkflowState(state);

    if (!this.getLatestPhaseGate(state)?.valid) {
      state = addNote(state, 'Workflow stopped at customer-support phase');
      state.status = 'failed';
      saveWorkflowState(state);

      if (this.githubAPI && this.prNumber) {
        try {
          await this.githubAPI.postComment(
            this.prNumber,
            `❌ Workflow failed at phase: **customer-support**\n\nError: ${state.phases[state.phases.length - 1]?.error || 'Unknown error'}`
          );
        } catch (error) {
          this.log(`Failed to post failure comment: ${error}`);
        }
      }

      return state;
    }

    // Workflow completed
    state.status = 'completed';
    state.currentPhase = 'completed';
    state = addNote(state, 'Workflow completed successfully');
    saveWorkflowState(state);

    // Auto-merge PR on success
    if (this.githubAPI && this.prNumber) {
      try {
        await this.githubAPI.autoMergePR(this.prNumber);
        state = addNote(state, `PR #${this.prNumber} auto-merged`);
      } catch (error) {
        this.log(`Failed to auto-merge PR: ${error}`);
      }
    }

    return state;
  }

  private getLatestPhaseGate(state: WorkflowState) {
    return state.phases[state.phases.length - 1] || null;
  }

  private getLatestArtifact(state: WorkflowState) {
    return state.artifacts[state.artifacts.length - 1]?.content || null;
  }

  private getLatestArtifactByPhase(state: WorkflowState, phase: Phase) {
    const artifacts = state.artifacts.filter(a => a.phase === phase);
    return artifacts[artifacts.length - 1]?.content || null;
  }

  private getAllArtifactsByPhases(state: WorkflowState, phases: Phase[]) {
    return state.artifacts
      .filter(a => phases.includes(a.phase))
      .reduce((acc, a) => ({ ...acc, [a.phase]: a.content }), {});
  }
}

export async function mockAgentInvoker(
  state: WorkflowState,
  agentName: string,
  input: Record<string, unknown>
): Promise<AgentResponse> {
  await new Promise(resolve => setTimeout(resolve, 100));

  return {
    phase: state.currentPhase,
    valid: true,
    output: {
      agent: agentName,
      processedInput: input
    },
    artifacts: [
      {
        type: `${agentName}-output`,
        content: {
          agent: agentName,
          timestamp: new Date().toISOString(),
          data: input
        }
      }
    ]
  };
}
