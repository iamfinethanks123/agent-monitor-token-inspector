import type { InspectorStore } from '../storage/InspectorStore';
import type { CollectorHealthSummary } from '../shared/collector-health';
import { dataQuality } from '../diagnostics/data-quality';
/** Sender-local aggregates only; no labels, paths, free text or token charging. */
export function collectorHealth(store:InspectorStore,discoveryErrors=0):CollectorHealthSummary {
  const view=dataQuality(store,{machineId:store.machineId});const sources=store.sources({machineId:store.machineId}).filter(source=>!store.excluded(source.id));
  return {schemaVersion:'collector-health/1',measuredAt:view.measuredAt,adapterVersion:'codex-passive/1',sourceCount:sources.length,partialSources:sources.filter(source=>source.state!=='current').length,discoveryErrors,
    records:view.counts.records,unsupportedRecords:view.counts.unsupported,gapRecords:view.counts.gaps,semanticIssueRecords:view.counts.semanticIssues,unparsedBytes:view.counts.skippedBytes,lastSuccessfulReceiptAt:view.counts.lastSuccessfulReceipt};
}
