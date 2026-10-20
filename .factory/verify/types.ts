export type Status = 'pass' | 'warn' | 'fail' | 'skip';
export type Tier = 'env' | 'offline' | 'mock' | 'live' | 'github';

export interface Result {
  status: Status;
  /** One line for the table. */
  detail: string;
  /** Longer output, shown in the report for anything that is not a pass. */
  extra?: string;
  /** What to do about it, as a command or a sentence. */
  next?: string;
}

export interface Flags {
  /** Skip the factory's own unit tests (a few minutes). */
  quick: boolean;
  /** `requirements` runs the product manager once; `plan` runs through the architect. Both spend tokens. */
  live: false | 'requirements' | 'plan';
  /** Read-only checks of the GitHub repository through `gh`. */
  github: boolean;
  /** Summarise one issue's run (labels, comments, workflow runs). */
  issue?: number;
  /** Create the labels the lanes need when they are missing. */
  createLabels: boolean;
  /** The brief for the live run. */
  brief: string;
  /** Token cap for a live run. */
  tokenCap: number;
}

export interface Ctx {
  /** Where the factory's own code lives. */
  factoryRoot: string;
  /** The project being verified (its declarations, policy, wiki). */
  projectDir: string;
  flags: Flags;
}

export interface Check {
  id: string;
  tier: Tier;
  title: string;
  run(ctx: Ctx): Promise<Result> | Result;
}

export interface Row extends Result {
  id: string;
  tier: Tier;
  title: string;
  ms: number;
}

export const pass = (detail: string, extra?: string): Result => ({ status: 'pass', detail, ...(extra ? { extra } : {}) });
export const warn = (detail: string, extra?: string, next?: string): Result => ({ status: 'warn', detail, ...(extra ? { extra } : {}), ...(next ? { next } : {}) });
export const fail = (detail: string, extra?: string, next?: string): Result => ({ status: 'fail', detail, ...(extra ? { extra } : {}), ...(next ? { next } : {}) });
export const skip = (detail: string, next?: string): Result => ({ status: 'skip', detail, ...(next ? { next } : {}) });
