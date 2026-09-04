import { create } from 'zustand';
import type { ConnectionStatus } from '@eduscope/api-client';
import type {
  AiCountdownPayload, AiQuestionPayload, AiSetPayload, AudioControlPayload, ChannelStatePayload,
  DeviceHealthPayload, EventEnvelope, ExportJobPayload, FirmwareUpdate, LogEntry,
  QuizPublicationPayload, QuizResponsesPayload,
  QuizSessionPayload, RecordingArtifactPayload, RecordingSegmentPayload, RecordingStatePayload,
  SourceRoleId, SourcesStatusPayload, StorageStatusPayload, SystemAlert, UploadJobPayload,
  UploadPartPayload, UsbVolumesPayload,
} from '@eduscope/shared';
import type { AdapterDomain } from '@eduscope/api-client';
import { DOMAIN_SLICE_KEYS, hasSeqGap, isStale } from './connection.js';
import { useTelemetryStore } from './telemetry-store.js';

export { useTelemetryStore };

/**
 * Slices are TYPED FROM THE CONTRACT. Tasks 2–4 exist to produce these payload
 * types; storing them as `unknown` would push a cast into all 42 screens and
 * defeat the narrowing (`recording.state === 'recording'`) they are built on.
 */
export interface WsState {
  recording: RecordingStatePayload | null;
  audioControls: Partial<Record<SourceRoleId, AudioControlPayload>>;
  lastSegment: RecordingSegmentPayload | null;
  expectedShutdown: boolean;
  sources: Partial<Record<SourcesStatusPayload['roleId'], SourcesStatusPayload>>;
  channels: Partial<Record<ChannelStatePayload['channelId'], ChannelStatePayload>>;
  storage: StorageStatusPayload | null;
  deviceHealth: DeviceHealthPayload | null;
  aiCountdown: AiCountdownPayload | null;
  aiSet: AiSetPayload | null;
  /** S-14: keyed by questionId; a `discarded` row is pruned (INV-Q — a discarded draft leaves the list). */
  questions: Record<string, AiQuestionPayload>;
  quizSession: QuizSessionPayload | null;
  publications: Record<string, QuizPublicationPayload>;
  /** S-17: the latest `quiz.responses` batch — the leaderboard hook folds its deltas incrementally, never stores ranks (INV-LB-1). */
  responses: QuizResponsesPayload | null;
  alerts: Record<string, SystemAlert>;
  /** S-21/S-22: live recording.artifact keyed by recordingId (merge/ready/failed/deleted). */
  artifacts: Record<string, RecordingArtifactPayload>;
  /** S-21/S-35: live upload.job keyed by recordingId (one job per recording, INV-UJ-1). */
  uploadJobs: Record<string, UploadJobPayload>;
  /** S-35: live upload.part keyed by partId (expanded rows). */
  uploadParts: Record<string, UploadPartPayload>;
  /** S-23: live export.job keyed by jobId. */
  exportJobs: Record<string, ExportJobPayload>;
  /** S-23: the latest session-scoped usb.volumes list (CG-3). */
  usbVolumes: UsbVolumesPayload | null;
  /** S-31: latest firmware.state full read view. */
  firmware: FirmwareUpdate | null;
  /** S-34: bounded live-tail ring (newest last, max 200). */
  logTail: LogEntry[];
  /** S-36 C-3: wall-clock of the last device.health, for T-HEALTH-STALE staleness. */
  deviceHealthAt: number | null;

  connection: ConnectionStatus | null;
  /** events.md §1: a gap forces a full snapshot re-request, never a patch. */
  needsResync: boolean;
  /** U-2: disconnected longer than T-WS-STALE — dim live regions. */
  stale: boolean;

  ingest(envelope: EventEnvelope): void;
  setConnection(status: ConnectionStatus): void;
  setExpectedShutdown(value: boolean): void;
  clearResync(): void;
  /**
   * E-03: a `seq` gap on the real socket resets ONLY the given domains' slices,
   * in ONE update, and resets the sequence tracker before the replacement
   * snapshot arrives. The recording chrome is retained (marked stale), never a
   * command replayed, and mock-domain state is untouched.
   */
  resetDomains(domains: readonly AdapterDomain[]): void;
  reset(): void;
}

