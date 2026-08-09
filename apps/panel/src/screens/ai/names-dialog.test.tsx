import { act, createElement, type ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import type { AnswerProjection } from '@eduscope/shared';
import { ClientContext } from '../../client/client-provider.js';
import { useWsStore } from '../../store/ws-store.js';
import '../../styles/tokens.css';
import { NamesDialog } from './names-dialog.js';

const answer = (overrides: Partial<AnswerProjection> = {}): AnswerProjection => ({
  id: 'a1', publicationId: 'pub1', studentIdNumber: 's1', studentDisplayName: 'K. Fernando',
  selectedOptionId: 'o1', isCorrect: true, responseTimeMs: 3000, submittedAt: '2026-08-05T10:00:00Z',
  syncedAt: '2026-08-05T10:00:00Z', ...overrides,
});

const envelope = (event: string, payload: unknown, seq: number) =>
  ({ event, at: '2026-08-05T10:00:00+00:00', seq, payload }) as never;

function renderDialog(methods: Partial<EduscopeClient> = {}, onClose = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = {
    listPublicationResponses: vi.fn(() => Promise.resolve({ items: [], syncedAt: '2026-08-05T10:00:00Z', stale: false })),
    ...methods,
  } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider, { client: queryClient }, createElement(ClientContext.Provider, { value: client, children }),
  );
  return { ...render(<NamesDialog publicationId="pub1" onClose={onClose} />, { wrapper }), onClose };
}

describe('NamesDialog', () => {
  beforeEach(() => useWsStore.getState().reset());

  it('loading then empty: nobody answered yet', async () => {
    renderDialog();
    expect(await screen.findByTestId('names-dialog-empty')).toHaveTextContent(/nobody has answered/i);
  });

  it('populated: three filterable name lists', async () => {
    renderDialog({
      listPublicationResponses: vi.fn(() => Promise.resolve({
        items: [answer({ studentIdNumber: 's1', isCorrect: true }), answer({ studentIdNumber: 's2', studentDisplayName: 'S. J', isCorrect: false })],
        syncedAt: '2026-08-05T10:00:00Z', stale: false,
      })),
    });
    await waitFor(() => expect(screen.getByTestId('names-dialog-list')).toBeInTheDocument());
    expect(screen.getByRole('tab', { name: 'Responded (2)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Correct (1)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Incorrect (1)' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Correct (1)' }));
    expect(screen.getByText('K. Fernando')).toBeInTheDocument();
    expect(screen.queryByText('S. J')).toBeNull();
  });

  it('stale: a banner carrying syncedAt', async () => {
    renderDialog({
      listPublicationResponses: vi.fn(() => Promise.resolve({ items: [], syncedAt: '2026-08-05T09:58:00Z', stale: true })),
    });
    expect(await screen.findByTestId('names-dialog-stale')).toHaveTextContent('2026-08-05T09:58:00Z');
  });

  it('sync failed: an uncleared quiz.sync-stale alert flags the degraded state', () => {
    renderDialog();
    act(() => useWsStore.getState().ingest(envelope('system.alert', {
      id: 'a1', code: 'quiz.sync-stale', severity: 'error', category: 'System', title: 'quiz.sync-stale',
      detail: null, raisedAt: '2026-08-05T10:00:00Z', clearedAt: null, clearedReason: null,
      acknowledgedBy: null, context: null, relatedEntity: null,
    }, 0)));
    expect(screen.getByTestId('names-dialog-syncfailed')).toBeInTheDocument();
  });

  it('closes on scrim tap', () => {
    const { onClose, container } = renderDialog();
    container.querySelector('.us-modal__scrim')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('close (✕) invokes onClose', () => {
    const { onClose } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
