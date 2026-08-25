import { readFileSync } from 'node:fs';
import { zUlid } from '@eduscope/shared';
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db/client.js';
import { devices } from '../src/db/schema.js';
import { hashDeviceCredential } from '../src/device/credentials.js';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i];
  const value = process.argv[i + 1];
  if (!key?.startsWith('--') || value === undefined) throw new Error('flags must be --name value pairs');
  args.set(key.slice(2), value);
}
const deviceId = zUlid.parse(args.get('device-id'));
const hallDisplayName = args.get('hall-display-name')?.trim();
if (!hallDisplayName || hallDisplayName.length > 128) throw new Error('invalid hall display name');
const bearer = readFileSync(0, 'utf8').trim();
if (bearer.length < 32) throw new Error('device bearer must contain at least 32 characters');

const config = loadConfig(process.env);
const database = openDatabase(config.databaseUrl);
try {
  const credentialHash = await hashDeviceCredential(bearer);
  const createdAt = new Date();
  await database.db.insert(devices).values({ deviceId, credentialHash, hallDisplayName, enabled: true, createdAt })
    .onConflictDoUpdate({ target: devices.deviceId, set: { credentialHash, hallDisplayName, enabled: true } });
  process.stdout.write(`${deviceId}\n`);
} finally {
  await database.close();
}
