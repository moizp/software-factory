import { Board, WipCounts } from '../board';
import type { Declaration, MissionGate } from '../mission';

/** short: hosted Actions. long: Oracle self-hosted runner. burst: Buddy.works overflow. */
export type Lane = 'short' | 'long' | 'burst';
/** What a ledger entry can be charged to: a lane, or the router job itself (hosted Actions). */
export type Charge = Lane | 'route';

export type OracleState = 'online' | 'busy' | 'offline';
export type Permission = 'admin' | 'maintain' | 'write' | 'triage' | 'read' | 'none';

export interface Budget {
  actionsMonthlyMinutes: number;
  /** Ratio of the Actions pool at which short jobs move to the long lane. */
  actionsSoftRatio: number;
  buddyEnabled: boolean;
  buddyMonthlyGbMinutes: number;
  /** Ratio of the Buddy pool above which burst is no longer chosen. */
  buddySoftRatio: number;
  /** Memory of the Buddy runner; GB-minutes are charged as minutes times this. Unverified, set it from the account. */
  buddyRunnerGb: number;
  /** Minutes the Oracle runner may be busy or offline before burst is considered. */
  oracleGraceMinutes: number;
}

export const DEFAULT_BUDGET: Budget = {
  actionsMonthlyMinutes: 2000,
  actionsSoftRatio: 0.8,
  buddyEnabled: false,
  buddyMonthlyGbMinutes: 300,
  buddySoftRatio: 0.9,
  buddyRunnerGb: 4,
  oracleGraceMinutes: 15
};

export interface Ledger {
  /** UTC month this ledger covers, `YYYY-MM`. */
  month: string;
  actionsMinutes: number;
  buddyGbMinutes: number;
  oracleSeconds: number;
}

export interface RouteInput {
  /** False when the AGENTS_ENABLED kill switch is off. */
  enabled: boolean;
  sender: { login: string; permission: Permission };
  issue: {
    number: number;
    labels: string[];
    estimateMinutes?: number;
    /** What the issue text says about the mission (Serves: and Mission exception: lines). */
    declaration?: Declaration;
  };
  /** The project's mission as the router sees it. Absent means the check is not made. */
  mission?: MissionGate;
  oracle: { state: OracleState; unavailableMinutes: number };
  /** Null when the ledger could not be read: treated as an exhausted hosted pool (fail closed). */
  ledger: Ledger | null;
  budget: Budget;
  board: Board;
  wip: WipCounts;
  now: Date;
}

export type RouteDecision =
  | {
      action: 'start';
      lane: Lane;
      reasons: string[];
      concurrencyGroup: string;
      addLabels: string[];
      removeLabels: string[];
    }
  | { action: 'wait'; reasons: string[] }
  | { action: 'ignore'; reasons: string[] };
