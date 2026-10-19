import {
  WorkflowState,
  Phase,
  Usage,
  createWorkflowState,
  saveWorkflowState,
  updatePhase,
  addArtifact,
  addNote
} from './state';
import { GitHubAPI } from './github-integration';
import { Logger } from './logger';
import { STAGES, Stage, AgentName, AGENT_NAMES, agentFilePath } from './pipeline';
import { validateContract, normalizeResponse, stubPayload, ContractContext } from './contracts';
import { compactArtifacts, describePack, packContext } from './context';
import { languageFile, languageForAgents, languageHits, loadLanguage, renderLanguageLine, requireLanguage } from './language';
import { characterFile, characterForAgents, loadCharacter, renderCharacterLine, requireCharacter } from './character';
import { loadLookFeel, lookFeelFile, lookFeelForAgents, renderLookFeelLine, requireLookFeel } from './lookfeel';
import { loadMission, missionForAgents, parseDeclaration, renderMissionLine, requireMission, missionFile } from './mission';
import { saveHandoff } from './handoff';
import { contextBudget } from './prompts';
import { MAX_QUESTIONS_PER_PHASE, HumanRequest, answersFor, newExchange, parseRequest, pendingExchange, questionsAsked } from './human';
import {
  PLAN_INTENT, PLAN_PHASE, automatedChecks, builtPaths, consumePlanChanges, parsePlan, planDeviations, planReview,
  renderDeviations, renderPlanSummary
} from './plan';
import { FailureMarker, addUsage, classifyFailure, maxRepairs, trimProblem, withRepair } from './repair';
import { Policy, Decision, evaluatePolicy, loadPolicy } from './policy-engine';
import { Board, evaluateWip, loadBoardIfPresent } from './board';
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
  usage?: Usage;
  failure?: FailureMarker;
  /** A typed question for a person; honoured only together with valid: false. */
  needs_human?: unknown;
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

class AgentResponseValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentResponseValidationError';
  }
}

function validateAgentResponse(response: AgentResponse, expectedPhase: string, context: ContractContext = {}): void {
  if (!response || typeof response !== 'object') {
    throw new AgentResponseValidationError(`Invalid agent response from ${expectedPhase}: not an object`);
  }

  const errors = validateContract(response, expectedPhase, context);
  if (errors.length > 0) {
    throw new AgentResponseValidationError(
      `Invalid agent response from ${expectedPhase}:\n  ${errors.join('\n  ')}`
    );
  }
}

export class FactoryOrchestrator {
  private invokeAgent: AgentInvoker;
  private verbose: boolean;
  private githubAPI: GitHubAPI | null;
  private prNumber: number | null = null;
  private retryConfig: RetryConfig;
  private logger: Logger;
  /** Notes about shortened inputs, added to the workflow state after the stage that used them. */
  private contextNotes: string[] = [];

