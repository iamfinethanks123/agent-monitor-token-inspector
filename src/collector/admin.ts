import { writeFileSync } from 'node:fs';
import { InspectorStore } from '../storage/InspectorStore';
import { MetadataReceiver } from '../transport/MetadataReceiver';
import { protectedEndpoint } from '../transport/protocol';

// Local, owner-operated enrollment; never an HTTP or renderer filesystem API.
const [mode, database, name, output, endpoint, deviceId] = process.argv.slice(2);
if (mode !== 'enroll' || !database || !name || !output) throw new Error('USAGE_ADMIN_ENROLL');
const store = new InspectorStore(database);
try {
  const config = new MetadataReceiver(store).enroll(name, deviceId);
  config.endpoint = protectedEndpoint(endpoint ?? 'http://127.0.0.1:9897');
  writeFileSync(output, JSON.stringify(config, null, 2), { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ saved: true, deviceId: config.deviceId }));
} finally { store.close(); }
