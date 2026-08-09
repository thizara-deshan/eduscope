import { act, createElement, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import { ProblemError } from '@eduscope/api-client';
import type { Question } from '@eduscope/shared';
import { ClientContext } from '../client/client-provider.js';
import { useWsStore } from '../store/ws-store.js';
import { useQuestions } from './use-questions.js';

const recording = () => ({
  state: 'recording', startReason: 'initial', sessionId: '01J00000000000000000000001',
  title: 'Lecture', ownerUserId: 'u1', ownerDisplayName: 'A. Perera',
  startedAt: '2026-08-05T10:00:00Z', recordedDurationMs: 0, segmentIndex: 1,
  segmentCount: 1, pauseCount: 0, takeoverBy: null, takeoverAt: null,
  takeoverByDisplayName: null, errorCode: null, errorMessage: null,
});

const question = (overrides: Partial<Question> = {}): Question => ({
  id: 'q1', sessionId: '01J00000000000000000000001', questionSetId: 'set1', kind: 'mcq',
  prompt: 'Prompt?', options: [
    { id: 'o1', questionId: 'q1', label: 'A', text: 'A', position: 0 },
    { id: 'o2', questionId: 'q1', label: 'B', text: 'B', position: 1 },
  ], correctOptionId: 'o1', provenance: 'generated', edited: false, state: 'draft',
  createdAt: '2026-08-05T10:00:00Z', orderHint: 0, ...overrides,
});

const openQuizSession = () => ({
  state: 'open', quizSessionId: '01J00000000000000000000009', lectureSessionId: '01J00000000000000000000001',
  joinUrl: 'https://q/1', joinCode: '111111', joinedCount: 1, syncState: 'synced',
});

const envelope = (event: string, payload: unknown, seq: number) =>
  ({ event, at: '2026-08-05T10:00:00+00:00', seq, payload }) as never;

function build(methods: Partial<EduscopeClient> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const stub = {
    listQuestions: vi.fn(() => Promise.resolve([])),
    getQuizSession: vi.fn(() => Promise.resolve(openQuizSession())),
    editQuestion: vi.fn(() => Promise.resolve({ commandId: 'c', acceptedAt: '2026-08-05T10:00:00Z', resolveBySec: 10 })),
    discardQuestion: vi.fn(() => Promise.resolve({ commandId: 'c', acceptedAt: '2026-08-05T10:00:00Z', resolveBySec: 10 })),
    sendToProjector: vi.fn(() => Promise.resolve({ commandId: 'c', acceptedAt: '2026-08-05T10:00:00Z', resolveBySec: 10 })),
    generateNow: vi.fn(() => Promise.resolve({ commandId: 'c', acceptedAt: '2026-08-05T10:00:00Z', resolveBySec: 10 })),
    ...methods,
  } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider, { client: queryClient }, createElement(ClientContext.Provider, { value: stub, children }),
  );
  return { hook: renderHook(() => useQuestions(), { wrapper }), client: stub };
}

