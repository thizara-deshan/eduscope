'use client';

import { useState, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { QuizClientProvider } from '../client/quiz-client-provider.js';
import { createQuizQueryClient } from '../client/query-client.js';
import { QuizScenarioOverlay } from '../devtools/quiz-scenario-overlay.js';

/**
 * The overlay only ever does anything against a mock client (W7-D-5: no real
 * adapter exists yet), so it ships exactly when the mock does — this is the
 * same adapter-selection gate apps/panel uses, kept ready for the day a real
 * adapter lands here too.
 */
const MOCK_ADAPTER = process.env.NEXT_PUBLIC_EDUSCOPE_REAL_API !== '1';

export function QuizAppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQuizQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <QuizClientProvider>
        {children}
        {MOCK_ADAPTER && <QuizScenarioOverlay />}
      </QuizClientProvider>
    </QueryClientProvider>
  );
}
