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
import { SlackNotifier, GitHubStatusUpdater, NotificationConfig } from './notifications';
import { RollbackManager } from './rollback';
import * as fs from 'fs';
import * as path from 'path';

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

interface RetryConfig {
  maxRetries: number;
  backoffMs: number;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export class FactoryOrchestrator {
  private invokeAgent: AgentInvoker;
  private verbose: boolean;
  private githubAPI: GitHubAPI | null;
  private prNumber: number | null = null;
  private retryConfig: RetryConfig;
  private slackNotifier: SlackNotifier | null;
  private githubStatusUpdater: GitHubStatusUpdater | null;
  private rollbackManager: RollbackManager;
  private currentCommit: string = '';

  constructor(invokeAgent: AgentInvoker, verbose: boolean = false, githubToken?: string, retryConfig?: Partial<RetryConfig>, notificationConfig?: NotificationConfig) {
    this.invokeAgent = invokeAgent;
    this.verbose = verbose;
    try {
      this.githubAPI = new GitHubAPI(githubToken);
    } catch {
      this.githubAPI = null;
    }
    this.retryConfig = {
      maxRetries: 3,
      backoffMs: 1000,
      ...retryConfig
    };

    // Initialize notifications
    this.slackNotifier = notificationConfig?.slackWebhookUrl
      ? new SlackNotifier(notificationConfig.slackWebhookUrl)
      : null;

    this.githubStatusUpdater = notificationConfig?.githubOwner && notificationConfig?.githubRepo && notificationConfig?.githubToken
      ? new GitHubStatusUpdater(notificationConfig.githubOwner, notificationConfig.githubRepo, notificationConfig.githubToken)
      : null;

    // Initialize rollback manager
    this.rollbackManager = new RollbackManager();
  }

  private log(message: string): void {
    if (this.verbose) {
      console.log(`[Orchestrator] ${message}`);
    }
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private isTransientError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return message.includes('timeout') ||
           message.includes('econnrefused') ||
           message.includes('enotfound') ||
           message.includes('network');
  }

  private async retryWithBackoff<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        this.log(`Attempting ${operationName} (attempt ${attempt}/${this.retryConfig.maxRetries})`);
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (!this.isTransientError(lastError)) {
          throw lastError;
        }

        if (attempt < this.retryConfig.maxRetries) {
          const backoffMs = this.retryConfig.backoffMs * Math.pow(2, attempt - 1);
          this.log(`Transient error in ${operationName}: ${lastError.message}. Retrying in ${backoffMs}ms...`);
          await this.sleep(backoffMs);
        }
      }
    }

    throw lastError || new Error(`${operationName} failed after ${this.retryConfig.maxRetries} retries`);
  }

  private validateSetup(): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check required agent files
    const requiredAgents = [
      'product-manager',
      'analyzer',
      'mcp-configurator',
      'software-architect',
      'platform-architect',
      'ui-designer',
      'backend-engineer',
      'frontend-engineer',
      'infrastructure-engineer',
      'automation-tester',
      'e2e-tester',
      'customer-support',
      'reviewer'
    ];

    for (const agent of requiredAgents) {
      const agentPath = path.join(process.cwd(), '.claude', 'agents', `${agent}.md`);
      if (!fs.existsSync(agentPath)) {
        errors.push(`Missing agent file: ${agentPath}`);
      } else {
        try {
          fs.accessSync(agentPath, fs.constants.R_OK);
        } catch {
          errors.push(`Agent file not readable: ${agentPath}`);
        }
      }
    }

    // Check project.config.json
    const configPath = path.join(process.cwd(), 'project.config.json');
    if (!fs.existsSync(configPath)) {
      errors.push('Missing project.config.json');
    } else {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        if (!config.mcp_servers) {
          warnings.push('project.config.json missing mcp_servers configuration');
        }
      } catch (error) {
        errors.push('project.config.json contains invalid JSON');
      }
    }

    // Check CLAUDE.md
    const claudeMdPath = path.join(process.cwd(), '.claude', 'CLAUDE.md');
    if (!fs.existsSync(claudeMdPath)) {
      warnings.push('Missing .claude/CLAUDE.md orchestration guide');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  async executeSequentialPhase(
    state: WorkflowState,
    phase: Phase,
    agentName: string,
    input: Record<string, unknown>
  ): Promise<WorkflowState> {
    this.log(`Starting phase: ${phase}`);

    // Notify phase start
    if (this.slackNotifier) {
      try {
        await this.slackNotifier.notifyPhaseStart(state, phase);
      } catch (error) {
        this.log(`Failed to notify phase start: ${error}`);
      }
    }

    // Update GitHub status to pending
    if (this.githubStatusUpdater && this.currentCommit) {
      try {
        await this.githubStatusUpdater.updatePhaseStatus(this.currentCommit, phase, 'pending');
      } catch (error) {
        this.log(`Failed to update GitHub status: ${error}`);
      }
    }

    // Save snapshot before phase execution
    try {
      await this.rollbackManager.saveSnapshot(state, phase);
    } catch (error) {
      this.log(`Failed to save snapshot: ${error}`);
    }

    try {
      const response = await this.retryWithBackoff(
        () => this.invokeAgent(state, agentName, input),
        `phase ${phase}`
      );

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

        // Notify failure
        if (this.slackNotifier) {
          try {
            await this.slackNotifier.notifyFailure(updatedState, phase, response.error || 'Unknown error');
          } catch (error) {
            this.log(`Failed to notify failure: ${error}`);
          }
        }

        // Update GitHub status to failure
        if (this.githubStatusUpdater && this.currentCommit) {
          try {
            await this.githubStatusUpdater.updatePhaseStatus(this.currentCommit, phase, 'failure');
          } catch (error) {
            this.log(`Failed to update GitHub status: ${error}`);
          }
        }

        return updatedState;
      }

      this.log(`Phase ${phase} completed successfully`);

      // Update GitHub status to success
      if (this.githubStatusUpdater && this.currentCommit) {
        try {
          await this.githubStatusUpdater.updatePhaseStatus(this.currentCommit, phase, 'success');
        } catch (error) {
          this.log(`Failed to update GitHub status: ${error}`);
        }
      }

      // Notify phase complete
      if (this.slackNotifier) {
        try {
          await this.slackNotifier.notifyPhaseComplete(updatedState, phase);
        } catch (error) {
          this.log(`Failed to notify phase complete: ${error}`);
        }
      }

      return updatedState;
    } catch (error) {
      this.log(`Phase ${phase} threw error: ${error}`);
      const errorMsg = error instanceof Error ? error.message : String(error);
      const failedState = updatePhase(state, phase, false, undefined, errorMsg);

      // Notify failure
      if (this.slackNotifier) {
        try {
          await this.slackNotifier.notifyFailure(failedState, phase, errorMsg);
        } catch (err) {
          this.log(`Failed to notify failure: ${err}`);
        }
      }

      // Update GitHub status to failure
      if (this.githubStatusUpdater && this.currentCommit) {
        try {
          await this.githubStatusUpdater.updatePhaseStatus(this.currentCommit, phase, 'failure');
        } catch (err) {
          this.log(`Failed to update GitHub status: ${err}`);
        }
      }

      return failedState;
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
    // Pre-flight validation
    const validation = this.validateSetup();

    if (!validation.valid) {
      const errorMsg = `Setup validation failed: ${validation.errors.join('; ')}`;
      this.log(errorMsg);

      let state = createWorkflowState(issueBrief, issueNumber, config);
      state.status = 'failed';
      state = addNote(state, errorMsg);
      saveWorkflowState(state);

      throw new Error(errorMsg);
    }

    if (validation.warnings.length > 0) {
      validation.warnings.forEach(warning => {
        this.log(`Warning: ${warning}`);
      });
    }

    let state = createWorkflowState(issueBrief, issueNumber, config);
    state = addNote(state, `Workflow started with brief: ${issueBrief.substring(0, 100)}...`);
    saveWorkflowState(state);

    // Capture current commit
    try {
      this.currentCommit = await this.rollbackManager.getCurrentCommit();
    } catch (error) {
      this.log(`Failed to get current commit: ${error}`);
    }

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

    // Cleanup old snapshots
    this.rollbackManager.cleanupOldSnapshots(state.id, 5);

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
