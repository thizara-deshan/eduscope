import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMemoryTokenStore, createMockClient, createRealClient } from '../../src/index.js';
import {
  REAL_STACK_ACCOUNTS,
  acquireRealStack,
  normalizeParityValue,
  type RealStackHandle,
} from './fixtures/real-stack.js';

describe('E-06 normalized mock/real parity', () => {
  let stack: RealStackHandle;

  beforeAll(async () => {
    stack = await acquireRealStack();
  }, 120_000);

  afterAll(async () => {
    await stack?.close();
  });

  it('matches representative auth/user, recording, channel, storage, AI and quiz semantics', async () => {
    const tokens = createMemoryTokenStore();
    const real = createRealClient(stack.coreBaseUrl, { tokenStore: tokens });
    const mock = createMockClient('happy');
    const login = await real.login({
      username: REAL_STACK_ACCOUNTS.lecturer.username,
      password: REAL_STACK_ACCOUNTS.lecturer.password,
      client: 'panel',
    });
    tokens.setTokens(login.tokens);

    const realValues = await Promise.all([
      real.getMe(),
      real.getRecordingState(),
      real.listChannels(),
      real.getStorageOverview(),
      real.getAiCountdown(),
      real.getQuizSession(),
    ]);
    const mockValues = await Promise.all([
      mock.getMe(),
      mock.getRecordingState(),
      mock.listChannels(),
      mock.getStorageOverview(),
      mock.getAiCountdown(),
      mock.getQuizSession(),
    ]);

    expect(realValues.map(normalizeParityValue)).toEqual(mockValues.map(normalizeParityValue));
    real.dispose();
    mock.dispose();
  });
});