  constructor(invokeAgent: AgentInvoker, verbose: boolean = false, githubToken?: string, retryConfig?: Partial<RetryConfig>) {
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

    this.logger = new Logger(undefined, verbose ? 'DEBUG' : 'INFO');
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
        this.logger.info(`Attempting ${operationName} (attempt ${attempt}/${this.retryConfig.maxRetries})`);
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (!this.isTransientError(lastError)) {
          throw lastError;
        }

        if (attempt < this.retryConfig.maxRetries) {
          const backoffMs = this.retryConfig.backoffMs * Math.pow(2, attempt - 1);
          this.logger.warn(`Transient error in ${operationName}: ${lastError.message}. Retrying in ${backoffMs}ms...`);
          await this.sleep(backoffMs);
        }
      }
    }

    throw lastError || new Error(`${operationName} failed after ${this.retryConfig.maxRetries} retries`);
  }

  /**
   * Calls the agent and checks its reply against the contract. If the reply is unusable (not readable JSON, or it
   * breaks the contract) the agent is asked again, up to FACTORY_MAX_REPAIRS times, with a short note of what was
   * wrong. A reply where the agent itself declines (valid: false with a reason) is returned as is. Usage from every
   * attempt is added up, so re-asks count against the token budget.
   */
  private async invokeAndValidate(
    state: WorkflowState,
    phase: Phase,
    agentName: string,
    input: Record<string, unknown>
  ): Promise<{ response: AgentResponse; validationError: string | null; attempts: number }> {
    const allowed = maxRepairs();
    let usage: Usage | undefined;
    let current = input;

    for (let attempts = 1; ; attempts++) {
      const raw = await this.retryWithBackoff(
        () => this.invokeAgent(state, agentName, current),
        `phase ${phase}`
      );
      usage = addUsage(usage, raw?.usage);
      const response = raw && attempts > 1 ? { ...raw, usage } : raw;

      let validationError: string | null = null;
      try {
        validateAgentResponse(response, agentName, {
          ...(state.mission ? { mission: state.mission, declared: parseDeclaration(state.issueBrief) } : {}),
          ...(state.lookfeel ? { lookfeel: state.lookfeel } : {}),
          ...(state.character ? { character: state.character } : {})
        });
      } catch (error) {
        validationError = error instanceof Error ? error.message : String(error);
      }
      // A question for a person must be well formed, or the agent is asked to fix it like any other bad reply.
      if (validationError === null && response && response.valid === false && response.needs_human !== undefined) {
        const parsed = parseRequest(response.needs_human);
        if (!parsed.ok) validationError = `needs_human is not valid: ${parsed.error}`;
      }

      const verdict = classifyFailure(response, validationError);
      if (verdict.kind !== 'repairable') {
        return { response, validationError, attempts };
      }
      if (attempts > allowed) {
        // Still unusable after every allowed re-ask: report it as a failed reply, with the number of tries.
        return { response, validationError: verdict.problem, attempts };
      }
      this.logger.warn(`Phase ${phase}: reply rejected (${trimProblem(verdict.problem, 160)}). Asking again (${attempts}/${allowed}).`);
      current = withRepair(input, attempts, verdict.problem);
    }
  }

  /** The agent's question for a person, if it asked one (already checked by invokeAndValidate). */
  private humanRequestFrom(response: AgentResponse): HumanRequest | null {
    if (!response || response.valid !== false || response.needs_human === undefined) return null;
    const parsed = parseRequest(response.needs_human);
    return parsed.ok ? parsed.request : null;
  }

  /**
   * Records a question and pauses. The phase's gate stays invalid so that resuming runs it again, now with the answer.
   * An agent that keeps asking is stuck, so after MAX_QUESTIONS_PER_PHASE questions the phase fails instead.
   */
  private pauseForHuman(state: WorkflowState, phase: Phase, request: HumanRequest, usage?: Usage): WorkflowState {
    if (questionsAsked(state.humanRequests, phase) >= MAX_QUESTIONS_PER_PHASE) {
      const failed = updatePhase(state, phase, false, undefined, `Asked more than ${MAX_QUESTIONS_PER_PHASE} questions without finishing`, usage);
      return addNote(failed, `Phase ${phase} kept asking for help and was stopped after ${MAX_QUESTIONS_PER_PHASE} questions`);
    }
    const exchange = newExchange(phase, request, state.humanRequests);
    let paused = updatePhase(state, phase, false, undefined, `Waiting for a person: ${request.question}`, usage);
    paused = { ...paused, status: 'paused', humanRequests: [...(state.humanRequests ?? []), exchange] };
    return addNote(paused, `Phase ${phase} asked a person (${request.urgency} urgency): ${request.question}`);
  }

  /**
   * Reads the project's MISSION.md into the new workflow. A mission that is there but unusable stops the run: planning
   * against a half-read mission is worse than none. A missing one stops it only when FACTORY_REQUIRE_MISSION is on.
   */
  private attachMission(state: WorkflowState): WorkflowState {
    const load = loadMission();
    if (!load.found) {
      const message = `No mission file at ${missionFile()}: work is not checked against a mission (see .claude/skills/mission.md)`;
      if (requireMission()) return { ...addNote(state, `${message}. FACTORY_REQUIRE_MISSION is on, so the workflow stops here`), status: 'failed' };
      this.logger.warn(message);
      return addNote(state, message);
    }
    if (!load.result.ok) {
      this.logger.error(`Mission file is not usable: ${load.result.errors.join('; ')}`);
      return { ...addNote(state, `Mission file ${load.file} is not usable: ${load.result.errors.join('; ')}`), status: 'failed' };
    }
    let next: WorkflowState = { ...state, mission: load.result.mission };
    next = addNote(next, `Mission loaded: ${renderMissionLine(load.result.mission)}`);
    for (const w of load.result.warnings) next = addNote(next, `Mission advice: ${w}`);
    return next;
  }

  /**
   * Reads the project's CHARACTER.md into the new workflow, checked against the mission when there is one. Like the
   * look and feel, an unusable file stops the run and a missing one only adds a note unless FACTORY_REQUIRE_CHARACTER is on.
   */
  private attachCharacter(state: WorkflowState): WorkflowState {
    const load = loadCharacter(state.mission);
    if (!load.found) {
      const message = `No character file at ${characterFile()}: the product is not built to a declared character (see .claude/skills/character.md)`;
      if (requireCharacter()) return { ...addNote(state, `${message}. FACTORY_REQUIRE_CHARACTER is on, so the workflow stops here`), status: 'failed' };
      this.logger.warn(message);
      return addNote(state, message);
    }
    if (!load.result.ok) {
      this.logger.error(`Character file is not usable: ${load.result.errors.join('; ')}`);
      return { ...addNote(state, `Character file ${load.file} is not usable: ${load.result.errors.join('; ')}`), status: 'failed' };
    }
    let next: WorkflowState = { ...state, character: load.result.character };
    next = addNote(next, `Character loaded: ${renderCharacterLine(load.result.character)}`);
    for (const w of load.result.warnings) next = addNote(next, `Character advice: ${w}`);
    return next;
  }

  /**
   * Reads the project's glossary into the new workflow when its Status is "current". A draft glossary is a note, not a
   * rule; an unusable current one stops the run, and a missing one only adds a note unless FACTORY_REQUIRE_LANGUAGE is on.
   */
  private attachLanguage(state: WorkflowState): WorkflowState {
    const load = loadLanguage();
    if (!load.found) {
      const message = `No glossary at ${languageFile()}: people, domain experts and agents have no declared shared vocabulary (see .claude/skills/ubiquitous-language.md)`;
      if (requireLanguage()) return { ...addNote(state, `${message}. FACTORY_REQUIRE_LANGUAGE is on, so the workflow stops here`), status: 'failed' };
      this.logger.warn(message);
      return addNote(state, message);
    }
    if ('skipped' in load) {
      const message = `Glossary ${load.file} is not used: ${load.skipped}`;
      if (requireLanguage()) return { ...addNote(state, `${message}. FACTORY_REQUIRE_LANGUAGE is on, so the workflow stops here`), status: 'failed' };
      return addNote(state, message);
    }
    if (!load.result.ok) {
      this.logger.error(`Glossary is not usable: ${load.result.errors.join('; ')}`);
      return { ...addNote(state, `Glossary ${load.file} is not usable: ${load.result.errors.join('; ')}`), status: 'failed' };
    }
    let next: WorkflowState = { ...state, language: load.result.terms };
    next = addNote(next, `Language loaded: ${renderLanguageLine(load.result.terms)}`);
    for (const w of load.result.warnings) next = addNote(next, `Language advice: ${w}`);
    return next;
  }

  /** Where the work so far uses a word the glossary says to avoid, for the reviewer to judge. Empty without a glossary. */
  private languageCheck(state: WorkflowState): Record<string, unknown> {
    if (!state.language) return {};
    const outputs: Record<string, unknown> = {};
    for (const a of state.artifacts) outputs[a.phase] = [...((outputs[a.phase] as unknown[] | undefined) ?? []), a.content];
    return { languageCheck: { avoid_words_used: languageHits(outputs, state.language) } };
  }

  /**
   * Reads the project's LOOKFEEL.md into the new workflow, checked against the mission when there is one. Like the
   * mission, an unusable file stops the run and a missing one only adds a note unless FACTORY_REQUIRE_LOOKFEEL is on.
   */
  private attachLookFeel(state: WorkflowState): WorkflowState {
    const load = loadLookFeel(state.mission);
    if (!load.found) {
      const message = `No look and feel file at ${lookFeelFile()}: the interface is not built to a declared look, feel and tone (see .claude/skills/look-and-feel.md)`;
      if (requireLookFeel()) return { ...addNote(state, `${message}. FACTORY_REQUIRE_LOOKFEEL is on, so the workflow stops here`), status: 'failed' };
      this.logger.warn(message);
      return addNote(state, message);
    }
    if (!load.result.ok) {
      this.logger.error(`Look and feel file is not usable: ${load.result.errors.join('; ')}`);
      return { ...addNote(state, `Look and feel file ${load.file} is not usable: ${load.result.errors.join('; ')}`), status: 'failed' };
    }
    let next: WorkflowState = { ...state, lookfeel: load.result.lookFeel };
    next = addNote(next, `Look and feel loaded: ${renderLookFeelLine(load.result.lookFeel)}`);
    for (const w of load.result.warnings) next = addNote(next, `Look and feel advice: ${w}`);
    return next;
  }

  private flushContextNotes(state: WorkflowState): WorkflowState {
    const notes = this.contextNotes;
    this.contextNotes = [];
    return notes.reduce((s, n) => addNote(s, n), state);
  }

  /** Plan approval is on with FACTORY_PLAN_APPROVAL=1 or `"plan_approval": true` in the workflow config. */
  private planApprovalRequired(state: WorkflowState): boolean {
    return /^(1|true)$/i.test(process.env.FACTORY_PLAN_APPROVAL ?? '') || state.config?.plan_approval === true;
  }

  /**
   * Puts the architect's plan to a person as a question and pauses. The answer "approve" lets the build start; anything
   * else is taken as changes to make and the architect runs again with it. Rounds are limited like any other question.
   */
  private askForPlanApproval(state: WorkflowState): WorkflowState {
    const plan = parsePlan(this.getLatestArtifactByPhase(state, PLAN_PHASE)?.implementation_plan, state.mission ? { mission: state.mission } : {});
    if (!plan.ok) {
      const failed = addNote(state, `Plan approval impossible: ${plan.error}`);
      return { ...failed, status: 'failed' };
    }
    if (questionsAsked(state.humanRequests, PLAN_PHASE) >= MAX_QUESTIONS_PER_PHASE) {
      const failed = addNote(state, `The plan was not approved after ${MAX_QUESTIONS_PER_PHASE} rounds of questions; stopped`);
      return { ...failed, status: 'failed' };
    }
    const exchange = newExchange(PLAN_PHASE, {
      intent: PLAN_INTENT,
      question: 'Approve this implementation plan, or say what should change? Answer "approve" to start the build.',
      context: renderPlanSummary(plan.plan, 6000, state.mission),
      urgency: 'medium',
      format: 'free_text'
    }, state.humanRequests);
    this.logger.info(`Workflow ${state.id} paused: waiting for the plan to be approved`);
    const paused: WorkflowState = { ...state, status: 'paused', humanRequests: [...(state.humanRequests ?? []), exchange] };
    return addNote(paused, `Paused: the implementation plan needs approval. Answer with: factory answer ${state.id} "approve" (or say what to change)`);
  }

  /** The plan's files compared with what the builders produced, as one line for the workflow notes. Null without a plan. */
  private planDeviationNote(state: WorkflowState): string | null {
    const check = this.planCheck(state);
    if (!check) return null;
    return `Plan check: ${renderDeviations(check.deviations)}`;
  }

  private planCheck(state: WorkflowState): { deviations: ReturnType<typeof planDeviations>; automated_checks: string[] } | null {
    const plan = parsePlan(this.getLatestArtifactByPhase(state, PLAN_PHASE)?.implementation_plan, state.mission ? { mission: state.mission } : {});
    if (!plan.ok) return null;
    const builders: AgentName[] = ['backend-engineer', 'frontend-engineer', 'infrastructure-engineer'];
    const outputs = state.artifacts.filter(a => builders.includes(a.phase as AgentName)).map(a => a.content);
    return { deviations: planDeviations(plan.plan, builtPaths(outputs)), automated_checks: automatedChecks(plan.plan) };
  }

  private validateSetup(): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check required agent files
    const requiredAgents: string[] = [...AGENT_NAMES];

    for (const agent of requiredAgents) {
      const agentPath = agentFilePath(agent);
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
    this.logger.info(`Starting phase: ${phase}`);

    try {
      const checked = await this.invokeAndValidate(state, phase, agentName, input);
      const rawResponse = checked.response;

      // The reply is still unusable after any re-asks
      if (checked.validationError !== null) {
        this.logger.error(`Agent response validation failed for ${agentName}: ${checked.validationError}`);
        const tried = checked.attempts > 1 ? ` (after ${checked.attempts} attempts)` : '';
        return updatePhase(state, phase, false, undefined, `${checked.validationError}${tried}`, rawResponse?.usage);
      }

      const asked = this.humanRequestFrom(rawResponse);
      if (asked) {
        return this.pauseForHuman(state, phase, asked, rawResponse.usage);
      }

      const response = normalizeResponse(rawResponse, agentName);

      let updatedState = updatePhase(
        state,
        phase,
        response.valid,
        response.output,
        response.error,
        response.usage
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

      if (checked.attempts > 1) {
        updatedState = addNote(updatedState, `Phase ${phase} needed ${checked.attempts} attempts: the first reply was rejected and the agent was asked again`);
      }

      if (!response.valid) {
        this.logger.info(`Phase ${phase} failed validation`);
        updatedState = addNote(updatedState, `Phase ${phase} failed: ${response.error}`);

        return updatedState;
      }

      this.logger.info(`Phase ${phase} completed successfully`);

      return updatedState;
    } catch (error) {
      this.logger.info(`Phase ${phase} threw error: ${error}`);
      const errorMsg = error instanceof Error ? error.message : String(error);
      const failedState = updatePhase(state, phase, false, undefined, errorMsg);

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
    this.logger.info(`Starting parallel phases: ${phases.map(p => p.phase).join(', ')}`);

    const results = await Promise.all(
      phases.map(({ phase, agentName, input }) =>
        this.invokeAndValidate(state, phase, agentName, input).catch(error => ({
          response: {
            phase,
            valid: false,
            error: error instanceof Error ? error.message : String(error)
          } as AgentResponse,
          validationError: null as string | null,
          attempts: 1
        }))
      )
    );

    let updatedState = state;

    for (let i = 0; i < results.length; i++) {
      const checked = results[i] as { response: AgentResponse; validationError: string | null; attempts: number };
      const rawResponse = checked.response;
      const { phase } = phases[i];

      // The reply is still unusable after any re-asks
      if (checked.validationError !== null) {
        this.logger.error(`Parallel agent response validation failed for ${phase}: ${checked.validationError}`);
        const tried = checked.attempts > 1 ? ` (after ${checked.attempts} attempts)` : '';
        updatedState = updatePhase(updatedState, phase, false, undefined, `${checked.validationError}${tried}`, rawResponse?.usage);
        continue;
      }

      const asked = this.humanRequestFrom(rawResponse);
      if (asked) {
        updatedState = this.pauseForHuman(updatedState, phase, asked, rawResponse.usage);
        continue;
      }

      const response = normalizeResponse(rawResponse, phases[i].agentName);

      updatedState = updatePhase(
        updatedState,
        phase,
        response.valid,
        response.output,
        response.error,
        response.usage
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

      if (checked.attempts > 1) {
        updatedState = addNote(updatedState, `Phase ${phase} needed ${checked.attempts} attempts: the first reply was rejected and the agent was asked again`);
      }

      if (!response.valid) {
        this.logger.info(`Parallel phase ${phase} failed`);
      } else {
        this.logger.info(`Parallel phase ${phase} completed`);
      }
    }

    const allValid = phases.every(({ phase }) => this.getLatestGateFor(updatedState, phase)?.valid);
    if (!allValid) {
      updatedState = addNote(updatedState, 'One or more parallel phases failed');
    }

    return updatedState;
  }

  /** Runs the workflow. A workflow that ends without completing leaves a handoff file beside its state. */
  async executeWorkflow(
    issueBrief: string,
    issueNumber?: number,
    config?: Record<string, unknown>,
    resumeFrom?: WorkflowState,
    options: { until?: AgentName } = {}
  ): Promise<WorkflowState> {
    const state = await this.runWorkflow(issueBrief, issueNumber, config, resumeFrom, options);
    try {
      saveHandoff(state);
    } catch (error) {
      this.logger.warn(`Could not write the handoff file: ${error}`);
    }
    return state;
  }

  private async runWorkflow(
    issueBrief: string,
    issueNumber?: number,
    config?: Record<string, unknown>,
    resumeFrom?: WorkflowState,
    options: { until?: AgentName } = {}
  ): Promise<WorkflowState> {
    if (options.until && !AGENT_NAMES.includes(options.until)) {
      throw new Error(`Unknown agent for --until: ${options.until} (expected one of ${AGENT_NAMES.join(', ')})`);
    }

    // Pre-flight validation
    const validation = this.validateSetup();

    if (!validation.valid) {
      const errorMsg = `Setup validation failed: ${validation.errors.join('; ')}`;
      this.logger.error(errorMsg);

      let state = createWorkflowState(issueBrief, issueNumber, config);
      state.status = 'failed';
      state = addNote(state, errorMsg);
      saveWorkflowState(state);

      throw new Error(errorMsg);
    }

    if (validation.warnings.length > 0) {
      validation.warnings.forEach(warning => {
        this.logger.warn(`Warning: ${warning}`);
        this.logger.warn(warning);
      });
    }

    // New work respects the board's WIP limits; resuming existing work does not count as new
    if (!resumeFrom) {
      await this.enforceWipLimits();
    }

    const waiting = pendingExchange(resumeFrom?.humanRequests);
    if (resumeFrom && waiting) {
      throw new Error(`Workflow ${resumeFrom.id} is waiting for an answer to: ${waiting.request.question} (answer it with: factory answer ${resumeFrom.id} "<answer>")`);
    }

    let state: WorkflowState;
    if (resumeFrom) {
      state = this.prepareResume(resumeFrom);
    } else {
      state = createWorkflowState(issueBrief, issueNumber, config);
      state = addNote(state, `Workflow started with brief: ${issueBrief.substring(0, 100)}...`);
      state = this.attachMission(state);
      if (state.status !== 'failed') state = this.attachCharacter(state);
      if (state.status !== 'failed') state = this.attachLookFeel(state);
      if (state.status !== 'failed') state = this.attachLanguage(state);
      if (state.status === 'failed') {
        saveWorkflowState(state);
        return state;
      }
    }
    saveWorkflowState(state);
    this.logger.info(resumeFrom ? 'Workflow resumed' : 'Workflow created', { workflowId: state.id, brief: issueBrief.substring(0, 100) });

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
        this.logger.error(`Failed to create GitHub PR: ${error}`);
      }
    }

    // Execute stages in order; stages already satisfied (resume) are not run again, but the checks after a stage still apply
    for (const stage of STAGES) {
      if (this.isStageDone(state, stage)) {
        this.logger.info(`Skipping completed stage: ${stage.id}`);
      } else {
        const budget = this.tokenBudget();
        if (budget > 0 && (state.tokensUsed ?? 0) >= budget) {
          state = addNote(state, `Token budget reached before stage ${stage.id}: ${state.tokensUsed}/${budget}. Raise FACTORY_MAX_TOKENS and run: factory retry ${state.id}`);
          state.status = 'paused';
          saveWorkflowState(state);
          this.logger.warn(`Token budget reached (${state.tokensUsed}/${budget}); workflow paused`);
          return state;
        }

        state = stage.mode === 'parallel'
          ? await this.executeParallelPhases(
              state,
              stage.agents.map(agent => ({ phase: agent, agentName: agent, input: this.buildInput(state, agent) }))
            )
          : await this.executeSequentialPhase(
              state,
              stage.agents[0],
              stage.agents[0],
              this.buildInput(state, stage.agents[0])
            );
        state = this.flushContextNotes(state);
        saveWorkflowState(state);

        const question = pendingExchange(state.humanRequests);
        if (question) {
          state = addNote(state, `Paused: waiting for a person to answer. Answer with: factory answer ${state.id} "<answer>"`);
          state.status = 'paused';
          saveWorkflowState(state);
          this.logger.info(`Workflow ${state.id} paused for a person: ${question.request.question}`);
          return state;
        }

        const failed = stage.agents.filter(agent => !this.getLatestGateFor(state, agent)?.valid);
        if (failed.length > 0) {
          return this.failWorkflow(state, stage, failed);
        }

        if (stage.id === 'build') {
          const note = this.planDeviationNote(state);
          if (note) state = addNote(state, note);
        }
      }

      // A person approves the plan before anything is built (when plan approval is on)
      if ((stage.agents as string[]).includes(PLAN_PHASE) && this.planApprovalRequired(state) && planReview(state.humanRequests) === 'none') {
        state = this.askForPlanApproval(state);
        saveWorkflowState(state);
        return state;
      }

      if (options.until && (stage.agents as string[]).includes(options.until)) {
        state = addNote(state, `Stopped after ${options.until} (--until). Continue with: factory retry ${state.id}`);
        state.status = 'paused';
        saveWorkflowState(state);
        this.logger.info(`Stopped after ${options.until}; ${state.tokensUsed ?? 0} tokens used`);
        return state;
      }
    }

    // Workflow completed
    this.logger.info(`Tokens used: ${state.tokensUsed ?? 0}`);
    state.status = 'completed';
    state.currentPhase = 'completed';
    state = addNote(state, 'Workflow completed successfully');
    saveWorkflowState(state);

    // Merge only if the repo policy (read from the base branch) allows it
    state = await this.maybeAutoMerge(state);

    this.logger.info('Workflow execution complete', { workflowId: state.id });
    return state;
  }

  /**
   * Evaluates .factory/policy.json (from origin/main, never from the PR) and merges
   * only when the policy allows auto-merge and every required check passed.
   * Anything unclear leaves the PR open for a human.
   */
  private async maybeAutoMerge(state: WorkflowState): Promise<WorkflowState> {
    if (!this.githubAPI || !this.prNumber) return state;

    let decision: Decision;
    let headSha: string;
    try {
      const info = await this.githubAPI.getPRInfo(this.prNumber);
      headSha = info.headSha;
      decision = evaluatePolicy(this.loadBasePolicy(), info);
    } catch (error) {
      this.logger.warn(`Auto-merge skipped: could not evaluate policy: ${error}`);
      return addNote(state, 'Auto-merge skipped: could not evaluate policy');
    }

    if (!decision.autoMerge) {
      const message = `Needs a human merge (${decision.approvals} approval${decision.approvals === 1 ? '' : 's'}): ${decision.reasons.join('; ')}`;
      this.logger.info(message);
      await this.githubAPI.postComment(this.prNumber, `Policy: ${message}`).catch(() => undefined);
      return addNote(state, message);
    }

    if (decision.require.includes('reviewer_verdict') && this.getLatestGateFor(state, 'reviewer')?.valid !== true) {
      return addNote(state, 'Auto-merge skipped: reviewer verdict is not valid');
    }

    if (decision.require.includes('ci')) {
      const ci = await this.waitForCi(headSha);
      if (ci !== 'success') {
        this.logger.info(`Auto-merge skipped: CI is ${ci}`);
        return addNote(state, `Auto-merge skipped: CI is ${ci}`);
      }
    }

    try {
      await this.githubAPI.autoMergePR(this.prNumber);
      return addNote(state, `PR #${this.prNumber} auto-merged (${decision.reasons.join('; ')})`);
    } catch (error) {
      this.logger.warn(`Failed to auto-merge PR: ${error}`);
      return addNote(state, 'Auto-merge failed; a human needs to merge');
    }
  }

  private async waitForCi(sha: string): Promise<'success' | 'failure' | 'pending' | 'none'> {
    const pollMs = Number(process.env.FACTORY_CI_POLL_MS) || 30_000;
    const timeoutMs = Number(process.env.FACTORY_CI_TIMEOUT_MS) || 15 * 60_000;
    const deadline = Date.now() + timeoutMs;
    let result: 'success' | 'failure' | 'pending' | 'none' = 'none';

    for (;;) {
      result = await this.githubAPI!.getCheckSummary(sha);
      if (result === 'success' || result === 'failure' || Date.now() >= deadline) return result;
      await this.sleep(pollMs);
    }
  }

  private loadBasePolicy(): Policy {
    return loadPolicy('origin/main');
  }

  /**
   * Refuses to start new work when the board's WIP limits are reached (.factory/board.json).
   * Reading open PRs is best effort: if GitHub cannot be reached the limit is not enforced.
   */
  private async enforceWipLimits(): Promise<void> {
    const board = this.loadWipBoard();
    if (!board || !board.wip_enforcement.block_new_work) return;
    const override = board.wip_enforcement.override_env;
    if (override && process.env[override]) {
      this.logger.warn(`WIP limits ignored (${override} is set)`);
      return;
    }
    if (!this.githubAPI || !process.env.GITHUB_OWNER || !process.env.GITHUB_REPO) return;

    let counts;
    try {
      counts = await this.githubAPI.getWipCounts();
    } catch (error) {
      this.logger.warn(`WIP check skipped: ${error}`);
      return;
    }

    const decision = evaluateWip(board, counts);
    if (!decision.canStart) {
      throw new Error(`WIP limit reached. ${decision.reasons.join('. ')}. Set ${override ?? 'the override'} to start anyway.`);
    }
  }

  private loadWipBoard(): Board | null {
    return loadBoardIfPresent();
  }

  /** Max tokens per workflow (input + output + cache); 0 disables. Tune with FACTORY_MAX_TOKENS. */
  private tokenBudget(): number {
    const fromEnv = Number(process.env.FACTORY_MAX_TOKENS);
    return Number.isFinite(fromEnv) && fromEnv >= 0 && process.env.FACTORY_MAX_TOKENS !== undefined
      ? fromEnv
      : 600_000;
  }

  private getLatestGateFor(state: WorkflowState, phase: Phase) {
    const gates = state.phases.filter(p => p.phase === phase);
    return gates[gates.length - 1] || null;
  }

  private isStageDone(state: WorkflowState, stage: Stage): boolean {
    return stage.agents.every(agent => this.getLatestGateFor(state, agent)?.valid === true);
  }

  /** Keep only validated work; failed gates and their artifacts are re-run. */
  private prepareResume(previous: WorkflowState): WorkflowState {
    // A plan sent back for changes is revised: the architect's work is dropped so it runs again with the answer
    const sentBack = planReview(previous.humanRequests) === 'changes';
    const okPhases = new Set(
      AGENT_NAMES.filter(agent => this.getLatestGateFor(previous, agent)?.valid === true && !(sentBack && agent === PLAN_PHASE))
    );
    const dropped = previous.phases.filter(p => !okPhases.has(p.phase as AgentName)).length;

    let state: WorkflowState = {
      ...previous,
      status: 'running',
      updatedAt: new Date().toISOString(),
      humanRequests: sentBack ? consumePlanChanges(previous.humanRequests) : previous.humanRequests,
      phases: previous.phases.filter(p => okPhases.has(p.phase as AgentName) && p.valid),
      artifacts: previous.artifacts.filter(a => okPhases.has(a.phase as AgentName))
    };
    state = addNote(state, `Resumed: keeping ${okPhases.size} completed phases, re-running ${dropped} failed gates`);
    return state;
  }

  private async failWorkflow(state: WorkflowState, stage: Stage, failedAgents: AgentName[]): Promise<WorkflowState> {
    state = addNote(state, `Workflow stopped at ${stage.id} stage: ${failedAgents.join(', ')}`);
    state.status = 'failed';
    saveWorkflowState(state);

    if (this.githubAPI && this.prNumber) {
      const details = failedAgents
        .map(agent => `- **${agent}**: ${this.getLatestGateFor(state, agent)?.error || 'Unknown error'}`)
        .join('\n');
      try {
        await this.githubAPI.postComment(
          this.prNumber,
          `❌ Workflow failed at stage: **${stage.id}**\n\n${details}`
        );
      } catch (error) {
        this.logger.error(`Failed to post failure comment: ${error}`);
      }
    }

    return state;
  }

  /** Input handed to each agent; payloads come from earlier phases' artifacts. */
  /** The input for an agent, plus any decisions a person already made for its phase. */
  private buildInput(state: WorkflowState, agent: AgentName): Record<string, unknown> {
    const base = this.buildBaseInput(state, agent);
    const humanAnswers = answersFor(state.humanRequests, agent);
    const input = humanAnswers.length > 0 ? { ...base, humanAnswers } : base;
    // The context pack: fixed key order, and shortened only when over the agent's cap (prompt-budgets.json)
    const { context, meta } = packContext(input, contextBudget(agent));
    const note = describePack(agent, meta);
    if (note) {
      this.logger.warn(note);
      this.contextNotes.push(note);
    }
    return context;
  }

  private buildBaseInput(state: WorkflowState, agent: AgentName): Record<string, unknown> {
    const pm = this.getLatestArtifactByPhase(state, 'product-manager');
    const analyzer = this.getLatestArtifactByPhase(state, 'analyzer');
    const architect = this.getLatestArtifactByPhase(state, 'software-architect');
    const builders: AgentName[] = ['backend-engineer', 'frontend-engineer', 'infrastructure-engineer'];
    // Agents that plan or judge direction see the mission; builders work from the plan that already carries it
    const mission = state.mission ? { mission: missionForAgents(state.mission) } : {};
    // The interface is built, worded and judged against the declared look and feel
    const lookfeel = state.lookfeel ? { lookfeel: lookFeelForAgents(state.lookfeel) } : {};
    // ... and to the declared character, which shapes what the product does and says at moments like failure and refusal
    const character = state.character ? { character: characterForAgents(state.character) } : {};
    // ... and every agent that names things uses the project's shared vocabulary
    const language = state.language ? { language: languageForAgents(state.language) } : {};

    switch (agent) {
      case 'product-manager':
        return { brief: state.issueBrief, ...mission, ...language };
      case 'analyzer':
        return { brief: state.issueBrief, productManagerOutput: pm, ...mission, ...language };
      case 'software-architect':
        return { brief: state.issueBrief, productManagerOutput: pm, analyzerOutput: analyzer, ...mission, ...language };
      case 'backend-engineer':
        return { architectOutput: architect, analyzerOutput: analyzer, productManagerOutput: pm, ...language };
      case 'infrastructure-engineer':
        return { architectOutput: architect, analyzerOutput: analyzer, productManagerOutput: pm };
      case 'frontend-engineer':
        return { architectOutput: architect, analyzerOutput: analyzer, productManagerOutput: pm, ...character, ...lookfeel, ...language };
      case 'automation-tester':
        return {
          builderOutputs: this.getAllArtifactsByPhases(state, builders),
          architectOutput: architect,
          productManagerOutput: pm
        };
      case 'e2e-tester':
        return {
          builderOutputs: this.getAllArtifactsByPhases(state, builders),
          testerOutput: this.getLatestArtifactByPhase(state, 'automation-tester'),
          productManagerOutput: pm
        };
      case 'reviewer':
        return { allArtifacts: compactArtifacts(state.artifacts), planCheck: this.planCheck(state), ...this.languageCheck(state), ...mission, ...character, ...lookfeel, ...language };
      case 'customer-support':
        return { allArtifacts: compactArtifacts(state.artifacts), brief: state.issueBrief, ...character, ...lookfeel, ...language };
    }
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

  // Contract-conformant stub: every required payload key is present
  const payload = stubPayload(agentName, Object.keys(input));

  return {
    phase: agentName as Phase,
    valid: true,
    output: {
      agent: agentName,
      processedInputKeys: Object.keys(input)
    },
    artifacts: [
      {
        type: `${agentName}-output`,
        content: {
          agent: agentName,
          timestamp: new Date().toISOString(),
          inputKeys: Object.keys(input),
          ...payload
        }
      }
    ],
    ...payload
  } as AgentResponse;
}
