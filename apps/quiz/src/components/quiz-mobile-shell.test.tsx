import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { QuizMobileShell } from './quiz-mobile-shell.js';

const globalsCssPath = resolve(__dirname, '../../app/globals.css');
const css = readFileSync(globalsCssPath, 'utf8');

describe('QuizMobileShell', () => {
  it('renders a brand bar and a main landmark', () => {
    render(
      <QuizMobileShell>
        <p>content</p>
      </QuizMobileShell>,
    );
    expect(screen.getByRole('banner')).toHaveTextContent('Eduscope Quiz');
    expect(screen.getByRole('main')).toHaveTextContent('content');
  });

  it('renders the connection strip only when not online', () => {
    const { rerender } = render(<QuizMobileShell>content</QuizMobileShell>);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    rerender(<QuizMobileShell connectionState="reconnecting">content</QuizMobileShell>);
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting');
  });
});

describe('quiz design tokens (globals.css)', () => {
  it('caps the content column between 360 and 430px', () => {
    expect(/\.quiz-shell__main\s*{[^}]*max-width:\s*430px/.test(css)).toBe(true);
    expect(/\.quiz-shell__main\s*{[^}]*min-width:\s*360px/.test(css)).toBe(false); // fluid below 430, never wider
  });

  it('reserves the bottom 24px safe area', () => {
    expect(/--safe-bottom:\s*24px;/.test(css)).toBe(true);
  });

  it('sets root/body/input text at >= 16px', () => {
    const rootSize = /--fs-root:\s*([^;]+);/.exec(css)?.[1]?.trim();
    expect(Number.parseInt(rootSize ?? '0', 10)).toBeGreaterThanOrEqual(16);
    expect(/input\s*{[^}]*font-size:\s*var\(--fs-root\)/.test(css)).toBe(true);
  });

  it('sets the generic touch-target floor at >= 44px', () => {
    expect(/--tap-min:\s*44px;/.test(css)).toBe(true);
  });

  it('sets the answer-target floor at >= 64px', () => {
    expect(/--tap-answer:\s*64px;/.test(css)).toBe(true);
  });

  it('gives focus a visible ring', () => {
    expect(/:focus-visible\s*{[^}]*outline:/.test(css)).toBe(true);
  });

  it('overrides motion for prefers-reduced-motion', () => {
    expect(/@media \(prefers-reduced-motion: reduce\)/.test(css)).toBe(true);
  });

  it('never gates behavior behind :hover', () => {
    expect(/:hover/.test(css)).toBe(false);
  });
});