describe('useQuestions', () => {
  beforeEach(() => {
    useWsStore.getState().reset();
    useWsStore.setState({ recording: recording() as never });
  });

  it('empty: no drafts', async () => {
    const { hook } = build();
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.questions).toHaveLength(0);
  });

  it('loading: opened while generating', () => {
    const { hook } = build();
    act(() => useWsStore.getState().ingest(envelope('ai.set', {
      setId: 's1', sessionId: 'sess1', state: 'generating', trigger: 'manual', count: null, error: null, attempt: 0,
    }, 0)));
    expect(hook.result.current.generating).toBe(true);
  });

  it('populated: drafts from the REST snapshot', async () => {
    const { hook } = build({ listQuestions: vi.fn(() => Promise.resolve([question()])) });
    await waitFor(() => expect(hook.result.current.questions).toHaveLength(1));
  });

  it('editing resolves on the ai.question{edited:true} echo', async () => {
    const { hook, client } = build({ listQuestions: vi.fn(() => Promise.resolve([question()])) });
    await waitFor(() => expect(hook.result.current.questions).toHaveLength(1));
    act(() => hook.result.current.editQuestion('q1', { prompt: 'Edited?' }));
    expect(client.editQuestion).toHaveBeenCalledWith('q1', { prompt: 'Edited?' });
    expect(hook.result.current.pendingId).toBe('q1');
    act(() => useWsStore.getState().ingest(envelope('ai.question', {
      questionId: 'q1', setId: 'set1', state: 'draft', provenance: 'generated', edited: true,
    }, 0)));
    expect(hook.result.current.pendingId).toBeNull();
  });

  it('edit refused (immutable): shows the reason and leaves the row unchanged', async () => {
    const refusal = new ProblemError({
      status: 409, code: 'question.immutable', title: 'Only draft questions can be edited',
    });
    const { hook } = build({
      listQuestions: vi.fn(() => Promise.resolve([question({ id: 'q2', state: 'sent' })])),
      editQuestion: vi.fn(() => Promise.reject(refusal)),
    });
    await waitFor(() => expect(hook.result.current.questions).toHaveLength(1));
    act(() => hook.result.current.editQuestion('q2', { prompt: 'x' }));
    await waitFor(() => expect(hook.result.current.pendingId).toBeNull());
    expect(hook.result.current.problemByQuestionId.q2).toMatch(/only draft/i);
    expect(hook.result.current.questions[0]!.state).toBe('sent');
  });

  it('discarding/discarded: the row leaves the list', async () => {
    const { hook } = build({ listQuestions: vi.fn(() => Promise.resolve([question()])) });
    await waitFor(() => expect(hook.result.current.questions).toHaveLength(1));
    act(() => hook.result.current.discardQuestion('q1'));
    expect(hook.result.current.pendingKind).toBe('discarding');
    act(() => useWsStore.getState().ingest(envelope('ai.question', {
      questionId: 'q1', setId: 'set1', state: 'discarded', provenance: 'generated', edited: false,
    }, 0)));
    expect(hook.result.current.questions).toHaveLength(0);
    expect(hook.result.current.pendingId).toBeNull();
  });

  it('sending -> sent resolves on the ai.question{state:sent} echo', async () => {
    const { hook } = build({ listQuestions: vi.fn(() => Promise.resolve([question()])) });
    await waitFor(() => expect(hook.result.current.questions).toHaveLength(1));
    await waitFor(() => expect(hook.result.current.canSend).toBe(true));
    act(() => hook.result.current.sendToProjector('q1'));
    expect(hook.result.current.pendingKind).toBe('sending');
    act(() => useWsStore.getState().ingest(envelope('ai.question', {
      questionId: 'q1', setId: 'set1', state: 'sent', provenance: 'generated', edited: false,
    }, 0)));
    expect(hook.result.current.pendingId).toBeNull();
    expect(hook.result.current.questions[0]!.state).toBe('sent');
  });

  it('send failed: shows the reason via problemByQuestionId', async () => {
    const { hook } = build({
      listQuestions: vi.fn(() => Promise.resolve([question()])),
      sendToProjector: vi.fn(() => Promise.reject(new ProblemError({
        status: 502, code: 'conflict', title: "couldn't send to the projector",
      }))),
    });
    await waitFor(() => expect(hook.result.current.questions).toHaveLength(1));
    await waitFor(() => expect(hook.result.current.canSend).toBe(true));
    act(() => hook.result.current.sendToProjector('q1'));
    await waitFor(() => expect(hook.result.current.pendingId).toBeNull());
    expect(hook.result.current.problemByQuestionId.q1).toMatch(/projector/i);
  });

  it('send refused (quiz unavailable): canSend is false with a reason', async () => {
    const { hook } = build({
      getQuizSession: vi.fn(() => Promise.resolve({
        state: 'failed', quizSessionId: null, lectureSessionId: null, joinUrl: null, joinCode: null,
        joinedCount: 0, syncState: null,
      })) as unknown as EduscopeClient['getQuizSession'],
    });
    await waitFor(() => expect(hook.result.current.canSend).toBe(false));
    expect(hook.result.current.sendRefusalReason).not.toBeNull();
  });

  it('superseded while open: a new ai.set{ready} keeps lecturer-authored (questionSetId:null) rows', async () => {
    const { hook } = build({
      listQuestions: vi.fn(() => Promise.resolve([question({ id: 'authored', questionSetId: null, provenance: 'lecturer-authored' })])),
    });
    await waitFor(() => expect(hook.result.current.questions).toHaveLength(1));
    act(() => useWsStore.getState().ingest(envelope('ai.question', {
      questionId: 'generated2', setId: 'set2', state: 'draft', provenance: 'generated', edited: false,
    }, 0)));
    const ids = hook.result.current.questions.map((q) => q.id);
    expect(ids).toContain('authored');
    expect(ids).toContain('generated2');
  });
});
