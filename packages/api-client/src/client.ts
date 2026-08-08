import type {
  AiCountdownSnapshot, AnswerProjection, AudioControl, AudioControlUpdate,
  ChangePasswordRequest, ChannelConfig, ChannelConfigUpdate, ChannelStatus,
  CommandAccepted, DeviceHealth, DeviceProvisioning, EncoderCapabilities,
  EncodingProfile, EncodingProfileUpdate, EventEnvelope, ExportCreateRequest,
  ExportJob, FirmwareUpdate, FormatVolumeRequest, Leaderboard, LayoutPreset,
  LogCategory, LogEntry, LoginRequest, LoginResponse, LogLevel,
  NetworkConfig, NetworkConfigUpdate, Page, PhysicalInput, PhysicalInputUpdate,
  PreviewClientMessage, PreviewServerMessage, ProjectorRequest, Question,
  QuestionCreate, QuestionSet, QuestionSetDetail, QuestionState, QuestionUpdate,
  Recording, RecordingDetail, RecordingState, RecordingStateSnapshot,
  RefreshResponse, RegisterVolumeRequest, PublicationWithQuestion,
  QuizSessionProjection, SetIntervalRequest, SourceBinding, SourceBindingUpdate,
  SourceRole, SourceRoleId, SourceStatus, StorageOverview, StorageVolume,
  StreamTarget, StreamTargetCreate, StreamTargetUpdate, SystemAlert, Ulid,
  UploadJob, UploadJobDetail, UploadJobState, UsbVolume, User, UserCreate,
  UserImportBatch, UserRole, UserUpdate,
} from '@eduscope/shared';
import type { ConnectionStatus, EventStream } from './stream.js';

/** `GET /channels` row shape (openapi.yaml: exactly three, one per ChannelId). */
export interface ChannelSnapshot {
  readonly config: ChannelConfig;
  readonly status: ChannelStatus;
}

/** events.md §3 — its own socket, and the one place the client sends WS messages. */
export interface PreviewChannel {
  send(message: PreviewClientMessage): void;
  /** Mock adapter note: frames are delivered as sentinel-tagged `ice` messages — see `mock/events/preview.ts`'s `isMockPreviewFrame`. */
  readonly messages$: EventStream<PreviewServerMessage>;
  close(): void;
}

/**
 * THE network boundary (frontend-conventions §1). Mock and real adapters
 * implement this identically; no component may reach past it.
 *
 * Commands are 202-async: a `CommandAccepted` return means ACCEPTED, not DONE.
 * The resolving transition arrives on `events$` within `resolveBySec`
 * (T-CMD-RESOLVE, 10 s); after that the UI renders a failure, never a spinner.
 */
export interface EduscopeClient {
  // ── auth ────────────────────────────────────────────────────────────────
  login(body: LoginRequest): Promise<LoginResponse>;
  refreshToken(body: { refreshToken: string }): Promise<RefreshResponse>;
  logout(): Promise<void>;
  getMe(): Promise<User>;
  changePassword(body: ChangePasswordRequest): Promise<void>;

  // ── recording (machine 1a) ──────────────────────────────────────────────
  getRecordingState(): Promise<RecordingStateSnapshot>;
  startRecording(): Promise<CommandAccepted>;
  pauseRecording(): Promise<CommandAccepted>;
  resumeRecording(): Promise<CommandAccepted>;
  stopRecording(): Promise<CommandAccepted>;
  /** x-required-role: admin (R-21). */
  takeoverRecording(): Promise<CommandAccepted>;

  // ── channels (machine 1c) ───────────────────────────────────────────────
  listChannels(): Promise<ChannelSnapshot[]>;
  updateChannelConfig(channelId: string, body: ChannelConfigUpdate): Promise<ChannelConfig>;
  enableChannel(channelId: string): Promise<CommandAccepted>;
  disableChannel(channelId: string): Promise<CommandAccepted>;
  listLayoutPresets(): Promise<LayoutPreset[]>;

  // ── sources & audio (machine 5a) ────────────────────────────────────────
  listSourceRoles(): Promise<SourceRole[]>;
  getSourcesStatus(): Promise<SourceStatus[]>;
  listPhysicalInputs(): Promise<PhysicalInput[]>;
  updatePhysicalInput(inputId: Ulid, body: PhysicalInputUpdate): Promise<PhysicalInput>;
  listSourceBindings(): Promise<SourceBinding[]>;
  updateSourceBinding(roleId: SourceRoleId, body: SourceBindingUpdate): Promise<SourceBinding>;
  listAudioControls(): Promise<AudioControl[]>;
  updateAudioControl(roleId: SourceRoleId, body: AudioControlUpdate): Promise<CommandAccepted>;

  // ── recordings & exports (machine 2/3) ──────────────────────────────────
  listRecordings(query?: {
    cursor?: string;
    limit?: number;
    state?: RecordingState;
    includeDeleted?: boolean;
  }): Promise<Page<Recording>>;
  getRecording(recordingId: Ulid): Promise<RecordingDetail>;
  deleteRecording(recordingId: Ulid): Promise<CommandAccepted>;
  /** Media bytes (openapi.yaml: 200 Blob, 206 partial-content on Range). */
  getRecordingMedia(recordingId: Ulid, fileId: Ulid, query?: { download?: boolean }): Promise<Blob>;
  listExportTargets(): Promise<UsbVolume[]>;
  /** 202 payload is the queued ExportJob itself, not a bare CommandAccepted. */
  createExport(body: ExportCreateRequest): Promise<ExportJob>;
  getExport(exportId: Ulid): Promise<ExportJob>;
  cancelExport(exportId: Ulid): Promise<CommandAccepted>;

