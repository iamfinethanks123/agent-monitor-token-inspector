export interface DetectorConfusion { truePositive: number; falsePositive: number; falseNegative: number; trueNegative: number; unscored: number; precision: number | null; recall: number | null; }
export interface DetectorCaseResult { id: string; detectorId: string; expectedPattern: boolean | null; expectedCandidate: boolean | null; observedPattern: boolean; observedCandidate: boolean; emittedFindings: number; detectorVersions: string[]; suppressedFindings: number; rationale: string; }
export interface DetectorEvaluation { schemaVersion: 'detector-evaluation/1'; state: 'measured' | 'unmeasured'; corpusId: string; sourceDigest: string; corpusDigest: string; measuredAt: string | null; reviewedAt: string; reviewedBy: string; labelingPolicy: string; caseCount: number; unit: 'case_target_detector'; synthetic: true; pattern: DetectorConfusion; candidate: DetectorConfusion; detectors: { id: string; cases: number; versions: string[]; pattern: DetectorConfusion; candidate: DetectorConfusion }[]; cases: DetectorCaseResult[]; }
export function detectorConfusion(cases: DetectorCaseResult[], level: 'pattern' | 'candidate'): DetectorConfusion {
  const counts = {truePositive:0,falsePositive:0,falseNegative:0,trueNegative:0,unscored:0};
  for (const item of cases) { const expected = level === 'pattern' ? item.expectedPattern : item.expectedCandidate, actual = level === 'pattern' ? item.observedPattern : item.observedCandidate;
    if (expected === null) counts.unscored++; else if (expected && actual) counts.truePositive++; else if (actual) counts.falsePositive++; else if (expected) counts.falseNegative++; else counts.trueNegative++;
  }
  return {...counts,precision:counts.truePositive+counts.falsePositive?counts.truePositive/(counts.truePositive+counts.falsePositive):null,recall:counts.truePositive+counts.falseNegative?counts.truePositive/(counts.truePositive+counts.falseNegative):null};
}
