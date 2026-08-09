import { act, createElement, type ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import { ProblemError } from '@eduscope/api-client';
import { ClientContext } from '../../client/client-provider.js';
import { useWsStore } from '../../store/ws-store.js';
import '../../styles/tokens.css';
import { AddQuestionDialog } from './add-question-dialog.js';

const envelope = (event: string, payload: unknown, seq: number) =>
  ({ event, at: '2026-08-05T10:00:00+00:00', seq, payload }) as never;

function renderDialog(methods: Partial<EduscopeClient> = {}, onClose = vi.fn()) {
  const client = {
    createQuestion: vi.fn(() => Promise.resolve({ commandId: 'c', acceptedAt: '2026-08-05T10:00:00Z', resolveBySec: 10 })),
    ...methods,
  } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    ClientContext.Provider, { value: client, children },
  );
  return { ...render(<AddQuestionDialog onClose={onClose} />, { wrapper }), onClose, client };
}

describe('AddQuestionDialog', () => {
  beforeEach(() => useWsStore.getState().reset());

  it('empty: two blank choices, Save disabled with a reason', () => {
    renderDialog();
    expect(screen.getByLabelText('Choice A')).toBeInTheDocument();
    expect(screen.getByLabelText('Choice B')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Question' })).toBeDisabled();
    expect(screen.getByTestId('add-question-invalid-reason')).toHaveTextContent(/enter a question/i);
  });

  it('filling: Add choice grows up to 4, then hides', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: '+ Add choice' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Add choice' }));
    expect(screen.getByLabelText('Choice D')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Add choice' })).toBeNull();
  });

  it('tap-a-letter marks the correct answer', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Mark choice B as correct' }));
    expect(screen.getByRole('button', { name: 'Choice B is the correct answer' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('invalid: a blank choice blocks submit', () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'What is 2+2?' } });
    fireEvent.change(screen.getByLabelText('Choice A'), { target: { value: '4' } });
    expect(screen.getByRole('button', { name: 'Save Question' })).toBeDisabled();
    expect(screen.getByTestId('add-question-invalid-reason')).toHaveTextContent(/fill in every choice/i);
  });

  it('saving (U-4) then saved: resolves on the WS echo and closes', () => {
    const { onClose, client } = renderDialog();
    fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'What is 2+2?' } });
    fireEvent.change(screen.getByLabelText('Choice A'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('Choice B'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Question' }));
    expect(client.createQuestion).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    act(() => useWsStore.getState().ingest(envelope('ai.question', {
      questionId: 'new1', setId: null, state: 'draft', provenance: 'lecturer-authored', edited: false,
    }, 0)));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('rejected/409: World AI-disabled keeps the form intact', async () => {
    const refusal = new ProblemError({ status: 409, code: 'ai.unavailable', title: 'AI is unavailable' });
    renderDialog({ createQuestion: vi.fn(() => Promise.reject(refusal)) });
    fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'What is 2+2?' } });
    fireEvent.change(screen.getByLabelText('Choice A'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('Choice B'), { target: { value: '5' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save Question' }));
      await Promise.resolve();
    });
    expect(screen.getByTestId('add-question-problem')).toHaveTextContent('AI is unavailable');
    expect(screen.getByLabelText('Question')).toHaveValue('What is 2+2?');
  });

  it('close (✕) invokes onClose', () => {
    const { onClose } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
