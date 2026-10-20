import { spawnSync } from 'child_process';

export interface Exec {
  code: number | null;
  stdout: string;
  stderr: string;
  /** The command is not installed. */
  missing: boolean;
  timedOut: boolean;
  ms: number;
}

export function exec(cmd: string, args: string[], opts: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}): Exec {
  const started = Date.now();
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    encoding: 'utf-8',
    timeout: opts.timeoutMs ?? 120_000,
    maxBuffer: 32 * 1024 * 1024
  });
  const code = (r.error as NodeJS.ErrnoException | undefined)?.code;
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', missing: code === 'ENOENT', timedOut: code === 'ETIMEDOUT', ms: Date.now() - started };
}

/** The last lines of some output, for a report. */
export const tail = (text: string, lines = 40): string => text.trimEnd().split('\n').slice(-lines).join('\n');

export const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;
