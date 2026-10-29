import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import type { LegacyOverview } from '../shared/inspector';

export function readLegacyStats(filename?: string): LegacyOverview {
  const note = 'Legacy Collector v1 statistics. Original presence, response identity and reconciliation are unavailable; these figures are not added to the canonical ledger.';
  if (!filename || !existsSync(filename)) return { available: false, devices: [], total: null, note };
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    const statement = db.prepare(`SELECT d.id,d.name,d.last_seen,COUNT(e.id) AS events,SUM(e.input) AS input,SUM(e.output) AS output,SUM(e.total) AS total
      FROM devices d LEFT JOIN events e ON e.device_id=d.id GROUP BY d.id,d.name,d.last_seen ORDER BY d.name`);
    statement.setReadBigInts(true);
    const devices = [...statement.iterate()].map(row => ({ id: String(row.id), name: String(row.name), lastSeen: row.last_seen === null ? null : String(row.last_seen),
      online: row.last_seen !== null && Date.now() - Date.parse(String(row.last_seen)) < 180000, events: Number(row.events),
      input: row.input === null ? null : String(row.input), output: row.output === null ? null : String(row.output), total: row.total === null ? null : String(row.total) }));
    const total = devices.some(d => d.total !== null) ? devices.reduce((sum, d) => sum + BigInt(d.total ?? '0'), 0n).toString() : null;
    return { available: true, devices, total, note };
  } finally { db.close(); }
}
