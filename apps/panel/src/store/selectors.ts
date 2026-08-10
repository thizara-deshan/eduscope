import { useShallow } from 'zustand/react/shallow';
import type { SourceRoleId, SystemAlert } from '@eduscope/shared';
import { useWsStore, type WsState } from './ws-store.js';

/**
 * zustand v5 removed the equality-function argument from the hook. A selector
 * that returns a NEW object — `s => ({ a: s.a, b: s.b })` — therefore compares
 * unequal on every notification and re-renders unconditionally.
 *
 * The rule, in two lines:
 *   - read ONE field  -> use an atomic selector from this file
 *   - read SEVERAL    -> use useWsShallow
 * Never call useWsStore() with no selector, and never return a fresh object or
 * array literal from a bare useWsStore(...).
 */
export const useWsShallow = <T>(selector: (s: WsState) => T): T =>
  useWsStore(useShallow(selector));

// ── atomic selectors ───────────────────────────────────────────────────────
export const useRecordingState = () => useWsStore((s) => s.recording?.state ?? 'idle');
export const useRecordingSession = () => useWsStore((s) => s.recording);
export const useIsStale = () => useWsStore((s) => s.stale);
export const useNeedsResync = () => useWsStore((s) => s.needsResync);
export const useConnectionPhase = () => useWsStore((s) => s.connection?.phase ?? 'connecting');
export const useStoragePressure = () => useWsStore((s) => s.storage?.pressure ?? 'ok');
export const useStorageStatus = () => useWsStore((s) => s.storage);
export const useAiCountdown = () => useWsStore((s) => s.aiCountdown);
export const useAiSet = () => useWsStore((s) => s.aiSet);
export const useQuizSession = () => useWsStore((s) => s.quizSession);
export const useLastSegment = () => useWsStore((s) => s.lastSegment);
export const useExpectedShutdown = () => useWsStore((s) => s.expectedShutdown);
export const useAudioControlRow = (roleId: SourceRoleId) =>
  useWsStore((s) => s.audioControls[roleId]);
export const useAlert = (id: string) => useWsStore((s) => s.alerts[id]);
export const useResponsesEvent = () => useWsStore((s) => s.responses);

/** Object.values(...) is a fresh array every call — useWsShallow keeps it stable across an unrelated ingest. */
export const usePublicationsList = () => useWsShallow((s) => Object.values(s.publications));
/** S-14: live `ai.question` deltas keyed by questionId (a discarded row is pruned in the store). */
export const useQuestionEvents = () => useWsShallow((s) => s.questions);

/** S-21/S-22: live recording.artifact deltas keyed by recordingId. */
export const useArtifactEvents = () => useWsShallow((s) => s.artifacts);
/** S-21/S-35: live upload.job deltas keyed by recordingId. */
export const useUploadJobEvents = () => useWsShallow((s) => s.uploadJobs);
/** S-35: live upload.part deltas keyed by partId. */
export const useUploadPartEvents = () => useWsShallow((s) => s.uploadParts);
/** S-23: live export.job deltas keyed by jobId. */
export const useExportJobEvents = () => useWsShallow((s) => s.exportJobs);
export const useUsbVolumes = () => useWsStore((s) => s.usbVolumes);

/**
 * Keyed reads take the key so the selector returns a stable primitive-or-row
 * reference rather than the whole map, which `ingest` rebuilds by spread.
 */
export const useSourceStatus = (roleId: string) =>
  useWsStore((s) => s.sources[roleId as keyof WsState['sources']]);
export const useChannelStatus = (channelId: string) =>
  useWsStore((s) => s.channels[channelId as keyof WsState['channels']]);

/** S-30/S-36: the live device.health snapshot + when it last arrived (C-3 staleness). */
export const useDeviceHealth = () =>
  useWsShallow((s) => ({ health: s.deviceHealth, healthAt: s.deviceHealthAt }));
/** S-36: uncleared alerts as a stable array (the store prunes cleared rows on ingest). */
export const useAlertsList = (): SystemAlert[] => useWsShallow((s) => Object.values(s.alerts));
/** S-31: latest firmware.state. */
export const useFirmwareState = () => useWsStore((s) => s.firmware);
/** S-34: live log tail. */
export const useLogTail = () => useWsShallow((s) => s.logTail);
