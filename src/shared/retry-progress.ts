import type { Metric } from './inspector';

export interface RetryAttempt {
  callId: string; startedAt: string | null; completedAt: string | null; exitCode: string | null;
  outcome: 'failed' | 'command_succeeded' | 'running' | 'unknown'; polls: number; evidenceRefs: string[];
  firstSequence: number | null; lastSequence: number | null;
}
export interface RetryEpisode {
  id: string; sourceId: string; machineId: string; threadId: string | null; generation: number; contextEpoch: string;
  startedAt: string | null; latestAt: string | null; status: 'recurring_failure' | 'failure_changed' | 'edit_then_retry' | 'command_succeeded' | 'running' | 'unknown';
  attempts: RetryAttempt[]; attemptCount: number; failures: number; consecutiveFailures: number; peakComparableFailures: number; edits: number; failureChanges: number; polls: number;
  evidenceRefs: string[]; successEvidenceRef: string | null; associatedUsage: Metric; avoidableUsage: Metric;
  notes: string[];
}
export interface RetryProgressView { episodes: RetryEpisode[]; totalEpisodes: number; unlinkedPolls: number; notes: string[]; }
