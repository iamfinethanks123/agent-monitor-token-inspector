import type { Metric } from './inspector';

export interface ManifestConsent { id: string; workspaceId: string; machineId: string; approvedAt: string; boundary: 'owned_client'; metadataOnly: true; }
export const CONTEXT_ORIGINS = ['user_instruction', 'project_file', 'external_document', 'command_output', 'agent_message', 'subagent_handoff', 'skill_definition', 'plugin_definition', 'visible_instruction', 'other', 'unknown'] as const;
export const CONTEXT_TRANSPORTS = ['user_message', 'tool_result', 'injected_context', 'summary', 'other', 'unknown'] as const;
export const CONTEXT_STATES = ['new', 'retained', 'summarized', 'truncated', 'removed', 'unknown'] as const;
export interface ContextFacets {
  origin: typeof CONTEXT_ORIGINS[number]; transport: typeof CONTEXT_TRANSPORTS[number]; state: typeof CONTEXT_STATES[number];
  media: 'text' | 'image' | 'audio' | 'other'; contentId: string | null; originalBytes: string | null;
  included: boolean; serializationIncluded: boolean | null;
}
export interface ContextItem {
  id: string; order: number; origin: 'instructions' | 'user' | 'history' | 'tool' | 'file' | 'other';
  bytes: string | null; estimate: { tokens: string; tokenizer: string; version: string } | null;
  operations: { kind: 'truncated' | 'summarized'; beforeBytes: string; afterBytes: string }[];
  facets?: ContextFacets;
}
export interface ContextManifest {
  schema: 'owned-context/1' | 'owned-context/2'; clientId: string; requestId: string; consentId: string;
  workspaceId: string; machineId: string; threadId: string; turnId: string | null;
  capturedAt: string; capture: 'client_visible_before_send'; items: ContextItem[];
  contextEpoch?: string | null;
}
export interface ContextResult {
  schema: 'owned-result/1'; clientId: string; requestId: string; consentId: string;
  completedAt: string; status: 'completed' | 'failed' | 'cancelled'; responseId: string | null;
}
export interface ManifestView {
  id: string; manifest: ContextManifest; result: ContextResult | null;
  linkage: 'matched' | 'pending' | 'failed' | 'cancelled' | 'usage_missing' | 'ambiguous' | 'conflicted';
  visibleEstimate: Metric; observedInput: Metric; discrepancy: string | null;
  ledgerEntryId: string | null; evidenceRefs: string[];
  knownTextEstimate: Metric; reconstructionState: 'complete_estimate' | 'partial' | 'mixed_tokenizers' | 'nontext_unestimated';
  categories: { origin: ContextFacets['origin']; items: number; bytes: string | null; estimate: Metric }[];
}
export interface ManifestsView {
  enabled: boolean; consent: ManifestConsent | null; items: ManifestView[]; nextCursor: string | null;
  revision: number; notes: string[];
}
