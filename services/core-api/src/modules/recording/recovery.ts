import type { Clock } from '../../lib/clock.js';
import type { DomainBus } from '../../lib/domain-bus.js';
import type { PipelineManagerClient } from './pm/client.js';

export interface EosOutcome {
  /** True iff `evt.pm.consumer.eos` arrived before the local timeout — false means the local wait simply gave up (R-09/R-13); pipeline-manager's own EOS-wait-then-SIGKILL (pipeline-manager.md §3.2) is what actually ends the process. */
  graceful: boolean;
}

export interface EosRaceDeps {
  bus: DomainBus;
  clock: Clock;
}

/**
 * R-08/R-09 and R-12/R-13's shared shape: send `{mode:'eos', timeoutMs}` to
 * the running record consumer, then race pipeline-manager's
 * `evt.pm.consumer.eos` (filtered by `consumerId`) against the same local
 * `timeoutMs` window. A failed/rejected stop request still falls through to
 * the race — no `eos` will ever arrive for it, so the timeout resolves
 * `graceful: false` on its own.
 */
export async function stopConsumerWithEosRace(
  deps: EosRaceDeps,
  pm: PipelineManagerClient,
  consumerId: string,
  timeoutMs: number,
): Promise<EosOutcome> {
  try {
    await pm.stopConsumer(consumerId, { mode: 'eos', timeoutMs });
  } catch {
    // Unreachable/rejected — fall through; the race below resolves via timeout since no eos will ever arrive.
  }

  const controller = new AbortController();
  let settled = false;

  return new Promise<EosOutcome>((resolve) => {
    const finish = (graceful: boolean): void => {
      if (settled) return;
      settled = true;
      unsubscribe();
      controller.abort();
      resolve({ graceful });
    };

    const unsubscribe = deps.bus.subscribe('evt.pm.consumer.eos', (payload) => {
      if (payload.consumerId !== consumerId) return;
      finish(true);
    });

    deps.clock.sleep(timeoutMs, controller.signal).then(() => {
      if (controller.signal.aborted) return; // already resolved by the eos event, not a genuine timeout
      finish(false);
    });
  });
}
