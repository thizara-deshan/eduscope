import { describe, expect, it } from 'vitest';
import { hashDeviceCredential, verifyDeviceCredential } from '../../src/device/credentials.js';

const VALID_TOKEN = 'a'.repeat(32);
const OTHER_VALID_TOKEN = 'b'.repeat(32);

describe('device credential hashing', () => {
  it('produces two different hashes for the same token (argon2 salts each hash)', async () => {
    const first = await hashDeviceCredential(VALID_TOKEN);
    const second = await hashDeviceCredential(VALID_TOKEN);
    expect(first).not.toBe(second);
  });

  it('verifies both hashes of the same token against the original token', async () => {
    const first = await hashDeviceCredential(VALID_TOKEN);
    const second = await hashDeviceCredential(VALID_TOKEN);
    await expect(verifyDeviceCredential(first, VALID_TOKEN)).resolves.toBe(true);
    await expect(verifyDeviceCredential(second, VALID_TOKEN)).resolves.toBe(true);
  });

  it('fails verification for a wrong token', async () => {
    const hash = await hashDeviceCredential(VALID_TOKEN);
    await expect(verifyDeviceCredential(hash, OTHER_VALID_TOKEN)).resolves.toBe(false);
  });

  it('rejects hashing a token shorter than 32 characters', async () => {
    await expect(hashDeviceCredential('too-short')).rejects.toThrow(/32/);
  });

  it('hashes with the argon2id variant', async () => {
    const hash = await hashDeviceCredential(VALID_TOKEN);
    expect(hash).toMatch(/^\$argon2id\$/);
  });
});
