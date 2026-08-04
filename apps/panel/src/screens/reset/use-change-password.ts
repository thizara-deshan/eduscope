import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { TIMERS } from '@eduscope/shared';
import type { AuthMessageValue } from '../../auth/auth-message.js';
import { asProblem, isTransportFailure } from '../../auth/session.js';
import { clearTokens } from '../../auth/token-store.js';
import { useAuth } from '../../auth/auth-context.js';
import { useClient } from '../../client/client-provider.js';
import { meetsPolicy } from './password-policy.js';

export type ResetState =
  | { phase: 'validating' }
  | { phase: 'mismatch' }
  | { phase: 'submitting' }
  | { phase: 'rejected-current' }
  | { phase: 'rejected-policy' }
  | { phase: 'unreachable' }
  | { phase: 'success' };

export interface UseChangePassword {
  readonly state: ResetState;
  readonly message: AuthMessageValue;
  readonly canSubmit: boolean;
  submit(): void;
  signOut(): void;
}

const COPY = {
  mismatch: 'The two new passwords do not match.',
  'rejected-current': 'Your current password is not correct.',
  'rejected-policy': 'That password does not meet the requirements above.',
} as const;

function messageFor(state: ResetState): AuthMessageValue {
  switch (state.phase) {
    case 'mismatch':
      return { kind: 'error', text: COPY.mismatch };
    case 'rejected-current':
      return { kind: 'error', text: COPY['rejected-current'] };
    case 'rejected-policy':
      return { kind: 'error', text: COPY['rejected-policy'] };
    case 'unreachable':
      return { kind: 'info', text: 'The recording panel is starting up. Trying again…' };
    default:
      return null;
  }
}

/**
 * `values` come in as a prop, same reasoning as `use-login`'s `credentials`
 * (Task 6): it is what lets `canSubmit` and the derived `validating`/
 * `mismatch` phases react to every keystroke without this hook tracking the
 * three fields itself (S-02 §4: the screen owns the fields).
 */
export function useChangePassword(
  values: { currentPassword: string; newPassword: string; confirm: string },
): UseChangePassword {
  const client = useClient();
  const { setUser } = useAuth();
  const [submissionState, setSubmissionState] = useState<ResetState | null>(null);
  const ceilingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const valuesRef = useRef(values);
  valuesRef.current = values;

  const mutation = useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) =>
      client.changePassword(body),
  });
  const { mutate } = mutation;

  useEffect(() => () => clearTimeout(ceilingTimer.current), []);

  const submit = useCallback(() => {
    setSubmissionState({ phase: 'submitting' });
    let settled = false;
    clearTimeout(ceilingTimer.current);
    // U-4: no indefinite spinners anywhere.
    ceilingTimer.current = setTimeout(() => {
      if (settled) return;
      settled = true;
      setSubmissionState({ phase: 'unreachable' });
    }, TIMERS['T-CMD-RESOLVE']);

    const { currentPassword, newPassword } = valuesRef.current;
    mutate(
      { currentPassword, newPassword },
      {
        async onSuccess() {
          if (settled) return;
          settled = true;
          clearTimeout(ceilingTimer.current);
          // C-2/S02-D-7: 204 has no body — mustResetPassword is only
          // observable by re-reading getMe. A stale flag must NOT report
          // success: navigating would send the user straight back here via
          // require-role.tsx's redirect (the infinite-loop regression S-02
          // §13 names).
          const me = await client.getMe();
          setUser(me);
          setSubmissionState(me.mustResetPassword ? { phase: 'unreachable' } : { phase: 'success' });
        },
        onError(error) {
          if (settled) return;
          settled = true;
          clearTimeout(ceilingTimer.current);
          if (isTransportFailure(error)) {
            setSubmissionState({ phase: 'unreachable' });
            return;
          }
          const problem = asProblem(error);
          if (problem?.code === 'auth.invalid-credentials') {
            setSubmissionState({ phase: 'rejected-current' });
            return;
          }
          setSubmissionState({ phase: 'rejected-policy' });
        },
      },
    );
  }, [client, mutate, setUser]);

  const signOut = useCallback(() => {
    void client.logout().then(() => {
      clearTokens();
      setUser(null);
    });
  }, [client, setUser]);

  const derived: ResetState =
    values.confirm.length > 0 && values.newPassword !== values.confirm
      ? { phase: 'mismatch' }
      : { phase: 'validating' };
  const state = submissionState ?? derived;

  const canSubmit =
    values.currentPassword.trim() !== '' &&
    meetsPolicy(values.newPassword, values.confirm) &&
    state.phase !== 'submitting' &&
    state.phase !== 'success';

  return { state, message: messageFor(state), canSubmit, submit, signOut };
}
