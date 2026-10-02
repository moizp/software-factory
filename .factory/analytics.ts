import * as fs from 'fs';
import * as path from 'path';
import { WorkflowState, Phase } from './state';
import { PHASE_ORDER } from './pipeline';
import { workflowsDir as defaultWorkflowsDir } from './paths';

export interface PhaseMetrics {
  phase: Phase;
  count: number;
  totalDuration: number;
  averageDuration: number;
  successCount: number;
  failureCount: number;
  successRate: number;
}

export interface AnalyticsReport {
  generatedAt: string;
  totalWorkflows: number;
  completedWorkflows: number;
  failedWorkflows: number;
  runningWorkflows: number;
  totalDuration: number;
  averageDuration: number;
  phaseMetrics: PhaseMetrics[];
}

export class AnalyticsCollector {
  private workflowsDir: string;
  private phaseTimings: Map<Phase, number[]> = new Map();
  private agentSuccess: Map<Phase, { success: number; failure: number }> = new Map();

  constructor(workflowsDir?: string) {
    this.workflowsDir = workflowsDir || defaultWorkflowsDir();
  }

  private log(message: string): void {
    console.log(`[AnalyticsCollector] ${message}`);
  }

  async trackPhase(phase: Phase, duration: number): Promise<void> {
    if (!this.phaseTimings.has(phase)) {
      this.phaseTimings.set(phase, []);
    }
    this.phaseTimings.get(phase)!.push(duration);
  }

  async reportSuccess(agent: Phase): Promise<void> {
    if (!this.agentSuccess.has(agent)) {
      this.agentSuccess.set(agent, { success: 0, failure: 0 });
    }
    this.agentSuccess.get(agent)!.success++;
  }

  async reportFailure(agent: Phase): Promise<void> {
    if (!this.agentSuccess.has(agent)) {
      this.agentSuccess.set(agent, { success: 0, failure: 0 });
    }
    this.agentSuccess.get(agent)!.failure++;
  }

  private calculateMetricsForPhase(phase: Phase): PhaseMetrics {
    const timings = this.phaseTimings.get(phase) || [];
    const success = this.agentSuccess.get(phase)?.success || 0;
    const failure = this.agentSuccess.get(phase)?.failure || 0;
    const total = success + failure;

    const totalDuration = timings.reduce((sum, t) => sum + t, 0);
    const averageDuration = timings.length > 0 ? totalDuration / timings.length : 0;
    const successRate = total > 0 ? (success / total) * 100 : 0;

    return {
      phase,
      count: total,
      totalDuration,
      averageDuration,
      successCount: success,
      failureCount: failure,
      successRate: Math.round(successRate * 100) / 100
    };
  }

  async generateReport(): Promise<AnalyticsReport> {
    const workflows = this.loadAllWorkflows();

    let completedCount = 0;
    let failedCount = 0;
    let runningCount = 0;
    let totalDuration = 0;

    for (const workflow of workflows) {
      if (workflow.status === 'completed') completedCount++;
      else if (workflow.status === 'failed') failedCount++;
      else if (workflow.status === 'running') runningCount++;

      const startDate = new Date(workflow.startedAt);
      const endDate = new Date(workflow.updatedAt);
      const duration = (endDate.getTime() - startDate.getTime()) / 1000;
      totalDuration += duration;
    }

    const phaseMetrics: PhaseMetrics[] = [];
    const allPhases: Phase[] = [...PHASE_ORDER];

    for (const phase of allPhases) {
      const metrics = this.calculateMetricsForPhase(phase);
      if (metrics.count > 0) {
        phaseMetrics.push(metrics);
      }
    }

    const report: AnalyticsReport = {
      generatedAt: new Date().toISOString(),
      totalWorkflows: workflows.length,
      completedWorkflows: completedCount,
      failedWorkflows: failedCount,
      runningWorkflows: runningCount,
      totalDuration,
      averageDuration: workflows.length > 0 ? totalDuration / workflows.length : 0,
      phaseMetrics: phaseMetrics.sort((a, b) => b.count - a.count)
    };

    this.log('Analytics report generated');
    return report;
  }

  private loadAllWorkflows(): WorkflowState[] {
    const workflows: WorkflowState[] = [];

    if (!fs.existsSync(this.workflowsDir)) {
      return workflows;
    }

    const files = fs.readdirSync(this.workflowsDir);

    for (const file of files) {
      if (!file.endsWith('.json') || file === 'archived') continue;

      try {
        const filePath = path.join(this.workflowsDir, file);
        const data = fs.readFileSync(filePath, 'utf-8');
        const state: WorkflowState = JSON.parse(data);
        workflows.push(state);
      } catch (error) {
        this.log(`Error loading workflow ${file}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return workflows;
  }
}
