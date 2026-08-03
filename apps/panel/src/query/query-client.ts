import { QueryClient } from '@tanstack/react-query';

/**
 * Request/response only. `staleTime: Infinity` and no refetch interval are
 * deliberate: "No polling anywhere a WS event exists" (events.md §5). Anything
 * that changes over time arrives on events$ and lands in the zustand store.
 */
export const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Number.POSITIVE_INFINITY,
        refetchOnWindowFocus: false,
        refetchInterval: false,
        retry: 1,
      },
      mutations: { retry: 0 },
    },
  });
