import { describe, expect, it } from 'vitest';
import { ProblemError, TransportError } from '@eduscope/api-client';
import { asProblem, isTransportFailure, revokedReason } from './session.js';
import { clearTokens, getTokens, setTokens } from './token-store.js';

const revoked = (reason?: string) =>
  new ProblemError({
    status: 401, code: 'auth.session-revoked', title: 'Session revoked',
    ...(reason ? { meta: { reason } } : {}),
  } as never);

describe('session helpers', () => {
  it('reads the Problem off a ProblemError and nothing else off anything else', () => {
    expect(asProblem(revoked('takeover'))?.code).toBe('auth.session-revoked');
    expect(asProblem(new TransportError('login'))).toBeNull();
    expect(asProblem(new TypeError('boom'))).toBeNull();
    expect(asProblem(undefined)).toBeNull();
  });

  it('treats every non-Problem rejection as a transport failure', () => {
    expect(isTransportFailure(new TransportError('login'))).toBe(true);
    expect(isTransportFailure(new TypeError('Failed to fetch'))).toBe(true);
    expect(isTransportFailure(revoked('expired'))).toBe(false);
  });

  it('names the revocation reason, defaulting to expired', () => {
    expect(revokedReason(revoked('takeover'))).toBe('takeover');
    expect(revokedReason(revoked('admin'))).toBe('admin');
    expect(revokedReason(revoked())).toBe('expired');
    expect(revokedReason(new TransportError('getMe'))).toBeNull();
  });

  it('holds tokens in memory and gives them back', () => {
    setTokens({ accessToken: 'a', refreshToken: 'r', expiresInSec: 900 });
    expect(getTokens()?.accessToken).toBe('a');
    clearTokens();
    expect(getTokens()).toBeNull();
  });
});
