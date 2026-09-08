import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PANEL_EVENT_NAMES,
  PANEL_OPERATION_IDS,
  SERVER_SIDE_ONLY_OPERATION_IDS,
  zDeviceProvisioning,
  zLoginResponse,
  zRecordingStateSnapshot,
  zResolveJoinCodeResponse,
  zStudentEventEnvelope,
} from '@eduscope/shared';
import { createMemoryTokenStore, createRealClient } from '../../src/index.js';
import { QuizAppProblemError } from '../../src/quiz/quiz-app-client.js';
import { createRealQuizAppClient } from '../../src/quiz/real-quiz-app-client.js';
import {
  REAL_STACK_ACCOUNTS,
  acquireRealStack,
  type RealStackHandle,
} from './fixtures/real-stack.js';

describe('E-06 real-screen witness guard', () => {
  it('fails before stack startup when a spec does not declare a real witness', () => {
    const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));
    const result = spawnSync(
      process.execPath,
      ['packages/api-client/scripts/run-real-screen.mjs', 'panel', 'zz-witness-guard-fixture'],
      { cwd: repositoryRoot, encoding: 'utf8' },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('does not declare a real adapter witness');
  });
});

describe('E-06 real-stack contract honesty', () => {
  let stack: RealStackHandle;

  beforeAll(async () => {
    stack = await acquireRealStack();
  }, 120_000);

  afterAll(async () => {
    await stack?.close();
  });

  it('advertises the closed browser surface and no server-only quiz-sync method', () => {
    expect(PANEL_OPERATION_IDS).toHaveLength(79);
    expect(PANEL_EVENT_NAMES).toHaveLength(22);
    expect(stack.capabilities).toEqual({
      panelOperations: 79,
      studentOperations: 3,
      panelSockets: 2,
      studentSockets: 1,
    });

    const panel = createRealClient(stack.coreBaseUrl);
    const quiz = createRealQuizAppClient({ baseUrl: stack.quizBaseUrl });
    const panelSurface = panel as unknown as Record<string, unknown>;
    const quizSurface = quiz as unknown as Record<string, unknown>;
    expect(PANEL_OPERATION_IDS.every((operation) => typeof panelSurface[operation] === 'function')).toBe(true);
    expect(['resolveJoinCode', 'registerParticipant', 'submitAnswer']
      .every((operation) => typeof quizSurface[operation] === 'function')).toBe(true);
    expect(SERVER_SIDE_ONLY_OPERATION_IDS
      .every((operation) => panelSurface[operation] === undefined && quizSurface[operation] === undefined)).toBe(true);
    panel.dispose();
    quiz.dispose();
  });

  it('validates representative real REST results and panel snapshot events', async () => {
    const tokens = createMemoryTokenStore();
    const panel = createRealClient(stack.coreBaseUrl, { tokenStore: tokens });
    const login = await panel.login({
      username: REAL_STACK_ACCOUNTS.lecturer.username,
      password: REAL_STACK_ACCOUNTS.lecturer.password,
      client: 'panel',
    });
    expect(() => zLoginResponse.parse(login)).not.toThrow();
    tokens.setTokens(login.tokens);
    await expect(panel.getProvisioning()).resolves.toSatisfy((value) => zDeviceProvisioning.safeParse(value).success);
    await expect(panel.getRecordingState()).resolves.toSatisfy((value) => zRecordingStateSnapshot.safeParse(value).success);
    panel.dispose();
  });

  it('keeps raw secrets out of the public descriptor and validates captured student frames', async () => {
    const descriptor = JSON.stringify(stack.descriptor);
    expect(descriptor).not.toContain(REAL_STACK_ACCOUNTS.lecturer.password);
    expect(descriptor).not.toMatch(/bearer|credential|secret/i);

    const quiz = createRealQuizAppClient({ baseUrl: stack.quizBaseUrl });
    const resolution = await quiz.resolveJoinCode(stack.descriptor.fixtureIds.joinCode);
    expect(zResolveJoinCodeResponse.safeParse(resolution).success).toBe(true);
    await expect(quiz.resolveJoinCode('UNKNOWN')).rejects.toBeInstanceOf(QuizAppProblemError);

    const frames = await stack.control<{ frames: unknown[] }>('quiz.capture-student-snapshot');
    expect(frames.frames.length).toBeGreaterThanOrEqual(3);
    for (const frame of frames.frames) expect(zStudentEventEnvelope.safeParse(frame).success).toBe(true);
    quiz.dispose();
  });
});