const EMPTY = {
  recording: null, audioControls: {}, lastSegment: null, expectedShutdown: false,
  sources: {}, channels: {}, storage: null, deviceHealth: null,
  aiCountdown: null, aiSet: null, questions: {}, quizSession: null, publications: {}, responses: null, alerts: {},
  artifacts: {}, uploadJobs: {}, uploadParts: {}, exportJobs: {}, usbVolumes: null,
  firmware: null, logTail: [], deviceHealthAt: null,
  connection: null, needsResync: false, stale: false,
} satisfies Omit<
  WsState,
  | 'ingest'
  | 'setConnection'
  | 'setExpectedShutdown'
  | 'clearResync'
  | 'resetDomains'
  | 'reset'
>;

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
        case 'audio.control':
          return {
            audioControls: {
              ...get().audioControls,
              [envelope.payload.roleId]: envelope.payload,
            },
          };
        // `lastSegment` means the most recently CLOSED segment. Replacing a
        // crash row immediately with R-17's new capturing row erased S-07's
        // continuity marker before React could render it.
        case 'recording.segment':
          return envelope.payload.state === 'capturing'
            ? {}
            : { lastSegment: envelope.payload };
        case 'sources.status':
          return { sources: { ...get().sources, [envelope.payload.roleId]: envelope.payload } };
        case 'channel.state':
          return { channels: { ...get().channels, [envelope.payload.channelId]: envelope.payload } };
        case 'storage.status': return { storage: envelope.payload };
        case 'device.health':
          return { deviceHealth: envelope.payload, deviceHealthAt: Date.now() };
        case 'firmware.state': return { firmware: envelope.payload };
        case 'log.entry': {
          const next = [...get().logTail, envelope.payload];
          if (next.length > 200) next.splice(0, next.length - 200);
          return { logTail: next };
        }
        case 'ai.countdown': return { aiCountdown: envelope.payload };
        case 'ai.set': return { aiSet: envelope.payload };
        // Keeps `discarded` rows in the map (not pruned) — a consumer merging
        // this against a REST snapshot needs the discard signal itself to
        // filter the row out; deleting it here would make that delta invisible.
        case 'ai.question': {
          return { questions: { ...get().questions, [envelope.payload.questionId]: envelope.payload } };
        }
        case 'quiz.session': return { quizSession: envelope.payload };
        case 'quiz.responses': return { responses: envelope.payload };
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
        case 'recording.artifact':
          return { artifacts: { ...get().artifacts, [envelope.payload.recordingId]: envelope.payload } };
        case 'upload.job':
          return { uploadJobs: { ...get().uploadJobs, [envelope.payload.recordingId]: envelope.payload } };
        case 'upload.part':
          return { uploadParts: { ...get().uploadParts, [envelope.payload.partId]: envelope.payload } };
        case 'export.job':
          return { exportJobs: { ...get().exportJobs, [envelope.payload.jobId]: envelope.payload } };
        case 'usb.volumes':
          return { usbVolumes: envelope.payload };
        default:
          return {}; // catalog events with no slice yet (log.entry, upload.*, …)
      }
    })();

    if (gap) set({ ...patch, needsResync: true });
    else if (Object.keys(patch).length > 0) set(patch);
  },

  setConnection(status) {
    // U-2: dim live regions, KEEP the recording slice — see store/connection.ts.
    set({ connection: status, stale: isStale(status, get().expectedShutdown) });
  },

  setExpectedShutdown(value) {
    set({ expectedShutdown: value, stale: value ? false : get().stale });
  },

  clearResync() {
    set({ needsResync: false });
    useTelemetryStore.getState().setLastSeq(-1);
  },

  resetDomains(domains) {
    const patch: Partial<WsState> = {};
    for (const domain of domains) {
      for (const key of DOMAIN_SLICE_KEYS[domain]) {
        (patch as Record<string, unknown>)[key] = (EMPTY as Record<string, unknown>)[key];
      }
    }
    // The recording chrome is retained but marked stale; the device keeps
    // recording whether or not the panel can see it (see store/connection.ts).
    if (domains.includes('recording')) patch.stale = true;
    // The gap is being handled here, not by a partial patch on the next frame.
    patch.needsResync = false;
    set(patch);
    // Reset the sequence tracker before the fresh subscribe snapshot streams in.
    useTelemetryStore.getState().setLastSeq(-1);
  },

  reset() {
    set({ ...EMPTY });
    useTelemetryStore.getState().reset();
  },
}));
