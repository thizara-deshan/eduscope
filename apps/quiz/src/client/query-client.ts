import { QueryClient } from '@tanstack/react-query';

/** One app-lifetime client: commands are server-authoritative, not polled. */
export function createQuizQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  });
}
