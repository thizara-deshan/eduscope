import { describe, expect, it } from 'vitest';
import { createMockQuizClient } from '@eduscope/api-client/quiz';
import { createSelfRegistrationProvider } from './self-registration.js';

const provider = createSelfRegistrationProvider(createMockQuizClient());

describe('quiz identity (A-16 seam)', () => {
  it('declares which mechanism is active so the SSO swap is a one-line change', () => {
    expect(provider.kind).toBe('self-registration');
  });

  it('registers a student by real name + student ID (QZ-3, [D-21])', async () => {
    const identity = await provider.register('ABC123', {
      displayName: 'K. Fernando',
      studentIdNumber: 'EN20214567',
    });
    expect(identity.studentIdNumber).toBe('EN20214567');
    expect(identity.participantId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('validates the student ID FORMAT only — no roster check in V1 ([D-21])', async () => {
    await expect(
      provider.register('ABC123', { displayName: 'K. Fernando', studentIdNumber: '!!' }),
    ).rejects.toThrow(/student id/i);
    // A well-formed ID that is on no roster still succeeds — that is the V1 rule.
    await expect(
      provider.register('ABC123', { displayName: 'K. Fernando', studentIdNumber: 'ZZ99999999' }),
    ).resolves.toBeTruthy();
  });

  it('reuses the participant on rejoin rather than creating a second (INV-QP-1)', async () => {
    const first = await provider.register('ABC123', {
      displayName: 'K. Fernando', studentIdNumber: 'EN20214567',
    });
    const again = await provider.register('ABC123', {
      displayName: 'K. Fernando', studentIdNumber: 'EN20214567',
    });
    expect(again.participantId).toBe(first.participantId);
  });

  it('rejects a blank display name (QZ-3 requires a real name)', async () => {
    await expect(
      provider.register('ABC123', { displayName: '  ', studentIdNumber: 'EN20214567' }),
    ).rejects.toThrow(/name/i);
  });
});
