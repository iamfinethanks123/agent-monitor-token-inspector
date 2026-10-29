import type { InspectorQuery, Metric } from './inspector';
import type { ContextFacets, ManifestsView } from './context-manifests';

export interface ContextOccurrence {
  id: string; sourceId: string; machineId: string; threadId: string | null; timestamp: string | null;
  origin: ContextFacets['origin']; transport: ContextFacets['transport']; state: ContextFacets['state']; contextEpoch: string;
  bytes: string | null; originalBytes: Metric; estimate: Metric; requestExposure: Metric; evidenceRefs: string[];
  toolName: string | null; definition: string | null; classification: 'adapter' | 'parsed_path' | 'unknown';
  nonTextParts: { image: number; audio: number; other: number };
}
export interface ContextAttributionView {
  revision: number; privacyVersion: string; providerInput: Metric; passiveOccurrences: number;
  passive: { origin: ContextFacets['origin']; occurrences: number; bytes: string | null; unknownEstimates: number; estimate: Metric }[];
  items: ContextOccurrence[]; nextCursor: string | null;
  requests: ManifestsView; lineage: { clientId: string; contentId: string; requests: number; occurrences: number; estimate: Metric; evidence: 'client_declared_lineage' }[];
  notes: string[];
}
export interface ContextAttributionRequest { query?: InspectorQuery; origin?: ContextFacets['origin']; }
