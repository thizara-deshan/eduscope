import { describe, expect, it } from 'vitest';
import { zStudentEventEnvelope, type StudentServerEvent } from '../src/schemas/events.js';

const PUBLICATION_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const OPTION_A_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAA';
const OPTION_B_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAB';

const VALID_AT = '2026-08-11T09:00:00+00:00';

const payloads: Record<StudentServerEvent['event'], StudentServerEvent> = {
  'quiz.question': { event: 'quiz.question', payload: { state: 'none' } },
  'quiz.result': {
    event: 'quiz.result',
    payload: {
      publicationId: PUBLICATION_ID,
      question: {
        prompt: 'What is 2+2?',
        options: [
          { id: OPTION_A_ID, label: 'A', text: '3' },
          { id: OPTION_B_ID, label: 'B', text: '4' },
        ],
      },
      selectedOptionId: OPTION_B_ID,
      isCorrect: true,
      correctOptionId: OPTION_B_ID,
      pointsAwarded: 10,
      runningScore: 10,
      ownRank: 1,
      rankState: 'current',
    },
  },
  'quiz.participant': { event: 'quiz.participant', payload: { connectionState: 'online' } },
  'quiz.session': { event: 'quiz.session', payload: { state: 'open' } },
};

describe('zStudentEventEnvelope (contracts/events.md §5, workstream D gate flag)', () => {
  for (const [event, payload] of Object.entries(payloads) as [StudentServerEvent['event'], StudentServerEvent][]) {
    describe(event, () => {
      it('accepts a valid envelope with an offset instant and a non-negative integer seq', () => {
        const parsed = zStudentEventEnvelope.parse({ ...payload, at: VALID_AT, seq: 0 });
        expect(parsed.seq).toBe(0);
        expect(parsed.at).toBe(VALID_AT);
      });

      it('rejects a missing seq', () => {
        const { seq: _seq, ...rest } = { ...payload, at: VALID_AT, seq: 0 };
        expect(() => zStudentEventEnvelope.parse(rest)).toThrow();
      });

      it('rejects a negative seq', () => {
        expect(() => zStudentEventEnvelope.parse({ ...payload, at: VALID_AT, seq: -1 })).toThrow();
      });

      it('rejects a fractional seq', () => {
        expect(() => zStudentEventEnvelope.parse({ ...payload, at: VALID_AT, seq: 1.5 })).toThrow();
      });

      it('rejects an instant missing a UTC offset', () => {
        expect(() =>
          zStudentEventEnvelope.parse({ ...payload, at: '2026-08-11T09:00:00', seq: 0 }),
        ).toThrow();
      });

      it('rejects a missing at', () => {
        const { at: _at, ...rest } = { ...payload, at: VALID_AT, seq: 0 };
        expect(() => zStudentEventEnvelope.parse(rest)).toThrow();
      });
    });
  }
});
