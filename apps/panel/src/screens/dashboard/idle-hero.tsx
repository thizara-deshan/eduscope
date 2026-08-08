import type { UserRole } from '@eduscope/shared';
import type { StartState } from './use-start-recording.js';
import { StartRefusal } from './start-refusal.js';
import './dashboard.css';

export function greetingFor(now: Date): string {
  const hour = now.getHours();
  if (hour < 12) return 'Good morning,';
  if (hour < 17) return 'Good afternoon,';
  return 'Good evening,';
}

interface IdleHeroProps {
  readonly name: string;
  readonly userRole: UserRole | null;
  readonly state: StartState;
  readonly onStart: () => void;
  readonly onDismiss: () => void;
}

export function IdleHero({ name, userRole, state, onStart, onDismiss }: IdleHeroProps) {
  if (state.kind === 'failed') {
    return (
      <div className="us-hero">
        <section className="us-hero__failure" role="alert">
          <h1>Recording did not start</h1>
          <p>{state.message}</p>
          <button type="button" onClick={onStart}>Try Again</button>
        </section>
      </div>
    );
  }

  const pending = state.kind === 'starting';
  const disabled = state.kind !== 'ready';
  const reason = state.kind === 'holding'
    ? state.reason === 'recovery' ? 'Checking the previous session' : 'Checking recording status'
    : state.kind === 'offline'
      ? 'Not connected'
      : null;

  return (
    <div className="us-hero">
      <p className="us-hero__greeting">{greetingFor(new Date())}</p>
      <h1 className="us-hero__name">{name}</h1>
      <button className="us-hero__start" type="button" disabled={disabled} onClick={onStart}>
        <span className="us-hero__startdot" aria-hidden="true" />
        {pending ? 'Starting…' : 'Start Recording'}
      </button>
      <div className="us-hero__reason" aria-live="polite">
        {state.kind === 'refused' ? <StartRefusal problem={state.problem} role={userRole} /> : reason}
      </div>
      {state.kind === 'refused' ? (
        <button type="button" className="us-hero__dismiss" onClick={onDismiss}>Dismiss</button>
      ) : null}
    </div>
  );
}
