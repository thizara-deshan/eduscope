'use client';

import { lazy, Suspense, useState, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { resolveSelection } from '@eduscope/api-client';
import { QuizClientProvider } from '../client/quiz-client-provider.js';
import { createQuizQueryClient } from '../client/query-client.js';
import { RuntimeConfigProvider, useRuntimeConfig } from '../config/runtime-config.js';

/**
 * The overlay only ever does anything against a mock client, so runtime
 * `studentQuiz` selection gates both its render and its lazy-loaded chunk.
 */
const QuizScenarioOverlay = lazy(() =>
  import('../devtools/quiz-scenario-overlay.js').then((module) => ({
    default: module.QuizScenarioOverlay,
  })),
);

function DevOverlaySlot() {
  const selection = resolveSelection(useRuntimeConfig());
  if (selection.studentQuiz !== 'mock') return null;
  return <Suspense fallback={null}><QuizScenarioOverlay /></Suspense>;
}

export function QuizAppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQuizQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <RuntimeConfigProvider>
        <QuizClientProvider>
          {children}
          <DevOverlaySlot />
        </QuizClientProvider>
      </RuntimeConfigProvider>
    </QueryClientProvider>
  );
}
