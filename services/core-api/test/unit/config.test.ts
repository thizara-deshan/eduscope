import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';

describe('loadConfig', () => {
  it('defaults host/port to 127.0.0.1:5000', () => {
    const config = loadConfig({});

    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(5000);
  });

  it('rejects a non-loopback host', () => {
    expect(() => loadConfig({ CORE_API_HOST: '0.0.0.0' })).toThrow(/loopback/i);
    expect(() => loadConfig({ CORE_API_HOST: '203.0.113.5' })).toThrow(/loopback/i);
  });

  it('accepts loopback host aliases', () => {
    expect(loadConfig({ CORE_API_HOST: 'localhost' }).host).toBe('localhost');
    expect(loadConfig({ CORE_API_HOST: '::1' }).host).toBe('::1');
  });

  it('rejects production secrets shorter than 32 characters', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        CORE_API_INTERNAL_BEARER: 'too-short',
        CORE_API_JWT_SECRET: 'x'.repeat(32),
        CORE_API_SECRETBOX_KEY: 'x'.repeat(32),
      }),
    ).toThrow(/at least 32 characters/i);

    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        CORE_API_INTERNAL_BEARER: 'x'.repeat(32),
        CORE_API_JWT_SECRET: 'too-short',
        CORE_API_SECRETBOX_KEY: 'x'.repeat(32),
      }),
    ).toThrow(/at least 32 characters/i);
  });

  it('accepts production secrets of exactly 32 characters', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      CORE_API_INTERNAL_BEARER: 'x'.repeat(32),
      CORE_API_JWT_SECRET: 'y'.repeat(32),
      CORE_API_SECRETBOX_KEY: 'z'.repeat(32),
    });

    expect(config.nodeEnv).toBe('production');
    expect(config.internalBearer).toHaveLength(32);
  });

  it('allows test paths to point at a temp directory without extra validation', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      CORE_API_DB_PATH: '/tmp/eduscope-test-abc123/core.db',
      CORE_API_RECORDINGS_ROOT: '/tmp/eduscope-test-abc123/recordings',
    });

    expect(config.dbPath).toBe('/tmp/eduscope-test-abc123/core.db');
    expect(config.recordingsRoot).toBe('/tmp/eduscope-test-abc123/recordings');
  });

  it('carries the pipeline-manager base URL, TTLs, and remaining paths', () => {
    const config = loadConfig({});

    expect(config.pipelineManagerBaseUrl).toBe('http://127.0.0.1:8091');
    expect(config.dbPath).toBe('/var/lib/eduscope/core.db');
    expect(config.runtimeDir).toBe('/run/eduscope');
    expect(config.provisioningPath).toBe('/etc/eduscope/provisioning.json');
    expect(config.helperSocketPath).toBe('/run/eduscope/helper.sock');
    expect(config.accessTokenTtlSec).toBeGreaterThan(0);
    expect(config.refreshTokenTtlSec).toBeGreaterThan(0);
  });
});
