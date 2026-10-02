import * as path from 'path';

/**
 * Runtime data lives under FACTORY_DATA_DIR when set (tests, CI), otherwise in the repo.
 * Evaluated lazily so the env var can be set after import.
 */
function root(): string {
  return process.env.FACTORY_DATA_DIR || path.join(__dirname, '..');
}

export const workflowsDir = (): string => path.join(root(), 'workflows');
export const logsDir = (): string => path.join(root(), 'logs');
export const metricsDir = (): string => path.join(root(), 'metrics');
export const snapshotsDir = (): string =>
  process.env.FACTORY_DATA_DIR
    ? path.join(root(), 'snapshots')
    : path.join(process.cwd(), '.factory', 'snapshots');
