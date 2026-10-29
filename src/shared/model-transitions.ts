import type { InspectorQuery, LedgerEntry, ModelAttribution, TokenValues } from './inspector';
export interface ModelTransitionEndpoint {
  ledgerId: string; ledgerRevision: number; grain: LedgerEntry['grain']; timestamp: string | null;
  model: ModelAttribution; values: TokenValues; evidenceRef: string | null;
  usdUnits: string | null; usdUpperUnits: string | null; unpricedReason: string | null;
}
export interface ModelTransition {
  id: string; machineId: string; threadId: string | null; sourceId: string; generation: number;
  orderBasis: 'native_ordinal' | 'source_record'; beforePosition: string; afterPosition: string;
  kind: 'observed_model_change' | 'attribution_change' | 'configuration_change' | 'metadata_change';
  changedFields: (keyof Pick<ModelAttribution,'requestedModel'|'observedModel'|'providerRoute'|'serviceTier'|'quotaAlias'>)[];
  before: ModelTransitionEndpoint; after: ModelTransitionEndpoint; notes: string[];
}
export interface ModelTransitionsView {
  query: InspectorQuery; revision: number; privacyVersion: string; priceId: string | null;
  eligibleEntries: number; streams: number; changeCount: number; observedModelChanges: number; attributionChanges: number;
  unknownModelEntries: number; blockedPositions: number; ambiguousPositions: number;
  transitions: ModelTransition[]; limited: boolean; notes: string[];
}
