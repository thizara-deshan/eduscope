import { describe, expect, it } from 'vitest';
import {
  PANEL_OPERATION_IDS,
  zAiCountdownSnapshot, zAudioControl, zChannelConfig, zChannelStatus, zDeviceHealth,
  zDeviceProvisioning, zLoginResponse, zRecordingStateSnapshot, zSourceStatus,
  zStorageOverview, zUser,
} from '@eduscope/shared';
import { createMockClient } from '../../src/mock/create-mock-client.js';

const client = createMockClient('happy');

/** One entry per operation whose response has a single named schema. */
const READ_CONTRACTS = [
  ['getMe', () => client.getMe(), zUser],
  ['getRecordingState', () => client.getRecordingState(), zRecordingStateSnapshot],
  ['getProvisioning', () => client.getProvisioning(), zDeviceProvisioning],
  ['getDeviceHealth', () => client.getDeviceHealth(), zDeviceHealth],
  ['getStorageOverview', () => client.getStorageOverview(), zStorageOverview],
  ['getAiCountdown', () => client.getAiCountdown(), zAiCountdownSnapshot],
] as const;

describe('contract honesty — every mock response validates', () => {
  it.each(READ_CONTRACTS)('%s returns a schema-valid body', async (_n, call, schema) => {
    const body = await call();
    expect(() => schema.parse(body)).not.toThrow();
  });

  it('login returns a schema-valid LoginResponse', async () => {
    const body = await client.login({
      username: 'a.perera',
      password: 'correct-horse',
      client: 'panel',
    });
    expect(() => zLoginResponse.parse(body)).not.toThrow();
  });

  it.each([
    ['getSourcesStatus', () => client.getSourcesStatus(), zSourceStatus],
    ['listAudioControls', () => client.listAudioControls(), zAudioControl],
  ] as const)('%s returns schema-valid items', async (_n, call, item) => {
    const rows = await call();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(() => item.parse(row)).not.toThrow();
  });

  it('listChannels returns schema-valid { config, status } rows', async () => {
    const rows = await client.listChannels();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(() => zChannelConfig.parse(row.config)).not.toThrow();
      expect(() => zChannelStatus.parse(row.status)).not.toThrow();
    }
  });

  it('cursor lists return the { items, nextCursor } envelope', async () => {
    const page = await client.listRecordings();
    expect(page).toHaveProperty('items');
    expect(page).toHaveProperty('nextCursor');
    expect(Array.isArray(page.items)).toBe(true);
  });

  it('every 202 command resolves to a CommandAccepted with a resolve deadline', async () => {
    const accepted = await client.startRecording();
    expect(accepted.commandId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(accepted.resolveBySec).toBe(10); // T-CMD-RESOLVE
  });

  it('implements every panel operation — no method is missing at runtime', () => {
    const c = client as unknown as Record<string, unknown>;
    const missing = PANEL_OPERATION_IDS.filter((id) => typeof c[id] !== 'function');
    expect(missing, `mock is missing: ${missing.join(', ')}`).toEqual([]);
  });
});
