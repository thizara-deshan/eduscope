import { createElement, type ReactNode } from 'react';
import { act } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import type { UserImportBatch } from '@eduscope/shared';
import { ClientContext } from '../../../../client/client-provider.js';
import { useWsStore } from '../../../../store/ws-store.js';
import { BulkImportOverlay } from './bulk-import-overlay.js';

function build(methods: Partial<EduscopeClient> = {}) {
  useWsStore.getState().reset();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const stub = { ...methods } as unknown as EduscopeClient;
  const wrapper = ({ children }: { children: ReactNode }) => createElement(
    QueryClientProvider, { client: queryClient }, createElement(ClientContext.Provider, { value: stub, children }),
  );
  return render(createElement(BulkImportOverlay, { onClose: vi.fn() }), { wrapper });
}

function xlsxFile(name = 'roster.xlsx') {
  return new File(['stub'], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

describe('BulkImportOverlay', () => {
  beforeEach(() => {
    useWsStore.getState().reset();
  });

  it('idle: shows the required-columns statement', () => {
    build();
    expect(screen.getByText(/Required columns: username, displayName, role/)).toBeInTheDocument();
  });

  it('accepted: N users created, all flagged for reset', async () => {
    const batch: UserImportBatch = {
      id: 'B1', filename: 'roster.xlsx', uploadedAt: '2026-01-01T00:00:00Z',
      state: 'applied', rowCount: 2, acceptedCount: 2, rejections: [],
    };
    const importUsers = vi.fn(() => Promise.resolve(batch));
    build({ importUsers });
    fireEvent.change(screen.getByLabelText('Choose roster file'), { target: { files: [xlsxFile()] } });
    await waitFor(() => expect(screen.getByTestId('import-accepted')).toHaveTextContent('2 users created'));
    expect(importUsers).toHaveBeenCalled();
  });

  it('rejected (the headline state): row->reason table + "Nothing was imported."', async () => {
    const batch: UserImportBatch = {
      id: 'B1', filename: 'roster.xlsx', uploadedAt: '2026-01-01T00:00:00Z',
      state: 'rejected', rowCount: 3, acceptedCount: 0,
      rejections: [
        { row: 2, column: 'username', reason: 'username-exists' },
        { row: 3, column: 'displayName', reason: 'empty-cell' },
      ],
    };
    const importUsers = vi.fn(() => Promise.resolve(batch));
    build({ importUsers });
    fireEvent.change(screen.getByLabelText('Choose roster file'), { target: { files: [xlsxFile()] } });
    await waitFor(() => expect(screen.getByTestId('rejection-headline')).toHaveTextContent('Nothing was imported.'));
    expect(screen.getByText('username-exists')).toBeInTheDocument();
    expect(screen.getByText('empty-cell')).toBeInTheDocument();
  });

  it('wrong file type: a .txt is rejected client-side, no upload issued', async () => {
    const importUsers = vi.fn(() => Promise.resolve({} as UserImportBatch));
    build({ importUsers });
    const txt = new File(['x'], 'roster.txt', { type: 'text/plain' });
    fireEvent.change(screen.getByLabelText('Choose roster file'), { target: { files: [txt] } });
    expect(screen.getByText(/is not a \.xlsx file/)).toBeInTheDocument();
    expect(importUsers).not.toHaveBeenCalled();
  });

  it('uploading: shows a pending indicator while the mutation is in flight', async () => {
    let resolve!: (v: UserImportBatch) => void;
    const importUsers = vi.fn(() => new Promise<UserImportBatch>((r) => { resolve = r; }));
    build({ importUsers });
    fireEvent.change(screen.getByLabelText('Choose roster file'), { target: { files: [xlsxFile()] } });
    await waitFor(() => expect(screen.getByTestId('import-uploading')).toBeInTheDocument());
    act(() => resolve({
      id: 'B1', filename: 'roster.xlsx', uploadedAt: '2026-01-01T00:00:00Z',
      state: 'applied', rowCount: 1, acceptedCount: 1, rejections: [],
    }));
    await waitFor(() => expect(screen.getByTestId('import-accepted')).toBeInTheDocument());
  });

  it('U-2: the file input is disabled while stale', () => {
    build();
    act(() => useWsStore.setState({ stale: true }));
    expect(screen.getByLabelText('Choose roster file')).toBeDisabled();
  });
});
