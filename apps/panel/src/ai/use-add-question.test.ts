import { act, createElement, type ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import { ProblemError } from '@eduscope/api-client';
import { TIMERS } from '@eduscope/shared';
import { ClientContext } from '../client/client-provider.js';
import { useWsStore } from '../store/ws-store.js';
import { useAddQuestion } from './use-add-question.js';

const envelope = (event: string, payload: unknown, seq: number) =>
  ({ event, at: '2026-08-05T10:00:00+00:00', seq, payload }) as never;

function build(methods: Partial<EduscopeClient> = {}) {
  const onSaved = vi.fn();
  const stub = {
    createQuestion: vi.fn(() => Promise.resolve({ commandId: 'c', acceptedAt: '2026-08-05T10:00:00Z', resolveBySec: 10 })),
    ...methods,
  } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    ClientContext.Provider, { value: stub, children },
  );
  return { hook: renderHook(() => useAddQuestion(onSaved), { wrapper }), client: stub, onSaved };
}

describe('useAddQuestion', () => {
  beforeEach(() => useWsStore.getState().reset());

  it('empty: blank prompt, two empty choices — invalid with a reason', () => {
    const { hook } = build();
    expect(hook.result.current.choices).toEqual(['', '']);
    expect(hook.result.current.valid).toBe(false);
    expect(hook.result.current.invalidReason).toMatch(/enter a question/i);
  });

  it('filling: add/remove choices bound 2-4', () => {
    const { hook } = build();
    act(() => hook.result.current.addChoice());
    act(() => hook.result.current.addChoice());
    expect(hook.result.current.choices).toHaveLength(4);
    act(() => hook.result.current.addChoice()); // no-op past 4
    expect(hook.result.current.choices).toHaveLength(4);
    expect(hook.result.current.canAddChoice).toBe(false);
    act(() => hook.result.current.removeChoice(3));
    act(() => hook.result.current.removeChoice(2));
    expect(hook.result.current.choices).toHaveLength(2);
    expect(hook.result.current.canRemoveChoice).toBe(false);
  });

  it('invalid: a blank choice blocks submit with a specific reason', () => {
    const { hook } = build();
    act(() => hook.result.current.setPrompt('What is 2+2?'));
    act(() => hook.result.current.setChoice(0, '4'));
    expect(hook.result.current.valid).toBe(false);
    expect(hook.result.current.invalidReason).toMatch(/fill in every choice/i);
  });

  it('saving (U-4): save issues createQuestion and marks itself saving', () => {
    const { hook, client } = build();
    act(() => hook.result.current.setPrompt('What is 2+2?'));
    act(() => hook.result.current.setChoice(0, '4'));
    act(() => hook.result.current.setChoice(1, '5'));
    act(() => hook.result.current.save());
    expect(client.createQuestion).toHaveBeenCalledWith({
      prompt: 'What is 2+2?',
      options: [{ text: '4', isCorrect: true }, { text: '5', isCorrect: false }],
    });
    expect(hook.result.current.saving).toBe(true);
  });

  it('saved: resolves on the ai.question{draft, lecturer-authored} echo and closes', () => {
    const { hook, onSaved } = build();
    act(() => hook.result.current.setPrompt('What is 2+2?'));
    act(() => hook.result.current.setChoice(0, '4'));
    act(() => hook.result.current.setChoice(1, '5'));
    act(() => hook.result.current.save());
    act(() => useWsStore.getState().ingest(envelope('ai.question', {
      questionId: 'new1', setId: null, state: 'draft', provenance: 'lecturer-authored', edited: false,
    }, 0)));
    expect(hook.result.current.saving).toBe(false);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('rejected (422/409): a rejected save keeps the form intact', async () => {
    const refusal = new ProblemError({ status: 422, code: 'validation.invalid', title: 'Invalid question' });
    const { hook } = build({ createQuestion: vi.fn(() => Promise.reject(refusal)) });
    act(() => hook.result.current.setPrompt('What is 2+2?'));
    act(() => hook.result.current.setChoice(0, '4'));
    act(() => hook.result.current.setChoice(1, '5'));
    await act(async () => {
      hook.result.current.save();
      await Promise.resolve();
    });
    expect(hook.result.current.saving).toBe(false);
    expect(hook.result.current.problem).toMatch(/invalid question/i);
    expect(hook.result.current.prompt).toBe('What is 2+2?');
    expect(hook.result.current.choices).toEqual(['4', '5']);
  });

  it('T-CMD-RESOLVE produces a timeout failure if nothing ever resolves', () => {
    vi.useFakeTimers();
    try {
      const { hook } = build({ createQuestion: vi.fn(() => new Promise<never>(() => {})) });
      act(() => hook.result.current.setPrompt('What is 2+2?'));
      act(() => hook.result.current.setChoice(0, '4'));
      act(() => hook.result.current.setChoice(1, '5'));
      act(() => hook.result.current.save());
      act(() => vi.advanceTimersByTime(TIMERS['T-CMD-RESOLVE']));
      expect(hook.result.current.saving).toBe(false);
      expect(hook.result.current.problem).toMatch(/did not resolve/i);
    } finally {
      vi.useRealTimers();
    }
  });
});
