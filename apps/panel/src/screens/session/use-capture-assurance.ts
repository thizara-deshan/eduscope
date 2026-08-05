import type {
  ChannelId, ChannelStatePayload, RecordingStatePayload, SourceRoleId,
  SourcesStatusPayload, StorageStatusPayload, SystemAlert,
} from '@eduscope/shared';
import { useIsStale, useWsShallow } from '../../store/selectors.js';

export type VerdictTier = 1 | 2 | 3 | 4;

export interface CaptureVerdict {
  readonly tier: VerdictTier;
  readonly subject: string | null;
  readonly sentence: string;
  readonly reassurance: string | null;
}

export interface CaptureAssuranceInput {
  readonly sources: Partial<Record<SourceRoleId, SourcesStatusPayload>>;
  readonly channels: Partial<Record<string, ChannelStatePayload>>;
  readonly alerts: Readonly<Record<string, SystemAlert>>;
  readonly pressure: StorageStatusPayload['pressure'] | null;
  readonly recording: RecordingStatePayload['state'] | 'idle';
  readonly stale: boolean;
  readonly cold: boolean;
}

export const STILL_RECORDING_SENTENCE = 'Your lecture is still recording.';

const ASSURED_SENTENCE = 'Everything this lecture needs is working';
const CHECKING_SENTENCE = 'Checking the room…';
const PAUSED_SENTENCE = 'Paused — nothing is being recorded right now.';
const SAVING_SENTENCE = 'Saving your lecture…';
const MIC_OFFLINE_SENTENCE = 'The microphone has no signal — this lecture is recording silence.';
const STORAGE_WARNING_SENTENCE = 'The disk is filling up.';
const STORAGE_CRITICAL_SENTENCE = 'The disk is full.';

const SOURCE_SUBJECTS: Record<SourceRoleId, string> = {
  presentation: 'PC',
  'lecturer-cam': 'CAM 1',
  'students-cam': 'CAM 2',
  'mic-lecturer': 'Microphone',
  'mic-room': 'Room microphone',
};

const SOURCE_ATTENTION_SENTENCES: Record<SourceRoleId, string> = {
  presentation: 'PC is reconnecting.',
  'lecturer-cam': 'CAM 1 is reconnecting.',
  'students-cam': 'CAM 2 is reconnecting.',
  'mic-lecturer': 'The microphone is reconnecting.',
  'mic-room': 'The room microphone is reconnecting.',
};

const SOURCE_PROBLEM_SENTENCES: Record<SourceRoleId, string> = {
  presentation: 'PC has no signal.',
  'lecturer-cam': 'CAM 1 has no signal.',
  'students-cam': 'CAM 2 has no signal.',
  'mic-lecturer': MIC_OFFLINE_SENTENCE,
  'mic-room': 'The room microphone has no signal.',
};

const CHANNEL_SUBJECTS: Record<ChannelId, string> = {
  local: 'Local recording',
  meeting: 'Live Meeting',
  streaming: 'Live Stream',
};

const CHANNEL_STARTING_SENTENCES: Record<ChannelId, string> = {
  local: 'Local recording is starting.',
  meeting: 'Live Meeting is starting.',
  streaming: 'Live Stream is starting.',
};

const CHANNEL_RESTARTING_SENTENCES: Record<ChannelId, string> = {
  local: 'Local recording is reconnecting.',
  meeting: 'Live Meeting is reconnecting.',
  streaming: 'Live Stream is reconnecting.',
};

const CHANNEL_FAILED_SENTENCES: Record<ChannelId, string> = {
  local: 'Local recording stopped.',
  meeting: 'Live Meeting stopped.',
  streaming: 'Live Stream stopped.',
};

interface VerdictCandidate {
  readonly tier: 3 | 4;
  readonly subject: string;
  readonly sentence: string;
  readonly micOffline?: boolean;
}

function hasRestartingAlert(
  alerts: CaptureAssuranceInput['alerts'],
  channelId: string,
): boolean {
  return Object.values(alerts).some((alert) => {
    if (alert.code !== 'channel.restarting' || alert.clearedAt !== null) return false;
    const identifiedChannel = alert.context?.channelId ?? alert.relatedEntity?.id;
    return identifiedChannel === undefined || identifiedChannel === null
      || identifiedChannel === channelId;
  });
}

