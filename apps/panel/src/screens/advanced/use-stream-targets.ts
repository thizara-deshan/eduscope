import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Problem, StreamTarget, StreamTargetCreate, StreamTargetUpdate, Ulid,
} from '@eduscope/shared';
import { useAuth } from '../../auth/auth-context.js';
import { asProblem } from '../../auth/session.js';
import { useClient } from '../../client/client-provider.js';

export const STREAM_TARGETS_QUERY_KEY = ['stream-targets'] as const;

export type MutationPhase = 'idle' | 'saving' | 'applied' | 'refused';

export interface UseStreamTargets {
  /** Admin-only (x-required-role: admin) — a lecturer never calls listStreamTargets. */
  readonly enabled: boolean;
  readonly targets: StreamTarget[];
  readonly loading: boolean;
  readonly phase: MutationPhase;
  readonly problem: Problem | null;
  create(body: StreamTargetCreate): void;
  update(targetId: Ulid, body: StreamTargetUpdate): void;
  remove(targetId: Ulid): void;
  reset(): void;
}

/** Admin-only list/create/update/delete for `/settings/stream-targets`, with REST-response cache updates (frontend-conventions §1). */
export function useStreamTargets(): UseStreamTargets {
  const client = useClient();
  const queryClient = useQueryClient();
  const { role } = useAuth();
  const enabled = role === 'admin';
  const [phase, setPhase] = useState<MutationPhase>('idle');
  const [problem, setProblem] = useState<Problem | null>(null);

  const listQuery = useQuery({
    queryKey: STREAM_TARGETS_QUERY_KEY,
    queryFn: () => client.listStreamTargets(),
    enabled,
  });

  const createMutation = useMutation({
    mutationFn: (body: StreamTargetCreate) => client.createStreamTarget(body),
    onSuccess: (target) => {
      setPhase('applied');
      setProblem(null);
      queryClient.setQueryData(STREAM_TARGETS_QUERY_KEY, (rows: StreamTarget[] | undefined) => [
        ...(rows ?? []), target,
      ]);
    },
    onError: (error: unknown) => {
      setPhase('refused');
      setProblem(asProblem(error));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ targetId, body }: { targetId: Ulid; body: StreamTargetUpdate }) =>
      client.updateStreamTarget(targetId, body),
    onSuccess: (target) => {
      setPhase('applied');
      setProblem(null);
      queryClient.setQueryData(
        STREAM_TARGETS_QUERY_KEY,
        (rows: StreamTarget[] | undefined) => rows?.map((r) => (r.id === target.id ? target : r)),
      );
    },
    onError: (error: unknown) => {
      setPhase('refused');
      setProblem(asProblem(error));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (targetId: Ulid) => client.deleteStreamTarget(targetId),
    onSuccess: (_void, targetId) => {
      setPhase('applied');
      setProblem(null);
      queryClient.setQueryData(
        STREAM_TARGETS_QUERY_KEY,
        (rows: StreamTarget[] | undefined) => rows?.filter((r) => r.id !== targetId),
      );
    },
    onError: (error: unknown) => {
      setPhase('refused');
      setProblem(asProblem(error));
    },
  });

  const create = useCallback((body: StreamTargetCreate) => {
    setPhase('saving');
    setProblem(null);
    createMutation.mutate(body);
  }, [createMutation]);

  const update = useCallback((targetId: Ulid, body: StreamTargetUpdate) => {
    setPhase('saving');
    setProblem(null);
    updateMutation.mutate({ targetId, body });
  }, [updateMutation]);

  const remove = useCallback((targetId: Ulid) => {
    setPhase('saving');
    setProblem(null);
    deleteMutation.mutate(targetId);
  }, [deleteMutation]);

  const reset = useCallback(() => {
    setPhase('idle');
    setProblem(null);
  }, []);

  return {
    enabled,
    targets: listQuery.data ?? [],
    loading: enabled && !listQuery.data,
    phase,
    problem,
    create,
    update,
    remove,
    reset,
  };
}
