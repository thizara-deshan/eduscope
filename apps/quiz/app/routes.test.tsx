import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { QuizAppProviders } from '../src/app/quiz-app-providers.js';
import JoinPage from './j/[joinCode]/page.js';
import RegisterPage from './j/[joinCode]/register/page.js';
import PlayPage from './s/[quizSessionId]/page.js';

// `new URL('./x', import.meta.url)` doesn't resolve to a file:// URL under
// Vitest's transform pipeline for this file — resolve(__dirname, ...) is the
// pattern already established elsewhere in this codebase (e.g. apps/panel's
// tokens.test.ts) for reading a sibling file from a test.
const globalsCssPath = resolve(__dirname, 'globals.css');

describe('quiz route skeletons (screen-inventory §6)', () => {
  it.each([
    ['S-37', () => <JoinPage params={{ joinCode: 'ABC123' }} />],
    ['S-38', () => <RegisterPage params={{ joinCode: 'ABC123' }} />],
    ['S-39', () => <PlayPage />],
  ])('renders %s', (id, Component) => {
    render(
      <QuizAppProviders>
        <Component />
      </QuizAppProviders>,
    );
    expect(screen.getByTestId('screen').dataset.screen).toBe(id);
  });

  it('sets a >= 16px root size so iOS does not zoom on focus', () => {
    const css = readFileSync(globalsCssPath, 'utf8');
    const rootSize = /--fs-root:\s*([^;]+);/.exec(css)?.[1]?.trim();
    expect(Number.parseInt(rootSize ?? '0', 10)).toBeGreaterThanOrEqual(16);
  });

  it('sets the answer-target floor at 64px (screen-inventory §6)', () => {
    const css = readFileSync(globalsCssPath, 'utf8');
    expect(/--tap-answer:\s*64px;/.test(css)).toBe(true);
  });
});
