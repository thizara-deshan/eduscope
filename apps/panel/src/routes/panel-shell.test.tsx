import { createElement, type ReactNode } from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { EduscopeClient } from '@eduscope/api-client';
import type { User } from '@eduscope/shared';
import { AuthProvider } from '../auth/auth-context.js';
import { ClientContext } from '../client/client-provider.js';
import '../styles/tokens.css';
import { routeObjects } from './router.js';
import { RuntimeConfigProvider } from '../config/runtime-config.js';
import type { RuntimeConfig } from '@eduscope/api-client';

function makeUser(): User {
  return {
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    username: 'a.perera',
    displayName: 'A. Perera',
    role: 'lecturer',
    source: 'institute',
    mustResetPassword: false,
    disabled: false,
    lastLoginAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function renderAt(path: string, runtime?: RuntimeConfig) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const stub = {
    getProvisioning: vi.fn(() => new Promise(() => {})),
    listAlerts: vi.fn(() => Promise.resolve({ items: [] })),
    acknowledgeAlert: vi.fn(() => Promise.resolve()),
  } as unknown as EduscopeClient;
  const router = createMemoryRouter(routeObjects, { initialEntries: [path] });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(RuntimeConfigProvider, {
        config: runtime ?? {apiBaseUrl:'/api/v1',quizBaseUrl:'https://quiz.example.edu',environment:'production',deploymentProfile:'production',notices:[],adapters:{default:'real',overrides:{}}},
        children: createElement(ClientContext.Provider, { value: stub }, createElement(AuthProvider, {initialUser: makeUser(), children})),
      }),
    );
  render(createElement(RouterProvider, { router }), { wrapper });
}

describe('PanelShell — header visibility (S-01 §12, S-02 §12)', () => {
  it('renders no header at /login', () => {
    renderAt('/login');
    expect(document.querySelector('.us-header')).toBeNull();
    expect(document.querySelector('.us-notifications')).toBeNull();
  });

  it('renders no header at /login/reset', () => {
    renderAt('/login/reset');
    expect(document.querySelector('.us-header')).toBeNull();
  });

  it.each(['/', '/advanced/library', '/advanced'])('renders a header at %s', (path) => {
    renderAt(path);
    expect(document.querySelector('.us-header')).not.toBeNull();
    expect(document.querySelector('.us-notifications')).not.toBeNull();
    expect(document.querySelector('.us-alertlane')).toBeNull();
  });

  it.each(['/', '/advanced/library', '/login'])('shows demo notice at %s', (path) => {
    renderAt(path,{apiBaseUrl:'/api/v1',quizBaseUrl:'https://quiz.example.edu',environment:'production',deploymentProfile:'demo-staging',notices:['placeholder / firmware acceptance still open'],adapters:{default:'real',overrides:{}}});
    expect(document.querySelector('.us-deployment-notice')?.textContent).toBe('placeholder / firmware acceptance still open');
  });
});
