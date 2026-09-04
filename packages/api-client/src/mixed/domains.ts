/**
 * The static domain catalog (Workstream E, master-plan §"Runtime domains").
 *
 * Every panel operation and every panel event is owned by exactly one adapter
 * domain. Adapter selection is per domain, so a deployment can run some domains
 * against the real backend while others stay on the mock. `studentQuiz` is the
 * whole quiz-app client and owns no panel operation or event (the panel never
 * calls it); it appears here only so the domain list is the single closed set.
 *
 * The two maps below are `satisfies Record<…, AdapterDomain>`: adding an
 * operation or event to the contract without assigning it a domain fails to
 * compile, which is the property that keeps this catalog honest as B/D grow.
 */
import {
  PANEL_EVENT_NAMES,
  PANEL_OPERATION_IDS,
  type PanelEventName,
  type PanelOperationId,
} from '@eduscope/shared';

export const ADAPTER_DOMAINS = [
  'auth',
  'recording',
  'channels',
  'sourcesAudio',
  'preview',
  'libraryExport',
  'uploads',
  'provisioningHealth',
  'alerts',
  'devicePower',
  'storage',
  'network',
  'encoder',
  'streamTargets',
  'firmware',
  'users',
  'aiQuiz',
  'logs',
  'studentQuiz',
] as const;
export type AdapterDomain = (typeof ADAPTER_DOMAINS)[number];
export type AdapterKind = 'mock' | 'real';

/**
 * Operation → owning domain, following the grouped method sections in
 * `client.ts`. `getSourcePreview` is the authenticated JPEG poll and belongs to
 * the `preview` domain (the 2026-09-03 target decision), not `sourcesAudio`.
 */
export const PANEL_OPERATION_DOMAIN = {
  // auth
  login: 'auth',
  refreshToken: 'auth',
  logout: 'auth',
  getMe: 'auth',
  changePassword: 'auth',
  // recording
  getRecordingState: 'recording',
  startRecording: 'recording',
  pauseRecording: 'recording',
  resumeRecording: 'recording',
  stopRecording: 'recording',
  takeoverRecording: 'recording',
  // channels
  listChannels: 'channels',
  updateChannelConfig: 'channels',
  enableChannel: 'channels',
  disableChannel: 'channels',
  listLayoutPresets: 'channels',
  // sources & audio
  listSourceRoles: 'sourcesAudio',
  getSourcesStatus: 'sourcesAudio',
  getSourcePreview: 'preview',
  listPhysicalInputs: 'sourcesAudio',
  updatePhysicalInput: 'sourcesAudio',
  listSourceBindings: 'sourcesAudio',
  updateSourceBinding: 'sourcesAudio',
  listAudioControls: 'sourcesAudio',
  updateAudioControl: 'sourcesAudio',
  // recordings & exports (library)
  listRecordings: 'libraryExport',
  getRecording: 'libraryExport',
  deleteRecording: 'libraryExport',
  retryMergeRecording: 'libraryExport',
  getRecordingMedia: 'libraryExport',
  listExportTargets: 'libraryExport',
  createExport: 'libraryExport',
  getExport: 'libraryExport',
  cancelExport: 'libraryExport',
  // uploads
  listUploadJobs: 'uploads',
  getUploadJob: 'uploads',
  requeueUploadJob: 'uploads',
  // provisioning & health
  getProvisioning: 'provisioningHealth',
  getDeviceHealth: 'provisioningHealth',
  // device: alerts & power
  listAlerts: 'alerts',
  acknowledgeAlert: 'alerts',
  powerOffDevice: 'devicePower',
  // storage
  getStorageOverview: 'storage',
  registerStorageVolume: 'storage',
  formatStorageVolume: 'storage',
  // settings: network, encoder, stream targets
  listNetworkConfigs: 'network',
  updateNetworkConfig: 'network',
  getEncoderSettings: 'encoder',
  updateEncoderSettings: 'encoder',
  listStreamTargets: 'streamTargets',
  createStreamTarget: 'streamTargets',
  updateStreamTarget: 'streamTargets',
  deleteStreamTarget: 'streamTargets',
  // firmware
  getFirmwareState: 'firmware',
  checkFirmware: 'firmware',
  applyFirmware: 'firmware',
  // users
  listUsers: 'users',
  createUser: 'users',
  updateUser: 'users',
  deleteUser: 'users',
  importUsers: 'users',
  // ai / quiz authoring
  getAiCountdown: 'aiQuiz',
  setAiInterval: 'aiQuiz',
  generateNow: 'aiQuiz',
  listQuestionSets: 'aiQuiz',
  getQuestionSet: 'aiQuiz',
  listQuestions: 'aiQuiz',
  createQuestion: 'aiQuiz',
  editQuestion: 'aiQuiz',
  discardQuestion: 'aiQuiz',
  sendToProjector: 'aiQuiz',
  listPublications: 'aiQuiz',
  closePublication: 'aiQuiz',
  setProjector: 'aiQuiz',
  // quiz (panel-facing read models)
  getQuizSession: 'aiQuiz',
  listPublicationResponses: 'aiQuiz',
  getLeaderboard: 'aiQuiz',
  // logs
  queryLogs: 'logs',
  exportLogsCsv: 'logs',
} as const satisfies Record<PanelOperationId, AdapterDomain>;

/**
 * Event → owning domain. `recording.artifact` is the produced library artifact
 * ("export/USB/artifact") and belongs to `libraryExport`, not `recording`.
 */
export const PANEL_EVENT_DOMAIN = {
  'recording.state': 'recording',
  'recording.segment': 'recording',
  'recording.artifact': 'libraryExport',
  'channel.state': 'channels',
  'sources.status': 'sourcesAudio',
  'audio.levels': 'sourcesAudio',
  'audio.control': 'sourcesAudio',
  'storage.status': 'storage',
  'device.health': 'provisioningHealth',
  'system.alert': 'alerts',
  'log.entry': 'logs',
  'ai.countdown': 'aiQuiz',
  'ai.set': 'aiQuiz',
  'ai.question': 'aiQuiz',
  'quiz.session': 'aiQuiz',
  'quiz.publication': 'aiQuiz',
  'quiz.responses': 'aiQuiz',
  'upload.job': 'uploads',
  'upload.part': 'uploads',
  'export.job': 'libraryExport',
  'usb.volumes': 'libraryExport',
  'firmware.state': 'firmware',
} as const satisfies Record<PanelEventName, AdapterDomain>;

/** Guards used by tests and by `create-routed-client` — the closed sets. */
export const PANEL_OPERATION_IDS_SET: ReadonlySet<PanelOperationId> = new Set(
  PANEL_OPERATION_IDS,
);
export const PANEL_EVENT_NAMES_SET: ReadonlySet<PanelEventName> = new Set(
  PANEL_EVENT_NAMES,
);
