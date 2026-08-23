import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';

const LONG_SECRET = 'a'.repeat(32);
const SHORT_SECRET = 'too-short-secret';

function baseEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    NODE_ENV: 'development',
    QUIZ_SERVICE_DATABASE_URL: 'postgres://127.0.0.1:5432/eduscope_quiz_test',
    ...overrides,
  };
}

describe('quiz-service config', () => {
  it('defaults to loopback host, port 7300, and an 86400s participant session TTL', () => {
    const config = loadConfig(baseEnv());
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(7300);
    expect(config.participantSessionTtlSec).toBe(86_400);
  });

  it('defaults nextAppDir to apps/quiz resolved from the service directory', () => {
    const config = loadConfig(baseEnv());
    expect(config.nextAppDir.replace(/\\/g, '/')).toMatch(/\/apps\/quiz$/);
  });

  it('production accepts a loopback host', () => {
    expect(() =>
      loadConfig(
        baseEnv({
          NODE_ENV: 'production',
          QUIZ_SERVICE_HOST: '127.0.0.1',
          QUIZ_SERVICE_PUBLIC_ORIGIN: 'https://quiz.example.edu',
          QUIZ_SERVICE_COOKIE_SECRET: LONG_SECRET,
        }),
      ),
    ).not.toThrow();
  });

  it('production rejects a non-loopback host', () => {
    expect(() =>
      loadConfig(
        baseEnv({
          NODE_ENV: 'production',
          QUIZ_SERVICE_HOST: '0.0.0.0',
          QUIZ_SERVICE_PUBLIC_ORIGIN: 'https://quiz.example.edu',
          QUIZ_SERVICE_COOKIE_SECRET: LONG_SECRET,
        }),
      ),
    ).toThrow(/loopback/i);
  });

  it('production requires an HTTPS public origin', () => {
    expect(() =>
      loadConfig(
        baseEnv({
          NODE_ENV: 'production',
          QUIZ_SERVICE_PUBLIC_ORIGIN: 'http://quiz.example.edu',
          QUIZ_SERVICE_COOKIE_SECRET: LONG_SECRET,
        }),
      ),
    ).toThrow(/https/i);
  });

  it('production accepts an HTTPS public origin', () => {
    expect(() =>
      loadConfig(
        baseEnv({
          NODE_ENV: 'production',
          QUIZ_SERVICE_PUBLIC_ORIGIN: 'https://quiz.example.edu',
          QUIZ_SERVICE_COOKIE_SECRET: LONG_SECRET,
        }),
      ),
    ).not.toThrow();
  });

  it('production rejects a cookie secret shorter than 32 characters', () => {
    expect(() =>
      loadConfig(
        baseEnv({
          NODE_ENV: 'production',
          QUIZ_SERVICE_PUBLIC_ORIGIN: 'https://quiz.example.edu',
          QUIZ_SERVICE_COOKIE_SECRET: SHORT_SECRET,
        }),
      ),
    ).toThrow(/32/);
  });

  it('production accepts a cookie secret of exactly 32 characters', () => {
    expect(() =>
      loadConfig(
        baseEnv({
          NODE_ENV: 'production',
          QUIZ_SERVICE_PUBLIC_ORIGIN: 'https://quiz.example.edu',
          QUIZ_SERVICE_COOKIE_SECRET: LONG_SECRET,
        }),
      ),
    ).not.toThrow();
  });

  it('never embeds the rejected cookie secret value in its error message', () => {
    try {
      loadConfig(
        baseEnv({
          NODE_ENV: 'production',
          QUIZ_SERVICE_PUBLIC_ORIGIN: 'https://quiz.example.edu',
          QUIZ_SERVICE_COOKIE_SECRET: SHORT_SECRET,
        }),
      );
      throw new Error('expected loadConfig to throw');
    } catch (error) {
      expect(String((error as Error).message)).not.toContain(SHORT_SECRET);
    }
  });

  it('rejects a non-positive port', () => {
    expect(() => loadConfig(baseEnv({ QUIZ_SERVICE_PORT: '0' }))).toThrow();
  });

  it('rejects a non-positive participant session TTL', () => {
    expect(() => loadConfig(baseEnv({ QUIZ_SERVICE_PARTICIPANT_SESSION_TTL_SEC: '-1' }))).toThrow();
  });
});
