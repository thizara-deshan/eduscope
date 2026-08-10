'use client';

import { useState, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { QuizClientProvider } from '../client/quiz-client-provider.js';
import { createQuizQueryClient } from '../client/query-client.js';

export function QuizAppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQuizQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <QuizClientProvider>{children}</QuizClientProvider>
    </QueryClientProvider>
  );
}
