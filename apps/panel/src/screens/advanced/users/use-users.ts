import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { User, UserCreate, UserRole, UserUpdate } from '@eduscope/shared';
import { useClient } from '../../../client/client-provider.js';

const USERS_KEY = (q: string, role: UserRole | undefined) => ['users', { q, role }] as const;

export interface UseUsers {
  readonly loading: boolean;
  readonly users: readonly User[];
  readonly hasMore: boolean;
  loadMore(): void;
  createUser(body: UserCreate): Promise<User>;
  updateUser(userId: string, body: UserUpdate): Promise<User>;
  deleteUser(userId: string): Promise<void>;
}

/** S-32 — cursor-paginated listUsers({cursor, limit, q, role}); create/update/delete invalidate the list. No WS. */
export function useUsers(filter: { q: string; role: UserRole | undefined }): UseUsers {
  const client = useClient();
  const queryClient = useQueryClient();
  const key = USERS_KEY(filter.q, filter.role);

  const query = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }: { pageParam: string | undefined }) => client.listUsers({
      ...(pageParam !== undefined && { cursor: pageParam }),
      ...(filter.q ? { q: filter.q } : {}),
      ...(filter.role ? { role: filter.role } : {}),
    }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const invalidateAll = () => void queryClient.invalidateQueries({ queryKey: ['users'] });

  const createMutation = useMutation({
    mutationFn: (body: UserCreate) => client.createUser(body),
    onSuccess: invalidateAll,
  });
  const updateMutation = useMutation({
    mutationFn: ({ userId, body }: { userId: string; body: UserUpdate }) => client.updateUser(userId, body),
    onSuccess: invalidateAll,
  });
  const deleteMutation = useMutation({
    mutationFn: (userId: string) => client.deleteUser(userId),
    onSuccess: invalidateAll,
  });

  const users = (query.data?.pages ?? []).flatMap((page) => page.items);

  return {
    loading: query.isPending,
    users,
    hasMore: query.hasNextPage ?? false,
    loadMore: () => { void query.fetchNextPage(); },
    createUser: (body) => createMutation.mutateAsync(body),
    updateUser: (userId, body) => updateMutation.mutateAsync({ userId, body }),
    deleteUser: (userId) => deleteMutation.mutateAsync(userId),
  };
}
