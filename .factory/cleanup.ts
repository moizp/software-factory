import * as fs from 'fs';
import * as path from 'path';
import { WorkflowState } from './state';

export class CleanupManager {
  private workflowsDir: string;
  private retentionDays: number;

  constructor(workflowsDir?: string, retentionDays: number = 30) {
    this.workflowsDir = workflowsDir || path.join(__dirname, '..', 'workflows');
    this.retentionDays = retentionDays;
  }

  private log(message: string): void {
    console.log(`[CleanupManager] ${message}`);
  }

  async archiveOldWorkflows(): Promise<{ archived: number; errors: string[] }> {
    const errors: string[] = [];
    let archived = 0;

    if (!fs.existsSync(this.workflowsDir)) {
      this.log('Workflows directory not found');
      return { archived: 0, errors };
    }

    const files = fs.readdirSync(this.workflowsDir);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.retentionDays);

    const archiveDir = path.join(this.workflowsDir, 'archived');
    if (!fs.existsSync(archiveDir)) {
      fs.mkdirSync(archiveDir, { recursive: true });
    }

    for (const file of files) {
      if (file === 'archived') continue;

      const filePath = path.join(this.workflowsDir, file);
      const stats = fs.statSync(filePath);

      if (stats.mtime < cutoffDate) {
        try {
          const archivePath = path.join(archiveDir, file);
          fs.copyFileSync(filePath, archivePath);
          fs.unlinkSync(filePath);
          archived++;
          this.log(`Archived workflow: ${file}`);
        } catch (error) {
          errors.push(`Failed to archive ${file}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    return { archived, errors };
  }

  async compressStateFile(workflowId: string): Promise<boolean> {
    const filePath = path.join(this.workflowsDir, `${workflowId}.json`);

    if (!fs.existsSync(filePath)) {
      this.log(`Workflow file not found: ${workflowId}`);
      return false;
    }

    try {
      const data = fs.readFileSync(filePath, 'utf-8');
      const state: WorkflowState = JSON.parse(data);

      // Remove old artifacts (keep last 5)
      if (state.artifacts.length > 5) {
        state.artifacts = state.artifacts.slice(-5);
      }

      // Remove verbose notes older than 7 days
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      state.notes = state.notes.filter(note => {
        try {
          const noteDate = new Date(note.split('|')[0]);
          return noteDate > sevenDaysAgo;
        } catch {
          return true;
        }
      });

      fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
      this.log(`Compressed state file: ${workflowId}`);
      return true;
    } catch (error) {
      this.log(`Failed to compress state: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  async enforceRetention(): Promise<{ compressed: number; archived: number; errors: string[] }> {
    const errors: string[] = [];
    let compressed = 0;
    let archived = 0;

    if (!fs.existsSync(this.workflowsDir)) {
      return { compressed: 0, archived: 0, errors };
    }

    // First archive old workflows
    const archiveResult = await this.archiveOldWorkflows();
    archived = archiveResult.archived;
    errors.push(...archiveResult.errors);

    // Then compress remaining workflows
    const files = fs.readdirSync(this.workflowsDir);
    for (const file of files) {
      if (file === 'archived' || !file.endsWith('.json')) continue;

      const workflowId = file.replace('.json', '');
      const success = await this.compressStateFile(workflowId);
      if (success) {
        compressed++;
      }
    }

    this.log(`Retention enforcement complete: ${compressed} compressed, ${archived} archived`);
    return { compressed, archived, errors };
  }
}
