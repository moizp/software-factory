import * as fs from 'fs';
import * as path from 'path';
import { WorkflowState, Phase } from './state';

export class RecoveryManager {
  private workflowsDir: string;

  constructor(workflowsDir?: string) {
    this.workflowsDir = workflowsDir || path.join(__dirname, '..', 'workflows');
  }

  private log(message: string): void {
    console.log(`[RecoveryManager] ${message}`);
  }

  async detectIncomplete(): Promise<WorkflowState[]> {
    const incomplete: WorkflowState[] = [];

    if (!fs.existsSync(this.workflowsDir)) {
      return incomplete;
    }

    const files = fs.readdirSync(this.workflowsDir);

    for (const file of files) {
      if (!file.endsWith('.json') || file === 'archived') continue;

      try {
        const filePath = path.join(this.workflowsDir, file);
        const data = fs.readFileSync(filePath, 'utf-8');
        const state: WorkflowState = JSON.parse(data);

        if (state.status === 'running' || state.status === 'paused') {
          incomplete.push(state);
          this.log(`Found incomplete workflow: ${state.id} (status: ${state.status})`);
        }
      } catch (error) {
        this.log(`Error reading workflow file ${file}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return incomplete;
  }

  async resumeWorkflow(workflowId: string): Promise<WorkflowState | null> {
    const filePath = path.join(this.workflowsDir, `${workflowId}.json`);

    if (!fs.existsSync(filePath)) {
      this.log(`Workflow file not found: ${workflowId}`);
      return null;
    }

    try {
      const data = fs.readFileSync(filePath, 'utf-8');
      const state: WorkflowState = JSON.parse(data);

      if (state.status === 'paused' || state.status === 'running') {
        state.status = 'running';
        state.updatedAt = new Date().toISOString();

        // Find the last completed phase and resume from next
        let resumePhase = state.currentPhase;
        for (let i = state.phases.length - 1; i >= 0; i--) {
          if (state.phases[i].valid) {
            resumePhase = this.getNextPhase(state.phases[i].phase);
            break;
          }
        }

        state.currentPhase = resumePhase;
        fs.writeFileSync(filePath, JSON.stringify(state, null, 2));

        this.log(`Resumed workflow ${workflowId} from phase: ${resumePhase}`);
        return state;
      }

      this.log(`Workflow ${workflowId} is not in a recoverable state`);
      return null;
    } catch (error) {
      this.log(`Error resuming workflow: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  async recoverState(): Promise<{ recovered: number; failed: number }> {
    const incomplete = await this.detectIncomplete();
    let recovered = 0;
    let failed = 0;

    for (const workflow of incomplete) {
      const result = await this.resumeWorkflow(workflow.id);
      if (result) {
        recovered++;
      } else {
        failed++;
      }
    }

    this.log(`Recovery complete: ${recovered} recovered, ${failed} failed`);
    return { recovered, failed };
  }

  private getNextPhase(currentPhase: Phase): Phase {
    const phaseOrder: Phase[] = [
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
      'customer-support',
      'completed'
    ];

    const currentIndex = phaseOrder.indexOf(currentPhase);
    if (currentIndex === -1 || currentIndex === phaseOrder.length - 1) {
      return 'completed';
    }

    return phaseOrder[currentIndex + 1];
  }
}
