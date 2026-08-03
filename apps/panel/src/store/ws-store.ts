import { create } from 'zustand';
import type { ConnectionStatus } from '@eduscope/api-client';
import type {
  AiCountdownPayload, AiSetPayload, ChannelStatePayload, DeviceHealthPayload,
  EventEnvelope, QuizPublicationPayload, QuizSessionPayload, RecordingStatePayload,
  SourcesStatusPayload, StorageStatusPayload, SystemAlert,
} from '@eduscope/shared';
import { hasSeqGap, isStale } from './connection.js';
import { useTelemetryStore } from './telemetry-store.js';

export { useTelemetryStore };

/**
 * Slices are TYPED FROM THE CONTRACT. Tasks 2–4 exist to produce these payload
 * types; storing them as `unknown` would push a cast into all 42 screens and
 * defeat the narrowing (`recording.state === 'recording'`) they are built on.
 */
export interface WsState {
  recording: RecordingStatePayload | null;
  sources: Partial<Record<SourcesStatusPayload['roleId'], SourcesStatusPayload>>;
  channels: Partial<Record<ChannelStatePayload['channelId'], ChannelStatePayload>>;
  storage: StorageStatusPayload | null;
  deviceHealth: DeviceHealthPayload | null;
  aiCountdown: AiCountdownPayload | null;
  aiSet: AiSetPayload | null;
  quizSession: QuizSessionPayload | null;
  publications: Record<string, QuizPublicationPayload>;
  alerts: Record<string, SystemAlert>;

  connection: ConnectionStatus | null;
  /** events.md §1: a gap forces a full snapshot re-request, never a patch. */
  needsResync: boolean;
  /** U-2: disconnected longer than T-WS-STALE — dim live regions. */
  stale: boolean;

  ingest(envelope: EventEnvelope): void;
  setConnection(status: ConnectionStatus): void;
  clearResync(): void;
  reset(): void;
}

const EMPTY = {
  recording: null, sources: {}, channels: {}, storage: null, deviceHealth: null,
  aiCountdown: null, aiSet: null, quizSession: null, publications: {}, alerts: {},
  connection: null, needsResync: false, stale: false,
} satisfies Omit<WsState, 'ingest' | 'setConnection' | 'clearResync' | 'reset'>;

/**
 * WS-fed application state. Separate from TanStack Query: query owns
 * request/response, this owns the push channel (frontend-conventions §1).
 *
 * There is no outbound queue by design — "commands are never queued and
 * replayed; a stop tapped five minutes ago must not fire on reconnect"
 * (state-machines §5.5).
 */
export const useWsStore = create<WsState>((set, get) => ({
  ...EMPTY,

  ingest(envelope) {
    // Telemetry short-circuits BEFORE any set() on this store, so 10 Hz levels
    // never notify a UI subscriber.
    if (envelope.event === 'audio.levels') {
      const t = useTelemetryStore.getState();
      t.setLevel(envelope.payload.roleId, envelope.payload.rms);
      t.setLastSeq(envelope.seq);
      return;
    }

    const { lastSeq } = useTelemetryStore.getState();
    useTelemetryStore.getState().setLastSeq(envelope.seq);
    const gap = hasSeqGap(lastSeq, envelope); // U-3, see store/connection.ts

    // ONE set() per envelope: every extra set is another full notification pass
    // over every registered selector.
    const patch = ((): Partial<WsState> => {
      switch (envelope.event) {
        case 'recording.state': return { recording: envelope.payload };
        case 'sources.status':
          return { sources: { ...get().sources, [envelope.payload.roleId]: envelope.payload } };
        case 'channel.state':
          return { channels: { ...get().channels, [envelope.payload.channelId]: envelope.payload } };
        case 'storage.status': return { storage: envelope.payload };
        case 'device.health': return { deviceHealth: envelope.payload };
        case 'ai.countdown': return { aiCountdown: envelope.payload };
        case 'ai.set': return { aiSet: envelope.payload };
        case 'quiz.session': return { quizSession: envelope.payload };
        case 'quiz.publication': {
          const next = { ...get().publications };
          // Bounded: a closed, unprojected publication is history, and history
          // lives in the library — not in a store on a device that runs for weeks.
          next[envelope.payload.publicationId] = envelope.payload;
          for (const [id, p] of Object.entries(next)) {
            if (p.state === 'closed' && p.projectorState === 'withdrawn') delete next[id];
          }
          return { publications: next };
        }
        case 'system.alert': {
          const next = { ...get().alerts };
          // INV-SA-1 re-raises a still-true condition every 30 s; a source that
          // flaps for a week would otherwise grow this map without bound.
          if (envelope.payload.clearedAt) delete next[envelope.payload.id];
          else next[envelope.payload.id] = envelope.payload;
          return { alerts: next };
        }
        default:
          return {}; // catalog events with no slice yet (log.entry, upload.*, …)
      }
    })();

    if (gap) set({ ...patch, needsResync: true });
    else if (Object.keys(patch).length > 0) set(patch);
  },

  setConnection(status) {
    // U-2: dim live regions, KEEP the recording slice — see store/connection.ts.
    set({ connection: status, stale: isStale(status) });
  },

  clearResync() {
    set({ needsResync: false });
    useTelemetryStore.getState().setLastSeq(-1);
  },

  reset() {
    set({ ...EMPTY });
    useTelemetryStore.getState().reset();
  },
}));
