import { act, createElement, type ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import type { Question } from '@eduscope/shared';
import { ClientContext } from '../../client/client-provider.js';
import { OverlayProvider } from '../../overlays/overlay-host.js';
import { useWsStore } from '../../store/ws-store.js';
import '../../styles/tokens.css';
import { QuestionsModal } from './questions-modal.js';

const recording = () => ({
  state: 'recording', startReason: 'initial', sessionId: '01J00000000000000000000001',
  title: 'Lecture', ownerUserId: 'u1', ownerDisplayName: 'A. Perera',
  startedAt: '2026-08-05T10:00:00Z', recordedDurationMs: 0, segmentIndex: 1,
  segmentCount: 1, pauseCount: 0, takeoverBy: null, takeoverAt: null,
  takeoverByDisplayName: null, errorCode: null, errorMessage: null,
});

const question = (overrides: Partial<Question> = {}): Question => ({
  id: 'q1', sessionId: '01J00000000000000000000001', questionSetId: 'set1', kind: 'mcq',
  prompt: 'Which traversal visits a node before its children?', options: [
    { id: 'o1', questionId: 'q1', label: 'A', text: 'Pre-order', position: 0 },
    { id: 'o2', questionId: 'q1', label: 'B', text: 'In-order', position: 1 },
  ], correctOptionId: 'o1', provenance: 'generated', edited: false, state: 'draft',
  createdAt: '2026-08-05T10:00:00Z', orderHint: 0, ...overrides,
});

const openQuizSession = () => ({
  state: 'open', quizSessionId: '01J00000000000000000000009', lectureSessionId: '01J00000000000000000000001',
  joinUrl: 'https://q/1', joinCode: '111111', joinedCount: 1, syncState: 'synced',
});

function renderModal(methods: Partial<EduscopeClient> = {}, onClose = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = {
    listQuestions: vi.fn(() => Promise.resolve([])),
    getQuizSession: vi.fn(() => Promise.resolve(openQuizSession())),
    generateNow: vi.fn(() => Promise.resolve({ commandId: 'c', acceptedAt: '2026-08-05T10:00:00Z', resolveBySec: 10 })),
    ...methods,
  } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider, { client: queryClient }, createElement(ClientContext.Provider, { value: client },
      createElement(OverlayProvider, null, children)),
  );
  return { ...render(<QuestionsModal onClose={onClose} />, { wrapper }), onClose, client };
}

describe('QuestionsModal', () => {
  beforeEach(() => {
    useWsStore.getState().reset();
    useWsStore.setState({ recording: recording() as never });
  });

  it('empty: no drafts', async () => {
    renderModal();
    expect(await screen.findByTestId('questions-modal-empty')).toHaveTextContent('No questions right now');
  });

  it('loading: opened while generating shows the generating body, not empty', async () => {
    renderModal();
    act(() => useWsStore.getState().ingest({
      event: 'ai.set', at: '2026-08-05T10:00:00+00:00', seq: 0,
      payload: { setId: 's1', sessionId: 'sess1', state: 'generating', trigger: 'manual', count: null, error: null, attempt: 0 },
    } as never));
    expect(screen.getByTestId('questions-modal-generating')).toBeInTheDocument();
    expect(screen.queryByTestId('questions-modal-empty')).toBeNull();
  });

  it('populated: a collapsed accordion of question cards', async () => {
    renderModal({ listQuestions: vi.fn(() => Promise.resolve([question(), question({ id: 'q2', provenance: 'lecturer-authored', questionSetId: null })])) });
    await waitFor(() => expect(screen.getByTestId('question-card-q1')).toBeInTheDocument());
    expect(screen.getByTestId('question-card-q2')).toHaveTextContent('Yours');
    // collapsed by default: no options visible until expanded
    expect(screen.queryByText('A. Pre-order')).toBeNull();
  });

  it('close (✕) invokes onClose', async () => {
    const { onClose } = renderModal();
    await screen.findByTestId('questions-modal-empty');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Regenerate calls generateNow', async () => {
    const { client } = renderModal({ listQuestions: vi.fn(() => Promise.resolve([question()])) });
    await waitFor(() => expect(screen.getByTestId('question-card-q1')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    expect(client.generateNow).toHaveBeenCalledTimes(1);
  });
});
