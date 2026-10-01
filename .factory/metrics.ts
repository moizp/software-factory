import * as fs from 'fs';
import * as path from 'path';
import { WorkflowState, Phase } from './state';

export interface WorkflowMetrics {
  workflowId: string;
  duration: number;
  status: string;
  completedPhases: number;
  totalPhases: number;
  startedAt: string;
  endedAt: string;
}

export interface PhaseStatusCount {
  phase: Phase;
  success: number;
  failure: number;
  total: number;
}

export interface MetricsSnapshot {
  timestamp: string;
  totalWorkflows: number;
  completedWorkflows: number;
  failedWorkflows: number;
  runningWorkflows: number;
  averageWorkflowDuration: number;
  phaseStatuses: PhaseStatusCount[];
  totalExecutionTime: number;
}

export class MetricsCollector {
  private workflowsDir: string;
  private metricsDir: string;
  private workflows: Map<string, WorkflowMetrics> = new Map();

  constructor(workflowsDir?: string, metricsDir?: string) {
    this.workflowsDir = workflowsDir || path.join(__dirname, '..', 'workflows');
    this.metricsDir = metricsDir || path.join(__dirname, '..', 'metrics');
    this.ensureMetricsDir();
  }

  private ensureMetricsDir(): void {
    if (!fs.existsSync(this.metricsDir)) {
      fs.mkdirSync(this.metricsDir, { recursive: true });
    }
  }

  private log(message: string): void {
    console.log(`[MetricsCollector] ${message}`);
  }

  async recordWorkflow(state: WorkflowState): Promise<void> {
    const startDate = new Date(state.startedAt);
    const endDate = new Date(state.updatedAt);
    const duration = (endDate.getTime() - startDate.getTime()) / 1000;

    const metrics: WorkflowMetrics = {
      workflowId: state.id,
      duration,
      status: state.status,
      completedPhases: state.phases.filter(p => p.valid).length,
      totalPhases: state.phases.length,
      startedAt: state.startedAt,
      endedAt: state.updatedAt
    };

    this.workflows.set(state.id, metrics);

    // Persist to file
    const filePath = path.join(this.metricsDir, `${state.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(metrics, null, 2));

    this.log(`Recorded metrics for workflow: ${state.id}`);
  }

  async getMetrics(): Promise<MetricsSnapshot> {
    const workflows = this.loadAllWorkflows();
    const snapshot = this.calculateSnapshot(workflows);
    return snapshot;
  }

  private calculateSnapshot(workflows: WorkflowMetrics[]): MetricsSnapshot {
    const completed = workflows.filter(w => w.status === 'completed').length;
    const failed = workflows.filter(w => w.status === 'failed').length;
    const running = workflows.filter(w => w.status === 'running').length;

    const totalDuration = workflows.reduce((sum, w) => sum + w.duration, 0);
    const avgDuration = workflows.length > 0 ? totalDuration / workflows.length : 0;

    // Simplified phase status counting
    const phaseStatuses: PhaseStatusCount[] = [];
    const phases: Phase[] = [
      'product-manager',
      'analyzer',
      'architect',
      'backend-builder',
      'frontend-builder',
      'infrastructure-builder',
      'backend-tester',
      'frontend-tester',
      'infrastructure-tester',
      'e2e-tester',
      'reviewer',
      'customer-support'
    ];

    for (const phase of phases) {
      const successCount = workflows.filter(w => w.completedPhases > phases.indexOf(phase)).length;
      const failureCount = workflows.filter(w => w.status === 'failed' && w.completedPhases <= phases.indexOf(phase)).length;

      phaseStatuses.push({
        phase,
        success: Math.max(0, successCount),
        failure: Math.max(0, failureCount),
        total: successCount + failureCount
      });
    }

    return {
      timestamp: new Date().toISOString(),
      totalWorkflows: workflows.length,
      completedWorkflows: completed,
      failedWorkflows: failed,
      runningWorkflows: running,
      averageWorkflowDuration: avgDuration,
      phaseStatuses: phaseStatuses.filter(p => p.total > 0),
      totalExecutionTime: totalDuration
    };
  }

  async exportMetrics(format: 'json' | 'prometheus' = 'json'): Promise<string> {
    const snapshot = await this.getMetrics();

    if (format === 'json') {
      return this.exportAsJson(snapshot);
    } else if (format === 'prometheus') {
      return this.exportAsPrometheus(snapshot);
    }

    return '';
  }

  private exportAsJson(snapshot: MetricsSnapshot): string {
    return JSON.stringify(snapshot, null, 2);
  }

  private exportAsPrometheus(snapshot: MetricsSnapshot): string {
    const lines: string[] = [
      '# HELP factory_total_workflows Total number of workflows',
      `# TYPE factory_total_workflows gauge`,
      `factory_total_workflows ${snapshot.totalWorkflows}`,
      '',
      '# HELP factory_completed_workflows Completed workflows',
      `# TYPE factory_completed_workflows gauge`,
      `factory_completed_workflows ${snapshot.completedWorkflows}`,
      '',
      '# HELP factory_failed_workflows Failed workflows',
      `# TYPE factory_failed_workflows gauge`,
      `factory_failed_workflows ${snapshot.failedWorkflows}`,
      '',
      '# HELP factory_running_workflows Running workflows',
      `# TYPE factory_running_workflows gauge`,
      `factory_running_workflows ${snapshot.runningWorkflows}`,
      '',
      '# HELP factory_average_workflow_duration Average workflow duration in seconds',
      `# TYPE factory_average_workflow_duration gauge`,
      `factory_average_workflow_duration ${snapshot.averageWorkflowDuration}`,
      '',
      '# HELP factory_total_execution_time Total execution time in seconds',
      `# TYPE factory_total_execution_time counter`,
      `factory_total_execution_time ${snapshot.totalExecutionTime}`
    ];

    return lines.join('\n');
  }

  private loadAllWorkflows(): WorkflowMetrics[] {
    const workflows: WorkflowMetrics[] = [];

    if (!fs.existsSync(this.metricsDir)) {
      return workflows;
    }

    const files = fs.readdirSync(this.metricsDir);

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      try {
        const filePath = path.join(this.metricsDir, file);
        const data = fs.readFileSync(filePath, 'utf-8');
        const metrics: WorkflowMetrics = JSON.parse(data);
        workflows.push(metrics);
      } catch (error) {
        this.log(`Error loading metrics ${file}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return workflows;
  }
}
