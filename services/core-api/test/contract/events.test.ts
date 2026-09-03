import {
  PANEL_EVENT_NAMES,
  zPanelServerEvent,
  zPreviewClientMessage,
  zPreviewServerMessage,
  zQuizSyncClientMessage,
  type PanelEventName,
} from '@eduscope/shared';
import { describe, expect, it } from 'vitest';

const ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const AT = '2026-09-03T00:00:00.000Z';

const PANEL_SAMPLES: Record<PanelEventName, unknown> = {
  'recording.state': { state: 'recording', startReason: 'initial', sessionId: ID, title: 'Lecture', ownerUserId: ID, ownerDisplayName: 'Lecturer', startedAt: AT, recordedDurationMs: 1, segmentIndex: 0, segmentCount: 1, pauseCount: 0, takeoverBy: null, takeoverAt: null, takeoverByDisplayName: null, errorCode: null, errorMessage: null },
  'recording.segment': { sessionId: ID, recordingId: ID, segmentId: ID, index: 0, state: 'finalized', endReason: 'stop', durationMs: 1 },
  'recording.artifact': { recordingId: ID, sessionId: ID, state: 'ready', mergeState: 'done', durationMs: 1, totalBytes: 4, deleteReason: null },
  'channel.state': { channelId: 'local', state: 'on', presetId: 'fifty-fifty', ratioA: 50, ratioB: 50, reason: null },
  'sources.status': { roleId: 'presentation', state: 'online', detail: null, since: AT, inputId: ID },
  'audio.levels': { roleId: 'mic-lecturer', rms: 0.5 },
  'audio.control': { roleId: 'mic-lecturer', gain: 80, muted: false, appliedState: 'applied', lastError: null },
  'storage.status': { pressure: 'ok', freeBytes: 10, totalBytes: 20, policy: { maxAgeDays: 14, warningThresholdPct: 80, criticalThresholdPct: 90, earlyDeleteOrder: 'uploaded-oldest-first', neverDeleteUnuploaded: true, refuseStartWhenCritical: true } },
  'device.health': { captureCardState: 'present', publisherStates: {}, ntpSynced: true, clockOffsetMs: 0, diskHealth: 'good', lastBootAt: AT },
  'system.alert': { id: ID, code: 'gate.alert', severity: 'warning', category: 'System', title: 'Gate', detail: null, raisedAt: AT, clearedAt: null, clearedReason: null, acknowledgedBy: null, context: null, relatedEntity: null },
  'log.entry': { id: ID, at: AT, level: 'INFO', category: 'System', service: 'core-api', message: 'gate', context: null, sessionId: null, userId: null },
  'ai.countdown': { state: 'armed', remainingMs: 1, nextAt: AT, intervalMinutes: 20 },
  'ai.set': { setId: ID, sessionId: ID, state: 'ready', trigger: 'countdown', count: 1, error: null, attempt: 0 },
  'ai.question': { questionId: ID, setId: ID, state: 'draft', provenance: 'generated', edited: false },
  'quiz.session': { state: 'open', quizSessionId: ID, joinUrl: 'https://quiz.example/join/GATE', joinCode: 'GATE', joinedCount: 1, syncState: 'synced' },
  'quiz.publication': { publicationId: ID, questionId: ID, state: 'open', isShowing: true, projectorState: 'showing', syncState: 'synced', closeReason: null },
  'quiz.responses': { publicationId: ID, deltas: [{ studentIdNumber: 'S1', displayName: 'Student', selectedOptionId: ID, isCorrect: true, responseTimeMs: 1, submittedAt: AT }], syncedAt: AT, stale: false },
  'upload.job': { jobId: ID, recordingId: ID, state: 'uploading', attempt: 1, failureClass: null, nextAttemptAt: null, progressPct: 50, lastError: null, blockedBy: null },
  'upload.part': { partId: ID, jobId: ID, streamKey: 'main', state: 'uploading', bytesSent: 1, bytesTotal: 2 },
  'export.job': { jobId: ID, state: 'copying', bytesCopied: 1, bytesTotal: 2, error: null },
  'usb.volumes': { volumes: [] },
  'firmware.state': { id: ID, currentVersion: '1.0.0', availableVersion: null, state: 'idle', signatureVerified: false, rollbackVersion: null, startedAt: null, finishedAt: null, lastError: null },
};

describe('B-38 exact event ownership gate', () => {
  it('exercises exactly all 22 panel payload union members', () => {
    expect(PANEL_EVENT_NAMES).toHaveLength(22);
    expect(Object.keys(PANEL_SAMPLES).sort()).toEqual([...PANEL_EVENT_NAMES].sort());
    for (const event of PANEL_EVENT_NAMES) {
      expect(zPanelServerEvent.safeParse({ event, payload: PANEL_SAMPLES[event] }).success, event).toBe(true);
    }
  });

  it('exercises exactly five preview variants with bidirectional ice counted once', () => {
    const variants = new Set<string>();
    const client = [
      { type: 'offer', negotiationId: ID, roleId: 'presentation', sdp: 'v=0' },
      { type: 'ice', negotiationId: ID, candidate: 'candidate:1', sdpMid: null, sdpMLineIndex: null },
      { type: 'close', negotiationId: ID },
    ];
    const server = [
      { type: 'answer', negotiationId: ID, sdp: 'v=0' },
      { type: 'ice', negotiationId: ID, candidate: 'candidate:2', sdpMid: null, sdpMLineIndex: null },
      { type: 'error', negotiationId: ID, code: 'source-offline', message: 'offline' },
    ];
    for (const frame of client) {
      expect(zPreviewClientMessage.safeParse(frame).success).toBe(true);
      variants.add(frame.type);
    }
    for (const frame of server) {
      expect(zPreviewServerMessage.safeParse(frame).success).toBe(true);
      variants.add(frame.type);
    }
    expect([...variants].sort()).toEqual(['answer', 'close', 'error', 'ice', 'offer']);
  });

  it('pins the single exclusively B-owned sync message to sync.hello', () => {
    const bOwned = [{ type: 'sync.hello', deviceId: ID, quizSessionId: ID, answerWatermark: 0 }];
    expect(bOwned).toHaveLength(1);
    expect(zQuizSyncClientMessage.parse(bOwned[0]).type).toBe('sync.hello');
  });
});
