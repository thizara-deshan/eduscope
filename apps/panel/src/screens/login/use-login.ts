import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { TIMERS, WS_RECONNECT_BACKOFF_MS, type User } from '@eduscope/shared';
import type { AuthMessageValue } from '../../auth/auth-message.js';
import { asProblem, isTransportFailure } from '../../auth/session.js';
import { setTokens } from '../../auth/token-store.js';
import { useAuth } from '../../auth/auth-context.js';
import { useClient } from '../../client/client-provider.js';

export type LoginState =
  | { phase: 'empty' }
  | { phase: 'submitting' }
  | { phase: 'rejected' }
  | { phase: 'disabled' }
  | { phase: 'unreachable'; attempt: number }
  | { phase: 'must-reset' }
  | { phase: 'success'; user: User };

export interface UseLogin {
  readonly state: LoginState;
  readonly message: AuthMessageValue;
  readonly canSubmit: boolean;
  submit(): void;
}

const COPY = {
  rejected: 'That username and password do not match. Try again.',
  disabled: 'This account is not active — ask your administrator.',
  unreachable: 'The recording panel is starting up. Trying again…',
} as const;

function messageFor(state: LoginState): AuthMessageValue {
  switch (state.phase) {
    case 'rejected':
      return { kind: 'error', text: COPY.rejected };
    case 'disabled':
      return { kind: 'warning', text: COPY.disabled };
    case 'unreachable':
      return { kind: 'info', text: COPY.unreachable };
    default:
      return null;
  }
}

const BUSY_PHASES = new Set<LoginState['phase']>([
  'submitting', 'unreachable', 'must-reset', 'success',
]);

/**
 * `credentials` come in as a prop (screen owns the fields, S-01 §4) rather
 * than being read once at submit time: it is what lets `canSubmit` react to
 * every keystroke without this hook tracking blank/filled itself, and it is
 * always the LATEST value at the moment a scheduled retry actually fires
 * (read through `credentialsRef`, never captured in a timer's closure).
 */
export function useLogin(credentials: { username: string; password: string }): UseLogin {
  const client = useClient();
  const { setUser } = useAuth();
  const [state, setState] = useState<LoginState>({ phase: 'empty' });
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const ceilingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const credentialsRef = useRef(credentials);
  credentialsRef.current = credentials;

  const mutation = useMutation({
    mutationFn: (creds: { username: string; password: string }) =>
      client.login({ ...creds, client: 'panel' }),
  });
  const { mutate } = mutation;

  const clearTimers = useCallback(() => {
    clearTimeout(retryTimer.current);
    clearTimeout(ceilingTimer.current);
  }, []);

  // Every scheduled timer is cleared on unmount — a retry that fires after
  // the screen has navigated away is a bug (S-01 §5).
  useEffect(() => clearTimers, [clearTimers]);

  // `scheduleRetry` and `attemptLogin` are mutually recursive (a retry
  // re-attempts, and a fresh transport failure schedules another retry).
  // `attemptLoginRef` breaks the cycle: `scheduleRetry` stays a stable
  // identity while always invoking whatever `attemptLogin` closure is
  // current at the moment its setTimeout actually fires.
  const attemptLoginRef = useRef<(failCount: number) => void>(() => {});

  const scheduleRetry = useCallback((failCount: number) => {
    const attempt = failCount + 1;
    setState({ phase: 'unreachable', attempt });
    const delayMs = WS_RECONNECT_BACKOFF_MS[Math.min(attempt - 1, WS_RECONNECT_BACKOFF_MS.length - 1)];
    retryTimer.current = setTimeout(() => attemptLoginRef.current(attempt), delayMs);
  }, []);

  const attemptLogin = useCallback(
    (failCount: number) => {
      setState({ phase: 'submitting' });
      let settled = false;
      clearTimeout(ceilingTimer.current);
      // U-4: no indefinite spinners anywhere — this 10s ceiling is a client
      // ceiling on a REST call, not the (nonexistent) T-CMD-RESOLVE 202 flow.
      ceilingTimer.current = setTimeout(() => {
        if (settled) return;
        settled = true;
        scheduleRetry(failCount);
      }, TIMERS['T-CMD-RESOLVE']);

      mutate(credentialsRef.current, {
        onSuccess(res) {
          if (settled) return;
          settled = true;
          clearTimeout(ceilingTimer.current);
          setTokens(res.tokens);
          setUser(res.user);
          setState(res.mustResetPassword ? { phase: 'must-reset' } : { phase: 'success', user: res.user });
        },
        onError(error) {
          if (settled) return;
          settled = true;
          clearTimeout(ceilingTimer.current);
          if (isTransportFailure(error)) {
            scheduleRetry(failCount);
            return;
          }
          const problem = asProblem(error);
          setState({ phase: problem?.code === 'auth.account-disabled' ? 'disabled' : 'rejected' });
        },
      });
    },
    [mutate, scheduleRetry, setUser],
  );
  attemptLoginRef.current = attemptLogin;

  const submit = useCallback(() => {
    clearTimers();
    attemptLogin(0);
  }, [clearTimers, attemptLogin]);

  const bothFilled = credentials.username.trim() !== '' && credentials.password.trim() !== '';

  return {
    state,
    message: messageFor(state),
    canSubmit: bothFilled && !BUSY_PHASES.has(state.phase),
    submit,
  };
}
