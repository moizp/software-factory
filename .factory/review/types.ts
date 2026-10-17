export type Tier = 'R0' | 'R1' | 'R2' | 'R3';
export type Severity = 'blocker' | 'major' | 'minor';
export type Confidence = 'low' | 'medium' | 'high';
export type Verdict = 'approve' | 'request_changes' | 'block';
/** complete: every lens ran. degraded: a lens failed. failed_closed: no usable review, a human decides. */
export type ReviewStatus = 'complete' | 'degraded' | 'failed_closed';

export interface Finding {
  severity: Severity;
  category: string;
  file: string;
  line: number;
  evidence_quote: string;
  explanation: string;
  suggested_fix: string;
  confidence: Confidence;
  lens?: string;
}

/** What one model call returns for one lens. */
export interface LensOutput {
  verdict: Verdict;
  risk_assessment: string;
  claims_check: Array<{ claim: string; supported: boolean; evidence: string }>;
  findings: Finding[];
  needs_context: string[];
}

export interface RunnerUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
}

export interface RunnerRequest {
  model: string;
  /** Omitted for models without an effort setting (Haiku 4.5). */
  effort?: 'low' | 'medium' | 'high';
  system: string;
  prompt: string;
}

export interface RunnerResponse {
  text: string;
  usage: RunnerUsage;
}

/** One interface, two implementations: `cli` (personal account) and `api` (key). */
export interface Runner {
  readonly kind: 'cli' | 'api';
  run(req: RunnerRequest): Promise<RunnerResponse>;
}

/** The hand-off the writer reads (see .claude/skills/review-loop.md). */
export interface ReviewResult {
  pr: number;
  head_sha: string;
  attempt: number;
  status: ReviewStatus;
  verdict: Verdict;
  tier: Tier;
  tier_reasons: string[];
  runner: 'cli' | 'api' | 'none';
  models: string[];
  findings: Finding[];
  dropped_ungrounded: number;
  claims_check: LensOutput['claims_check'];
  needs_context: string[];
  usage: RunnerUsage;
  /** Why the review failed closed or degraded; empty when complete. */
  notes: string[];
}
