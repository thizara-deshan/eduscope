/**
 * The mechanical method/path table for every panel-facing operation, taken
 * verbatim from `contracts/openapi.yaml`. It is `satisfies Record<
 * PanelOperationId, …>`, so adding an operation to the contract without a route
 * here fails to compile — the property `create-real-client.ts` relies on to keep
 * its 79 typed methods honest. The four `quizSync*` operations are server-only
 * and deliberately absent.
 */
import type { PanelOperationId } from '@eduscope/shared';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export const OPERATION_ROUTE = {
  login: ['POST', '/auth/login'],
  refreshToken: ['POST', '/auth/refresh'],
  logout: ['POST', '/auth/logout'],
  getMe: ['GET', '/auth/me'],
  changePassword: ['POST', '/auth/change-password'],
  getRecordingState: ['GET', '/recording/state'],
  startRecording: ['POST', '/recording/start'],
  pauseRecording: ['POST', '/recording/pause'],
  resumeRecording: ['POST', '/recording/resume'],
  stopRecording: ['POST', '/recording/stop'],
  takeoverRecording: ['POST', '/recording/takeover'],
  listChannels: ['GET', '/channels'],
  updateChannelConfig: ['PUT', '/channels/{channelId}'],
  enableChannel: ['POST', '/channels/{channelId}/enable'],
  disableChannel: ['POST', '/channels/{channelId}/disable'],
  listLayoutPresets: ['GET', '/layouts'],
  listSourceRoles: ['GET', '/sources/roles'],
  getSourcesStatus: ['GET', '/sources/status'],
  getSourcePreview: ['GET', '/sources/{roleId}/preview.jpg'],
  listPhysicalInputs: ['GET', '/sources/inputs'],
  updatePhysicalInput: ['PUT', '/sources/inputs/{inputId}'],
  listSourceBindings: ['GET', '/sources/bindings'],
  updateSourceBinding: ['PUT', '/sources/bindings/{roleId}'],
  listAudioControls: ['GET', '/audio/controls'],
  updateAudioControl: ['PUT', '/audio/controls/{roleId}'],
  listRecordings: ['GET', '/recordings'],
  getRecording: ['GET', '/recordings/{recordingId}'],
  deleteRecording: ['DELETE', '/recordings/{recordingId}'],
  retryMergeRecording: ['POST', '/recordings/{recordingId}/retry-merge'],
  getRecordingMedia: ['GET', '/recordings/{recordingId}/files/{fileId}/media'],
  listExportTargets: ['GET', '/exports/targets'],
  createExport: ['POST', '/exports'],
  getExport: ['GET', '/exports/{exportId}'],
  cancelExport: ['POST', '/exports/{exportId}/cancel'],
  listUploadJobs: ['GET', '/uploads'],
  getUploadJob: ['GET', '/uploads/{jobId}'],
  requeueUploadJob: ['POST', '/uploads/{jobId}/requeue'],
  getProvisioning: ['GET', '/provisioning'],
  getDeviceHealth: ['GET', '/health'],
  listAlerts: ['GET', '/alerts'],
  acknowledgeAlert: ['POST', '/alerts/{alertId}/acknowledge'],
  powerOffDevice: ['POST', '/device/power-off'],
  getStorageOverview: ['GET', '/storage'],
  registerStorageVolume: ['POST', '/storage/volumes'],
  formatStorageVolume: ['POST', '/storage/volumes/{volumeId}/format'],
  listNetworkConfigs: ['GET', '/settings/network'],
  updateNetworkConfig: ['PUT', '/settings/network/{networkConfigId}'],
  getEncoderSettings: ['GET', '/settings/encoder'],
  updateEncoderSettings: ['PUT', '/settings/encoder'],
  listStreamTargets: ['GET', '/settings/stream-targets'],
  createStreamTarget: ['POST', '/settings/stream-targets'],
  updateStreamTarget: ['PUT', '/settings/stream-targets/{targetId}'],
  deleteStreamTarget: ['DELETE', '/settings/stream-targets/{targetId}'],
  getFirmwareState: ['GET', '/firmware'],
  checkFirmware: ['POST', '/firmware/check'],
  applyFirmware: ['POST', '/firmware/apply'],
  listUsers: ['GET', '/users'],
  createUser: ['POST', '/users'],
  updateUser: ['PATCH', '/users/{userId}'],
  deleteUser: ['DELETE', '/users/{userId}'],
  importUsers: ['POST', '/users/import'],
  getAiCountdown: ['GET', '/ai/countdown'],
  setAiInterval: ['PUT', '/ai/interval'],
  generateNow: ['POST', '/ai/generate-now'],
  listQuestionSets: ['GET', '/ai/question-sets'],
  getQuestionSet: ['GET', '/ai/question-sets/{setId}'],
  listQuestions: ['GET', '/ai/questions'],
  createQuestion: ['POST', '/ai/questions'],
  editQuestion: ['PATCH', '/ai/questions/{questionId}'],
  discardQuestion: ['POST', '/ai/questions/{questionId}/discard'],
  sendToProjector: ['POST', '/ai/questions/{questionId}/send-to-projector'],
  listPublications: ['GET', '/ai/publications'],
  closePublication: ['POST', '/ai/publications/{publicationId}/close'],
  setProjector: ['PUT', '/ai/projector'],
  getQuizSession: ['GET', '/quiz/session'],
  listPublicationResponses: ['GET', '/quiz/publications/{publicationId}/responses'],
  getLeaderboard: ['GET', '/quiz/leaderboard'],
  queryLogs: ['GET', '/logs'],
  exportLogsCsv: ['GET', '/logs/export'],
} as const satisfies Record<PanelOperationId, readonly [HttpMethod, string]>;

/**
 * Substitute `{name}` path parameters, percent-encoding each value and
 * rejecting a template whose placeholder was not supplied.
 */
export function fillPath(
  template: string,
  params: Record<string, string | number> = {},
): string {
  return template.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    const value = params[name];
    if (value === undefined || value === null) {
      throw new Error(`fillPath: missing path parameter "${name}" for ${template}`);
    }
    return encodeURIComponent(String(value));
  });
}
