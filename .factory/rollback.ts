import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { WorkflowState } from './state';
import { snapshotsDir as defaultSnapshotsDir } from './paths';

const execAsync = promisify(exec);

interface Snapshot {
  workflowId: string;
  phase: string;
  timestamp: string;
  gitCommit: string;
  gitBranch: string;
  stateSnapshot: WorkflowState;
}

export class RollbackManager {
  private snapshotsDir: string;

  constructor(snapshotsDir: string = defaultSnapshotsDir()) {
    this.snapshotsDir = snapshotsDir;
    this.ensureSnapshotsDir();
  }

  private ensureSnapshotsDir(): void {
    if (!fs.existsSync(this.snapshotsDir)) {
      fs.mkdirSync(this.snapshotsDir, { recursive: true });
    }
  }

  async saveSnapshot(state: WorkflowState, phase: string): Promise<string> {
    const gitCommit = await this.getCurrentCommit();
    const gitBranch = await this.getCurrentBranch();

    const snapshot: Snapshot = {
      workflowId: state.id,
      phase,
      timestamp: new Date().toISOString(),
      gitCommit,
      gitBranch,
      stateSnapshot: state
    };

    const snapshotFile = path.join(
      this.snapshotsDir,
      `${state.id}-${phase}-${Date.now()}.json`
    );

    fs.writeFileSync(snapshotFile, JSON.stringify(snapshot, null, 2));
    return snapshotFile;
  }

  async rollbackToSnapshot(workflowId: string, snapshotFile?: string): Promise<void> {
    let snapshot: Snapshot;

    if (snapshotFile && fs.existsSync(snapshotFile)) {
      snapshot = JSON.parse(fs.readFileSync(snapshotFile, 'utf-8')) as Snapshot;
    } else {
      // Find latest snapshot for this workflow
      const snapshots = fs
        .readdirSync(this.snapshotsDir)
        .filter(f => f.startsWith(workflowId))
        .sort()
        .reverse();

      if (snapshots.length === 0) {
        throw new Error(`No snapshots found for workflow ${workflowId}`);
      }

      const latestSnapshot = snapshots[0];
      const latestPath = path.join(this.snapshotsDir, latestSnapshot);
      snapshot = JSON.parse(fs.readFileSync(latestPath, 'utf-8')) as Snapshot;
    }

    // Restore git state
    try {
      await execAsync(`git checkout ${snapshot.gitCommit}`, { cwd: process.cwd() });
      await execAsync(`git clean -fd`, { cwd: process.cwd() });
    } catch (error) {
      throw new Error(`Failed to restore git state: ${error}`);
    }
  }

  async getCurrentCommit(): Promise<string> {
    try {
      const { stdout } = await execAsync('git rev-parse HEAD', { cwd: process.cwd() });
      return stdout.trim();
    } catch {
      return 'unknown';
    }
  }

  async getCurrentBranch(): Promise<string> {
    try {
      const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: process.cwd() });
      return stdout.trim();
    } catch {
      return 'unknown';
    }
  }

  cleanupOldSnapshots(workflowId: string, keepCount: number = 5): void {
    const snapshots = fs
      .readdirSync(this.snapshotsDir)
      .filter(f => f.startsWith(workflowId))
      .sort()
      .reverse();

    if (snapshots.length > keepCount) {
      const toRemove = snapshots.slice(keepCount);
      for (const file of toRemove) {
        const filePath = path.join(this.snapshotsDir, file);
        fs.unlinkSync(filePath);
      }
    }
  }

  getSnapshots(workflowId?: string): Snapshot[] {
    const files = fs.readdirSync(this.snapshotsDir);
    const filtered = workflowId
      ? files.filter(f => f.startsWith(workflowId))
      : files;

    return filtered
      .map(file => {
        const filePath = path.join(this.snapshotsDir, file);
        return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Snapshot;
      })
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }
}
