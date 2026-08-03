/**
 * Every operationId in contracts/openapi.yaml, partitioned.
 *
 * The `quiz-sync` tag is hosted BY the quiz service with core-api as the client
 * ("the device is the client because the public quiz zone cannot dial into the
 * campus LAN"), so no browser ever calls it and EduscopeClient must not carry it.
 * The partition is asserted against the spec in test/constants.test.ts.
 */
export const PANEL_OPERATION_IDS = [
  // auth (5)
  'login', 'refreshToken', 'logout', 'getMe', 'changePassword',
  // recording (6)
  'getRecordingState', 'startRecording', 'pauseRecording', 'resumeRecording',
  'stopRecording', 'takeoverRecording',
  // channels (5)
  'listChannels', 'updateChannelConfig', 'enableChannel', 'disableChannel',
  'listLayoutPresets',
  // sources (8)
  'listSourceRoles', 'getSourcesStatus', 'listPhysicalInputs', 'updatePhysicalInput',
  'listSourceBindings', 'updateSourceBinding', 'listAudioControls', 'updateAudioControl',
  // recordings + exports (8)
  'listRecordings', 'getRecording', 'deleteRecording', 'getRecordingMedia',
  'listExportTargets', 'createExport', 'getExport', 'cancelExport',
  // uploads (3)
  'listUploadJobs', 'getUploadJob', 'requeueUploadJob',
  // provisioning (2)
  'getProvisioning', 'getDeviceHealth',
  // device (3)
  'listAlerts', 'acknowledgeAlert', 'powerOffDevice',
  // storage (3)
  'getStorageOverview', 'registerStorageVolume', 'formatStorageVolume',
  // settings (8)
  'listNetworkConfigs', 'updateNetworkConfig', 'getEncoderSettings',
  'updateEncoderSettings', 'listStreamTargets', 'createStreamTarget',
  'updateStreamTarget', 'deleteStreamTarget',
  // firmware (3)
  'getFirmwareState', 'checkFirmware', 'applyFirmware',
  // users (5)
  'listUsers', 'createUser', 'updateUser', 'deleteUser', 'importUsers',
  // ai (13)
  'getAiCountdown', 'setAiInterval', 'generateNow', 'listQuestionSets',
  'getQuestionSet', 'listQuestions', 'createQuestion', 'editQuestion',
  'discardQuestion', 'sendToProjector', 'listPublications', 'closePublication',
  'setProjector',
  // quiz (3)
  'getQuizSession', 'listPublicationResponses', 'getLeaderboard',
  // logs (2)
  'queryLogs', 'exportLogsCsv',
] as const;

export type PanelOperationId = (typeof PANEL_OPERATION_IDS)[number];

/** Server-to-server; deliberately absent from EduscopeClient. */
export const SERVER_SIDE_ONLY_OPERATION_IDS = [
  'quizSyncCreateSession',
  'quizSyncCloseSession',
  'quizSyncPublish',
  'quizSyncClosePublication',
] as const;