function isSaving(recording: CaptureAssuranceInput['recording']): boolean {
  return recording === 'stopping' || recording === 'finalizing';
}

/** Pure worst-case fold from S-05 §2.3. */
export function foldCaptureVerdict(input: CaptureAssuranceInput): CaptureVerdict {
  let tier: VerdictTier = input.cold || input.stale ? 2 : 1;
  const candidates: VerdictCandidate[] = [];

  for (const source of Object.values(input.sources)) {
    if (!source || source.state === 'unbound' || source.state === 'online') continue;
    if (source.state === 'unknown') {
      tier = Math.max(tier, 2) as VerdictTier;
      continue;
    }

    const candidate: VerdictCandidate = source.state === 'offline'
      ? {
          tier: 4,
          subject: SOURCE_SUBJECTS[source.roleId],
          sentence: SOURCE_PROBLEM_SENTENCES[source.roleId],
          micOffline: source.roleId === 'mic-lecturer',
        }
      : {
          tier: 3,
          subject: SOURCE_SUBJECTS[source.roleId],
          sentence: SOURCE_ATTENTION_SENTENCES[source.roleId],
        };
    tier = Math.max(tier, candidate.tier) as VerdictTier;
    candidates.push(candidate);
  }

  for (const channel of Object.values(input.channels)) {
    if (!channel) continue;
    if (channel.state === 'failed') {
      tier = 4;
      candidates.push({
        tier: 4,
        subject: CHANNEL_SUBJECTS[channel.channelId],
        sentence: CHANNEL_FAILED_SENTENCES[channel.channelId],
      });
    } else if (channel.state === 'starting') {
      tier = Math.max(tier, 3) as VerdictTier;
      const restarting = hasRestartingAlert(input.alerts, channel.channelId);
      candidates.push({
        tier: 3,
        subject: CHANNEL_SUBJECTS[channel.channelId],
        sentence: restarting
          ? CHANNEL_RESTARTING_SENTENCES[channel.channelId]
          : CHANNEL_STARTING_SENTENCES[channel.channelId],
      });
    } else if (channel.state === 'preflight') {
      tier = Math.max(tier, 2) as VerdictTier;
    }
  }

  if (input.pressure === 'critical') {
    tier = 4;
    candidates.push({ tier: 4, subject: 'Disk', sentence: STORAGE_CRITICAL_SENTENCE });
  } else if (input.pressure === 'warning') {
    tier = Math.max(tier, 3) as VerdictTier;
    candidates.push({ tier: 3, subject: 'Disk', sentence: STORAGE_WARNING_SENTENCE });
  } else if (input.pressure === null) {
    tier = Math.max(tier, 2) as VerdictTier;
  }

  if (input.recording === 'paused') {
    return { tier, subject: null, sentence: PAUSED_SENTENCE, reassurance: null };
  }
  if (isSaving(input.recording)) {
    return { tier, subject: null, sentence: SAVING_SENTENCE, reassurance: null };
  }
  if (tier === 1) {
    return { tier, subject: null, sentence: ASSURED_SENTENCE, reassurance: null };
  }
  if (tier === 2) {
    return { tier, subject: null, sentence: CHECKING_SENTENCE, reassurance: null };
  }

  const candidate = candidates.find((row) => row.tier === tier && row.micOffline)
    ?? candidates.find((row) => row.tier === tier);
  const canReassure = input.recording === 'recording' || input.recording === 'starting';
  return {
    tier,
    subject: candidate?.subject ?? null,
    sentence: candidate?.sentence ?? CHECKING_SENTENCE,
    reassurance: tier === 4 && canReassure ? STILL_RECORDING_SENTENCE : null,
  };
}

export function useCaptureAssurance(): CaptureVerdict {
  const state = useWsShallow((store) => ({
    sources: store.sources,
    channels: store.channels,
    alerts: store.alerts,
    pressure: store.storage?.pressure ?? null,
    recording: store.recording?.state ?? 'idle',
    cold: store.recording === null
      && store.storage === null
      && Object.keys(store.sources).length === 0
      && Object.keys(store.channels).length === 0,
  }));
  const stale = useIsStale();
  return foldCaptureVerdict({ ...state, stale });
}
