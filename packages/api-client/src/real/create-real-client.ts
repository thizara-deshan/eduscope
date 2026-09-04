/**
 * The real panel `EduscopeClient` (Workstream E-02). Every method is explicit
 * and typed — no `Proxy`, no partial cast — so the compiler rejects any drift
 * between this file and the `EduscopeClient` interface or the operation table.
 * The realtime surface (`events$`/`connection$`/`openPreview`/`resync`) stays a
 * loud stub until E-03/E-04 wire the sockets.
 */
import {
  zAcknowledgeAlertResponse,
  zCreateExportResponse,
  zCreateStreamTargetResponse,
  zCreateUserResponse,
  zGetAiCountdownResponse,
  zGetDeviceHealthResponse,
  zGetEncoderSettingsResponse,
  zGetExportResponse,
  zGetFirmwareStateResponse,
  zGetLeaderboardResponse,
  zGetMeResponse,
  zGetProvisioningResponse,
  zGetQuestionSetResponse,
  zGetQuizSessionResponse,
  zGetRecordingResponse,
  zGetRecordingStateResponse,
  zGetStorageOverviewResponse,
  zGetUploadJobResponse,
  zLoginResponse,
  zListAlertsResponse,
  zListAudioControlsResponse,
  zListChannelsResponse,
  zListExportTargetsResponse,
  zListLayoutPresetsResponse,
  zListNetworkConfigsResponse,
  zListPhysicalInputsResponse,
  zListPublicationResponsesResponse,
  zListPublicationsResponse,
  zListQuestionSetsResponse,
  zListQuestionsResponse,
  zListRecordingsResponse,
  zListSourceBindingsResponse,
  zListSourceRolesResponse,
  zListStreamTargetsResponse,
  zListUploadJobsResponse,
  zListUsersResponse,
  zQueryLogsResponse,
  zGetSourcesStatusResponse,
  zImportUsersResponse,
  zCommandAccepted,
  zRefreshResponse,
  zRegisterStorageVolumeResponse,
  zUpdateChannelConfigResponse,
  zUpdateEncoderSettingsResponse,
  zUpdatePhysicalInputResponse,
  zUpdateSourceBindingResponse,
  zUpdateStreamTargetResponse,
  zUpdateUserResponse,
} from '@eduscope/shared';
import type { QuestionSet } from '@eduscope/shared';
import type { EduscopeClient } from '../client.js';
import { NotImplementedError } from '../errors.js';
import {
  createHttpTransport,
  type FetchLike,
  type HttpRequest,
  type HttpTransport,
  type QueryValue,
} from './http.js';
import {
  createAuthCoordinator,
  createMemoryTokenStore,
  type TokenStore,
} from './auth.js';
import { fillPath, OPERATION_ROUTE } from './operation-specs.js';
import type { z } from 'zod';
import type { PanelOperationId } from '@eduscope/shared';

export interface RealClientOptions {
  fetch?: FetchLike;
  tokenStore?: TokenStore;
}