  // ── uploads (machine 4) ─────────────────────────────────────────────────
  listUploadJobs(query?: {
    cursor?: string;
    limit?: number;
    state?: UploadJobState;
  }): Promise<Page<UploadJob>>;
  getUploadJob(jobId: Ulid): Promise<UploadJobDetail>;
  requeueUploadJob(jobId: Ulid): Promise<CommandAccepted>;

  // ── provisioning & device health ────────────────────────────────────────
  getProvisioning(): Promise<DeviceProvisioning>;
  getDeviceHealth(): Promise<DeviceHealth>;

  // ── device: alerts & power ──────────────────────────────────────────────
  listAlerts(query?: { includeCleared?: boolean }): Promise<{ items: SystemAlert[] }>;
  acknowledgeAlert(alertId: string): Promise<SystemAlert>;
  powerOffDevice(): Promise<CommandAccepted>;

  // ── storage ──────────────────────────────────────────────────────────────
  getStorageOverview(): Promise<StorageOverview>;
  registerStorageVolume(body: RegisterVolumeRequest): Promise<StorageVolume>;
  formatStorageVolume(volumeId: Ulid, body: FormatVolumeRequest): Promise<CommandAccepted>;

  // ── settings: network, encoder, stream targets ──────────────────────────
  listNetworkConfigs(): Promise<NetworkConfig[]>;
  updateNetworkConfig(networkConfigId: Ulid, body: NetworkConfigUpdate): Promise<CommandAccepted>;
  getEncoderSettings(): Promise<{ profile: EncodingProfile; capabilities: EncoderCapabilities }>;
  updateEncoderSettings(body: EncodingProfileUpdate): Promise<EncodingProfile>;
  listStreamTargets(): Promise<StreamTarget[]>;
  createStreamTarget(body: StreamTargetCreate): Promise<StreamTarget>;
  updateStreamTarget(targetId: Ulid, body: StreamTargetUpdate): Promise<StreamTarget>;
  deleteStreamTarget(targetId: Ulid): Promise<void>;

  // ── firmware ─────────────────────────────────────────────────────────────
  getFirmwareState(): Promise<FirmwareUpdate>;
  checkFirmware(): Promise<CommandAccepted>;
  applyFirmware(): Promise<CommandAccepted>;

  // ── users ────────────────────────────────────────────────────────────────
  listUsers(query?: {
    cursor?: string;
    limit?: number;
    q?: string;
    role?: UserRole;
  }): Promise<Page<User>>;
  createUser(body: UserCreate): Promise<User>;
  updateUser(userId: Ulid, body: UserUpdate): Promise<User>;
  deleteUser(userId: Ulid): Promise<void>;
  /** multipart/form-data — .xlsx roster upload. */
  importUsers(body: { file: Blob | File }): Promise<UserImportBatch>;

  // ── ai / quiz authoring (machine 4a-4c) ─────────────────────────────────
  getAiCountdown(): Promise<AiCountdownSnapshot>;
  setAiInterval(body: SetIntervalRequest): Promise<CommandAccepted>;
  generateNow(): Promise<CommandAccepted>;
  listQuestionSets(query: { sessionId: Ulid }): Promise<QuestionSet[]>;
  getQuestionSet(setId: Ulid): Promise<QuestionSetDetail>;
  listQuestions(query: { sessionId: Ulid; state?: QuestionState }): Promise<Question[]>;
  createQuestion(body: QuestionCreate): Promise<CommandAccepted>;
  editQuestion(questionId: Ulid, body: QuestionUpdate): Promise<CommandAccepted>;
  discardQuestion(questionId: Ulid): Promise<CommandAccepted>;
  sendToProjector(questionId: Ulid): Promise<CommandAccepted>;
  listPublications(query: { sessionId: Ulid }): Promise<PublicationWithQuestion[]>;
  closePublication(publicationId: Ulid): Promise<CommandAccepted>;
  setProjector(body: ProjectorRequest): Promise<CommandAccepted>;

  // ── quiz (machine 4d) ────────────────────────────────────────────────────
  getQuizSession(): Promise<QuizSessionProjection>;
  listPublicationResponses(
    publicationId: Ulid,
  ): Promise<{ items: AnswerProjection[]; syncedAt: string; stale: boolean }>;
  getLeaderboard(query: { sessionId: Ulid }): Promise<Leaderboard>;

  // ── logs ─────────────────────────────────────────────────────────────────
  queryLogs(query?: {
    level?: LogLevel;
    category?: LogCategory;
    q?: string;
    from?: string;
    to?: string;
    sessionId?: Ulid;
    cursor?: string;
    limit?: number;
  }): Promise<Page<LogEntry>>;
  exportLogsCsv(query?: {
    level?: LogLevel;
    category?: LogCategory;
    q?: string;
    from?: string;
    to?: string;
  }): Promise<string>;

  // ── realtime (events.md §1 + §3) ────────────────────────────────────────
  /** Server->client only. On subscribe the current snapshot is replayed first. */
  readonly events$: EventStream<EventEnvelope>;
  readonly connection$: EventStream<ConnectionStatus>;
  /** <= 1 active negotiation per connection; a new offer closes the previous. */
  openPreview(): PreviewChannel;
  /** Force the full-snapshot re-request a `seq` gap demands. */
  resync(): Promise<void>;
  dispose(): void;
}
