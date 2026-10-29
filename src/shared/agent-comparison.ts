import type { FindingView, InspectorQuery, Metric } from './inspector';

export type AgentPurpose = 'implementation' | 'review' | 'independent_test' | 'research' | 'parallel_exploration' | 'shared_startup';
export interface ComparisonAgent {
  id: string; machineId: string; threadId: string; rootThreadId: string | null;
  parentThreadId: string | null; forkedFromId: string | null; relationship: 'parent_link' | 'fork' | 'unlinked' | 'conflicted';
  purpose: AgentPurpose | null; purposeOrigin: 'user_annotation' | 'derived_declared_role' | 'unknown';
  invocations: number; fingerprintedOutputs: number; selectedEntries: number; missingUsage: number; exclusiveUsage: Metric;
}
export interface ComparisonInvocation {
  id: string; agentId: string; name: string; operation: string; startedAt: string | null; completedAt: string | null;
  status: 'completed' | 'failed' | 'running' | 'unknown' | 'conflicted'; outputBytes: string | null;
  evidenceRefs: string[]; sharedGroupIds: string[];
}
export interface SharedOperationGroup {
  id: string; agents: string[]; agentCount: number; invocations: number; outputBytes: string;
  completeCapture: boolean; commonTarget: boolean | null; overlapMs: number | null;
  classification: 'declared_review' | 'declared_parallel' | 'shared_startup' | 'possible_overlap';
  evidenceRefs: string[]; associatedUsage: Metric; avoidableUsage: Metric; annotation: FindingView['annotation'];
}
export interface AgentComparisonView {
  revision: number; privacyVersion: string; agents: ComparisonAgent[]; leftAgentId: string | null; rightAgentId: string | null;
  left: ComparisonInvocation[]; right: ComparisonInvocation[]; shared: SharedOperationGroup[];
  associatedUnionUsage: Metric;
  mirroredInvocations: number; conflictedInvocations: number; limited: boolean;
  handoffs: { timestamp: string | null; threadId: string | null; evidenceRef: string }[]; notes: string[];
}
export interface AgentComparisonRequest { query?: InspectorQuery; leftAgentId?: string; rightAgentId?: string; focusGroupId?: string; }