export function createRealClient(
  baseUrl: string,
  options: RealClientOptions = {},
): EduscopeClient {
  const store = options.tokenStore ?? createMemoryTokenStore();
  const fetchImpl =
    options.fetch ?? (globalThis.fetch as unknown as FetchLike | undefined);
  if (!fetchImpl) throw new Error('createRealClient: no fetch implementation available');

  let transport: HttpTransport;
  const coordinator = createAuthCoordinator({
    store,
    refresh: async (refreshToken) => {
      const result = await transport.request({
        operation: 'refreshToken',
        method: 'POST',
        path: '/auth/refresh',
        body: { refreshToken },
        response: zRefreshResponse,
        auth: 'none',
      });
      return result.tokens;
    },
  });
  transport = createHttpTransport({ baseUrl, fetch: fetchImpl, authorized: coordinator.authorized });

  /**
   * `R` follows the `EduscopeClient` interface (its return type flows in
   * contextually); the runtime validator is the exact generated `z*Response`
   * schema passed in `response`. Decoupling the two absorbs the handful of
   * codegen inconsistencies between `types.gen` and `zod.gen` (e.g. a field the
   * schema marks optional that the type marks required) without weakening the
   * runtime contract — a malformed body still fails `safeParse`.
   */
  function call<R>(
    id: PanelOperationId,
    opts: {
      params?: Record<string, string | number> | undefined;
      query?: Record<string, QueryValue> | undefined;
      body?: unknown;
      response: z.ZodTypeAny | 'blob' | 'text' | 'void';
      auth?: 'required' | 'none';
    },
  ): Promise<R> {
    const [method, template] = OPERATION_ROUTE[id];
    const request: HttpRequest<R> = {
      operation: id,
      method,
      path: fillPath(template, opts.params),
      query: opts.query,
      body: opts.body,
      response: opts.response as z.ZodType<R> | 'blob' | 'text' | 'void',
      auth: opts.auth ?? 'required',
    };
    return transport.request(request);
  }

  const deadStream = {
    subscribe() {
      throw new NotImplementedError('events$.subscribe');
    },
  };

  const client: EduscopeClient = {
    // ── auth ────────────────────────────────────────────────────────────
    login: (body) => call('login', { body, response: zLoginResponse, auth: 'none' }),
    refreshToken: (body) => call('refreshToken', { body, response: zRefreshResponse, auth: 'none' }),
    logout: async () => {
      await call('logout', { response: 'void' });
      store.clearTokens();
    },
    getMe: () => call('getMe', { response: zGetMeResponse }),
    changePassword: (body) => call('changePassword', { body, response: 'void' }),

    // ── recording ───────────────────────────────────────────────────────
    getRecordingState: () => call('getRecordingState', { response: zGetRecordingStateResponse }),
    startRecording: () => call('startRecording', { response: zCommandAccepted }),
    pauseRecording: () => call('pauseRecording', { response: zCommandAccepted }),
    resumeRecording: () => call('resumeRecording', { response: zCommandAccepted }),
    stopRecording: () => call('stopRecording', { response: zCommandAccepted }),
    takeoverRecording: () => call('takeoverRecording', { response: zCommandAccepted }),

    // ── channels ────────────────────────────────────────────────────────
    listChannels: async () => (await call<z.infer<typeof zListChannelsResponse>>('listChannels', { response: zListChannelsResponse })).items,
    updateChannelConfig: (channelId, body) =>
      call('updateChannelConfig', { params: { channelId }, body, response: zUpdateChannelConfigResponse }),
    enableChannel: (channelId) =>
      call('enableChannel', { params: { channelId }, response: zCommandAccepted }),
    disableChannel: (channelId) =>
      call('disableChannel', { params: { channelId }, response: zCommandAccepted }),
    listLayoutPresets: async () =>
      (await call<z.infer<typeof zListLayoutPresetsResponse>>('listLayoutPresets', { response: zListLayoutPresetsResponse })).items,

    // ── sources & audio ─────────────────────────────────────────────────
    listSourceRoles: async () => (await call<z.infer<typeof zListSourceRolesResponse>>('listSourceRoles', { response: zListSourceRolesResponse })).items,
    getSourcesStatus: async () => (await call<z.infer<typeof zGetSourcesStatusResponse>>('getSourcesStatus', { response: zGetSourcesStatusResponse })).items,
    getSourcePreview: (roleId) => call('getSourcePreview', { params: { roleId }, response: 'blob' }),
    listPhysicalInputs: async () =>
      (await call<z.infer<typeof zListPhysicalInputsResponse>>('listPhysicalInputs', { response: zListPhysicalInputsResponse })).items,
    updatePhysicalInput: (inputId, body) =>
      call('updatePhysicalInput', { params: { inputId }, body, response: zUpdatePhysicalInputResponse }),
    listSourceBindings: async () =>
      (await call<z.infer<typeof zListSourceBindingsResponse>>('listSourceBindings', { response: zListSourceBindingsResponse })).items,
    updateSourceBinding: (roleId, body) =>
      call('updateSourceBinding', { params: { roleId }, body, response: zUpdateSourceBindingResponse }),
    listAudioControls: async () =>
      (await call<z.infer<typeof zListAudioControlsResponse>>('listAudioControls', { response: zListAudioControlsResponse })).items,
    updateAudioControl: (roleId, body) =>
      call('updateAudioControl', { params: { roleId }, body, response: zCommandAccepted }),

    // ── recordings & exports ────────────────────────────────────────────
    listRecordings: (query) => call('listRecordings', { query, response: zListRecordingsResponse }),
    getRecording: (recordingId) =>
      call('getRecording', { params: { recordingId }, response: zGetRecordingResponse }),
    deleteRecording: (recordingId) =>
      call('deleteRecording', { params: { recordingId }, response: zCommandAccepted }),
    retryMergeRecording: (recordingId) =>
      call('retryMergeRecording', { params: { recordingId }, response: zCommandAccepted }),
    getRecordingMedia: (recordingId, fileId, query) =>
      call('getRecordingMedia', { params: { recordingId, fileId }, query, response: 'blob' }),
    listExportTargets: async () =>
      (await call<z.infer<typeof zListExportTargetsResponse>>('listExportTargets', { response: zListExportTargetsResponse })).items,
    createExport: (body) => call('createExport', { body, response: zCreateExportResponse }),
    getExport: (exportId) => call('getExport', { params: { exportId }, response: zGetExportResponse }),
    cancelExport: (exportId) => call('cancelExport', { params: { exportId }, response: zCommandAccepted }),

    // ── uploads ─────────────────────────────────────────────────────────
    listUploadJobs: (query) => call('listUploadJobs', { query, response: zListUploadJobsResponse }),
    getUploadJob: (jobId) => call('getUploadJob', { params: { jobId }, response: zGetUploadJobResponse }),
    requeueUploadJob: (jobId) =>
      call('requeueUploadJob', { params: { jobId }, response: zCommandAccepted }),

    // ── provisioning & health ───────────────────────────────────────────
    getProvisioning: () => call('getProvisioning', { response: zGetProvisioningResponse }),
    getDeviceHealth: () => call('getDeviceHealth', { response: zGetDeviceHealthResponse }),

    // ── device: alerts & power ──────────────────────────────────────────
    listAlerts: (query) => call('listAlerts', { query, response: zListAlertsResponse }),
    acknowledgeAlert: (alertId) =>
      call('acknowledgeAlert', { params: { alertId }, response: zAcknowledgeAlertResponse }),
    powerOffDevice: () => call('powerOffDevice', { response: zCommandAccepted }),

    // ── storage ─────────────────────────────────────────────────────────
    getStorageOverview: () => call('getStorageOverview', { response: zGetStorageOverviewResponse }),
    registerStorageVolume: (body) =>
      call('registerStorageVolume', { body, response: zRegisterStorageVolumeResponse }),
    formatStorageVolume: (volumeId, body) =>
      call('formatStorageVolume', { params: { volumeId }, body, response: zCommandAccepted }),

    // ── settings ────────────────────────────────────────────────────────
    listNetworkConfigs: async () =>
      (await call<z.infer<typeof zListNetworkConfigsResponse>>('listNetworkConfigs', { response: zListNetworkConfigsResponse })).items,
    updateNetworkConfig: (networkConfigId, body) =>
      call('updateNetworkConfig', { params: { networkConfigId }, body, response: zCommandAccepted }),
    getEncoderSettings: () => call('getEncoderSettings', { response: zGetEncoderSettingsResponse }),
    updateEncoderSettings: (body) =>
      call('updateEncoderSettings', { body, response: zUpdateEncoderSettingsResponse }),
    listStreamTargets: async () =>
      (await call<z.infer<typeof zListStreamTargetsResponse>>('listStreamTargets', { response: zListStreamTargetsResponse })).items,
    createStreamTarget: (body) => call('createStreamTarget', { body, response: zCreateStreamTargetResponse }),
    updateStreamTarget: (targetId, body) =>
      call('updateStreamTarget', { params: { targetId }, body, response: zUpdateStreamTargetResponse }),
    deleteStreamTarget: (targetId) =>
      call('deleteStreamTarget', { params: { targetId }, response: 'void' }),

    // ── firmware ────────────────────────────────────────────────────────
    getFirmwareState: () => call('getFirmwareState', { response: zGetFirmwareStateResponse }),
    checkFirmware: () => call('checkFirmware', { response: zCommandAccepted }),
    applyFirmware: () => call('applyFirmware', { response: zCommandAccepted }),

    // ── users ───────────────────────────────────────────────────────────
    listUsers: (query) => call('listUsers', { query, response: zListUsersResponse }),
    createUser: (body) => call('createUser', { body, response: zCreateUserResponse }),
    updateUser: (userId, body) => call('updateUser', { params: { userId }, body, response: zUpdateUserResponse }),
    deleteUser: (userId) => call('deleteUser', { params: { userId }, response: 'void' }),
    importUsers: (body) => {
      const form = new FormData();
      form.append('file', body.file);
      return call('importUsers', { body: form, response: zImportUsersResponse });
    },

    // ── ai / quiz authoring ─────────────────────────────────────────────
    getAiCountdown: () => call('getAiCountdown', { response: zGetAiCountdownResponse }),
    setAiInterval: (body) => call('setAiInterval', { body, response: zCommandAccepted }),
    generateNow: () => call('generateNow', { response: zCommandAccepted }),
    listQuestionSets: (query) =>
      call<{ items: QuestionSet[] }>('listQuestionSets', { query, response: zListQuestionSetsResponse }).then((r) => r.items),
    getQuestionSet: (setId) => call('getQuestionSet', { params: { setId }, response: zGetQuestionSetResponse }),
    listQuestions: (query) => call<z.infer<typeof zListQuestionsResponse>>('listQuestions', { query, response: zListQuestionsResponse }).then((r) => r.items),
    createQuestion: (body) => call('createQuestion', { body, response: zCommandAccepted }),
    editQuestion: (questionId, body) =>
      call('editQuestion', { params: { questionId }, body, response: zCommandAccepted }),
    discardQuestion: (questionId) =>
      call('discardQuestion', { params: { questionId }, response: zCommandAccepted }),
    sendToProjector: (questionId) =>
      call('sendToProjector', { params: { questionId }, response: zCommandAccepted }),
    listPublications: (query) => call<z.infer<typeof zListPublicationsResponse>>('listPublications', { query, response: zListPublicationsResponse }).then((r) => r.items),
    closePublication: (publicationId) =>
      call('closePublication', { params: { publicationId }, response: zCommandAccepted }),
    setProjector: (body) => call('setProjector', { body, response: zCommandAccepted }),

    // ── quiz (panel-facing read models) ─────────────────────────────────
    getQuizSession: () => call('getQuizSession', { response: zGetQuizSessionResponse }),
    listPublicationResponses: (publicationId) =>
      call('listPublicationResponses', {
        params: { publicationId },
        response: zListPublicationResponsesResponse,
      }),
    getLeaderboard: (query) => call('getLeaderboard', { query, response: zGetLeaderboardResponse }),

    // ── logs ────────────────────────────────────────────────────────────
    queryLogs: (query) => call('queryLogs', { query, response: zQueryLogsResponse }),
    exportLogsCsv: (query) => call('exportLogsCsv', { query, response: 'text' }),

    // ── realtime (stubbed until E-03/E-04) ──────────────────────────────
    events$: deadStream as unknown as EduscopeClient['events$'],
    connection$: deadStream as unknown as EduscopeClient['connection$'],
    openPreview: () => {
      throw new NotImplementedError('openPreview');
    },
    resync: () => {
      throw new NotImplementedError('resync');
    },
    dispose: () => {},
  };

  return client;
}
