import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as shared from '../src/index.js';

const spec = readFileSync(resolve(__dirname, '../../../contracts/quiz-app.yaml'), 'utf8');

function schemaNames(): string[] {
  const lines = spec.split('\n');
  const start = lines.findIndex((line) => line.trimEnd() === '  schemas:');
  const names: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^ {0,3}\S/.test(line)) break;
    const match = /^ {4}([A-Za-z][A-Za-z0-9]*):\s*$/.exec(line);
    if (match?.[1] && match[1] !== 'Ulid') names.push(match[1]);
  }
  return names;
}

describe('quiz-app REST contract v0.6', () => {
  it('exports generated zod for every student-specific schema', () => {
    const missing = schemaNames().filter((name) => !(`z${name}` in shared));
    expect(missing).toEqual([]);
  });

  it('carries the confirmed SLIIT registration policy exactly', () => {
    expect(shared.zRegistrationPolicy.parse({
      studentIdPattern: '^[A-Z]{2}[0-9]{7,8}$',
      studentIdHint: 'Two uppercase letters followed by 7 or 8 digits',
      inputMode: 'text',
      studentIdMaxLength: 10,
      fullNameMaxLength: 128,
    })).toBeTruthy();
    expect(shared.zRegisterParticipantRequest.safeParse({
      fullName: 'K. Fernando', studentIdNumber: 'IT1234567',
    }).success).toBe(true);
    expect(shared.zRegisterParticipantRequest.safeParse({
      fullName: 'K. Fernando', studentIdNumber: 'IT12345678',
    }).success).toBe(true);
    expect(shared.zRegisterParticipantRequest.safeParse({
      fullName: 'K. Fernando', studentIdNumber: 'it12345678',
    }).success).toBe(false);
  });

  it('contains every named Wave 7 problem', () => {
    expect(shared.zQuizAppProblemCode.options).toEqual([
      'quiz.session-not-found', 'quiz.unavailable', 'quiz.session-closed',
      'registration.invalid-name', 'registration.invalid-student-id',
      'question.closed', 'answer.invalid-option',
    ]);
  });
});
