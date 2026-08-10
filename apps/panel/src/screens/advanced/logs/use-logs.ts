import { useInfiniteQuery } from '@tanstack/react-query';
import type { LogCategory, LogEntry, LogLevel } from '@eduscope/shared';
import { useClient } from '../../../client/client-provider.js';
import { useIsStale, useLogTail } from '../../../store/selectors.js';

export interface LogFilter {
  readonly level?: LogLevel;
  readonly category?: LogCategory;
  readonly q?: string;
  readonly from?: string;
  readonly to?: string;
  readonly sessionId?: string;
}

const LOGS_KEY = (filter: LogFilter) => ['logs', filter] as const;

export interface UseLogs {
  readonly loading: boolean;
  readonly logs: readonly LogEntry[];
  readonly hasMore: boolean;
  loadMore(): void;
  /** U-2 — the live tail is marked stale but the query still returns rows. */
  readonly tailStale: boolean;
}

function matchesFilter(entry: LogEntry, filter: LogFilter): boolean {
  if (filter.level && entry.level !== filter.level) return false;
  if (filter.category && entry.category !== filter.category) return false;
  if (filter.sessionId && entry.sessionId !== filter.sessionId) return false;
  if (filter.q && !entry.message.toLowerCase().includes(filter.q.toLowerCase())) return false;
  if (filter.from && entry.at < filter.from) return false;
  if (filter.to && entry.at > filter.to) return false;
  return true;
}

/** S-34 — queryLogs (cursor-paginated, newest first) merged with the live log.entry tail. */
export function useLogs(filter: LogFilter): UseLogs {
  const client = useClient();
  const tail = useLogTail();
  const tailStale = useIsStale();

  const query = useInfiniteQuery({
    queryKey: LOGS_KEY(filter),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) => client.queryLogs({
      ...filter,
      ...(pageParam !== undefined && { cursor: pageParam }),
    }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const base = (query.data?.pages ?? []).flatMap((page) => page.items);
  const liveMatches = tail.filter((e) => matchesFilter(e, filter));

  const byId = new Map(base.map((l) => [l.id, l] as const));
  for (const l of liveMatches) byId.set(l.id, l);
  const logs = [...byId.values()].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  return {
    loading: query.isPending,
    logs,
    hasMore: query.hasNextPage ?? false,
    loadMore: () => { void query.fetchNextPage(); },
    tailStale,
  };
}
