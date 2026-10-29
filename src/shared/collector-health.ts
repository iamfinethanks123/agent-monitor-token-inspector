export interface CollectorHealthSummary {
  schemaVersion:'collector-health/1'; measuredAt:string; adapterVersion:'codex-passive/1'; sourceCount:number; partialSources:number; discoveryErrors:number;
  records:number; unsupportedRecords:number; gapRecords:number; semanticIssueRecords:number; unparsedBytes:string; lastSuccessfulReceiptAt:string|null;
}
export interface CollectorHealthSnapshot { receivedAt:string; summary:CollectorHealthSummary; provenance:'client_reported'; }
