import { OracleState } from './types';

/** The Oracle VM sets the repository variable ORACLE_LAST_SEEN to the current UTC time every few minutes. */
export const ORACLE_ONLINE_WITHIN_MINUTES = 10;
/** Used when the variable is missing or unreadable: the runner is treated as long gone. */
export const NEVER_SEEN_MINUTES = 100_000;

export function oracleFromHeartbeat(lastSeen: string | null, now: Date): { state: OracleState; unavailableMinutes: number } {
  if (!lastSeen) return { state: 'offline', unavailableMinutes: NEVER_SEEN_MINUTES };
  const t = new Date(lastSeen).getTime();
  if (Number.isNaN(t)) return { state: 'offline', unavailableMinutes: NEVER_SEEN_MINUTES };
  const ageMin = Math.max(0, (now.getTime() - t) / 60_000);
  return ageMin <= ORACLE_ONLINE_WITHIN_MINUTES
    ? { state: 'online', unavailableMinutes: 0 }
    : { state: 'offline', unavailableMinutes: Math.floor(ageMin) };
}
