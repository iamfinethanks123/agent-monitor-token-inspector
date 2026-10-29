/** Mutually exclusive metadata categories; an error tool result occupies the error lane. */
export function timelineLaneSql(alias: string): string {
  return `CASE WHEN ${alias}.kind LIKE 'gap/%' THEN 'gaps'
    WHEN ${alias}.kind IN ('compacted','event_msg/context_compacted') OR instr(${alias}.search_metadata,'codex-compaction/1')>0 THEN 'compaction'
    WHEN ${alias}.kind LIKE '%error%' OR instr(${alias}.search_metadata,'timeline-error/1')>0 THEN 'errors'
    WHEN ${alias}.kind IN ('token_usage_record','event_msg/token_count') THEN 'usage'
    WHEN ${alias}.call_id IS NOT NULL OR ${alias}.tool_name IS NOT NULL THEN 'tools'
    WHEN ${alias}.kind LIKE '%message%' OR ${alias}.kind='inter_agent_communication_metadata' THEN 'messages'
    ELSE 'other' END`;
}
