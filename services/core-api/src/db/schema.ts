import { sql } from 'drizzle-orm';
import { check, index, integer, real, sqliteTable, text, uniqueIndex, type SQLiteColumn } from 'drizzle-orm/sqlite-core';

/** Physical mapping of domain-model.md §4-9 (design/core-api.md §3.2, D-03). */

function enumCheck(name: string, column: SQLiteColumn, values: readonly string[]): ReturnType<typeof check> {
  const list = values.map((value) => `'${value.replace(/'/g, "''")}'`).join(', ');
  return check(name, sql`${column} IN (${sql.raw(list)})`);
}

function json<T>(name: string) {
  return text(name, { mode: 'json' }).$type<T>();
}

/** Byte/duration counters. Plain `number` mode — this drizzle-orm version's SQLite `integer()` has no `bigint` mode; values here stay well under `Number.MAX_SAFE_INTEGER`. */
function bigint(name: string) {
  return integer(name);
}

function bool(name: string) {
  return integer(name, { mode: 'boolean' });
}

// ---------------------------------------------------------------------------
// Context B — Identity & access (domain-model §5)
// ---------------------------------------------------------------------------

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    username: text('username').notNull(),
    displayName: text('display_name').notNull(),
    role: text('role').notNull().$type<'lecturer' | 'admin'>(),
    source: text('source').notNull().$type<'local' | 'institute'>(),
    externalId: text('external_id'),
    passwordHash: text('password_hash'),
    mustResetPassword: bool('must_reset_password').notNull(),
    disabled: bool('disabled').notNull(),
    lastLoginAt: text('last_login_at'),
    createdAt: text('created_at').notNull(),
    createdBy: text('created_by').references((): SQLiteColumn => users.id),
    importBatchId: text('import_batch_id').references((): SQLiteColumn => userImportBatches.id),
  },
  (t) => [
    uniqueIndex('users_username_unique').on(t.username),
    enumCheck('users_role_check', t.role, ['lecturer', 'admin']),
    enumCheck('users_source_check', t.source, ['local', 'institute']),
  ],
);

export const authSessions = sqliteTable(
  'auth_sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    client: text('client').notNull().$type<'panel' | 'admin' | 'api'>(),
    refreshTokenHash: text('refresh_token_hash'),
    issuedAt: text('issued_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    lastActivityAt: text('last_activity_at').notNull(),
    revokedAt: text('revoked_at'),
    revokedReason: text('revoked_reason').$type<'logout' | 'takeover' | 'admin' | 'expiry'>(),
  },
  (t) => [
    index('auth_sessions_user_id_idx').on(t.userId),
    index('auth_sessions_expires_at_idx').on(t.expiresAt),
    enumCheck('auth_sessions_client_check', t.client, ['panel', 'admin', 'api']),
    enumCheck('auth_sessions_revoked_reason_check', t.revokedReason, ['logout', 'takeover', 'admin', 'expiry']),
  ],
);

export const userImportBatches = sqliteTable(
  'user_import_batches',
  {
    id: text('id').primaryKey(),
    filename: text('filename').notNull(),
    uploadedBy: text('uploaded_by')
      .notNull()
      .references(() => users.id),
    uploadedAt: text('uploaded_at').notNull(),
    state: text('state').notNull().$type<'validating' | 'rejected' | 'applied'>(),
    rowCount: integer('row_count').notNull(),
    acceptedCount: integer('accepted_count').notNull(),
    rejections: json<Array<{ row: number; column: string; reason: string }>>('rejections').notNull(),
  },
  (t) => [enumCheck('user_import_batches_state_check', t.state, ['validating', 'rejected', 'applied'])],
);

// ---------------------------------------------------------------------------
// Context C — Lecture capture & artifacts (domain-model §6)
// ---------------------------------------------------------------------------

export const lectureSessions = sqliteTable(
  'lecture_sessions',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    hallCode: text('hall_code').notNull(),
    hallDisplayName: text('hall_display_name').notNull(),
    deviceId: text('device_id').notNull(),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => users.id),
    startedByActor: text('started_by_actor').notNull().$type<'user'>(),
    state: text('state')
      .notNull()
      .$type<'starting' | 'recording' | 'paused' | 'stopping' | 'finalizing' | 'completed' | 'error'>(),
    startedAt: text('started_at').notNull(),
    endedAt: text('ended_at'),
    wallDurationMs: bigint('wall_duration_ms'),
    recordedDurationMs: bigint('recorded_duration_ms'),
    pauseCount: integer('pause_count').notNull(),
    channelActivations: json<unknown[]>('channel_activations').notNull(),
    sourceSnapshot: json<Record<string, { inputId: string | null; address: string | null }>>(
      'source_snapshot',
    ).notNull(),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    recoveredAt: text('recovered_at'),
    recoveryOutcome: text('recovery_outcome').$type<'auto-resumed' | 'finalized'>(),
    aiEnabledAtStart: bool('ai_enabled_at_start').notNull(),
    takeoverBy: text('takeover_by').references(() => users.id),
    takeoverAt: text('takeover_at'),
  },
  (t) => [
    uniqueIndex('one_active_session')
      .on(t.deviceId)
      .where(sql`${t.state} IN ('starting','recording','paused','stopping','finalizing')`),
    enumCheck('lecture_sessions_started_by_actor_check', t.startedByActor, ['user']),
    enumCheck('lecture_sessions_state_check', t.state, [
      'starting',
      'recording',
      'paused',
      'stopping',
      'finalizing',
      'completed',
      'error',
    ]),
    enumCheck('lecture_sessions_recovery_outcome_check', t.recoveryOutcome, ['auto-resumed', 'finalized']),
  ],
);

export const recordings = sqliteTable(
  'recordings',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => lectureSessions.id),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => users.id),
    state: text('state').notNull().$type<'capturing' | 'finalizing' | 'merging' | 'ready' | 'failed' | 'deleted'>(),
    layoutPresetId: text('layout_preset_id')
      .notNull()
      .references((): SQLiteColumn => layoutPresets.id),
    durationMs: bigint('duration_ms'),
    totalBytes: bigint('total_bytes'),
    segmentCount: integer('segment_count').notNull(),
    mergeState: text('merge_state').notNull().$type<'not-needed' | 'pending' | 'running' | 'done' | 'failed'>(),
    retentionDeleteAfter: text('retention_delete_after').notNull(),
    deletedAt: text('deleted_at'),
    deletedBy: text('deleted_by').references(() => users.id),
    deleteReason: text('delete_reason').$type<'admin' | 'retention' | 'disk-pressure'>(),
    playbackAuthRequired: bool('playback_auth_required').notNull(),
  },
  (t) => [
    uniqueIndex('recordings_session_id_unique').on(t.sessionId),
    index('recordings_owner_user_id_state_idx').on(t.ownerUserId, t.state),
    index('recordings_retention_delete_after_idx').on(t.retentionDeleteAfter),
    enumCheck('recordings_state_check', t.state, ['capturing', 'finalizing', 'merging', 'ready', 'failed', 'deleted']),
    enumCheck('recordings_merge_state_check', t.mergeState, ['not-needed', 'pending', 'running', 'done', 'failed']),
    enumCheck('recordings_delete_reason_check', t.deleteReason, ['admin', 'retention', 'disk-pressure']),
  ],
);

export const recordingSegments = sqliteTable(
  'recording_segments',
  {
    id: text('id').primaryKey(),
    recordingId: text('recording_id')
      .notNull()
      .references(() => recordings.id),
    index: integer('index').notNull(),
    startedAt: text('started_at').notNull(),
    endedAt: text('ended_at'),
    durationMs: bigint('duration_ms'),
    /** Null while `state = capturing` — a segment's end reason is only knowable once it has ended (SEG-1); `endedAt`/`durationMs` are nullable for the same reason. */
    endReason: text('end_reason').$type<'pause' | 'stop' | 'crash' | 'error' | 'takeover'>(),
    state: text('state').notNull().$type<'capturing' | 'finalizing' | 'finalized' | 'truncated' | 'failed'>(),
  },
  (t) => [
    uniqueIndex('recording_segments_recording_id_index_unique').on(t.recordingId, t.index),
    enumCheck('recording_segments_end_reason_check', t.endReason, ['pause', 'stop', 'crash', 'error', 'takeover']),
    enumCheck('recording_segments_state_check', t.state, [
      'capturing',
      'finalizing',
      'finalized',
      'truncated',
      'failed',
    ]),
  ],
);

export const recordingFiles = sqliteTable(
  'recording_files',
  {
    id: text('id').primaryKey(),
    recordingId: text('recording_id')
      .notNull()
      .references(() => recordings.id),
    segmentId: text('segment_id').references(() => recordingSegments.id),
    kind: text('kind').notNull().$type<'segment' | 'merged' | 'derived'>(),
    streamKey: text('stream_key').notNull(),
    path: text('path').notNull(),
    container: text('container').notNull().$type<'mpegts' | 'mp4'>(),
    sizeBytes: bigint('size_bytes'),
    durationMs: bigint('duration_ms'),
    checksum: text('checksum'),
    state: text('state').notNull().$type<'writing' | 'finalized' | 'missing' | 'deleted'>(),
    hasAudio: bool('has_audio').notNull(),
    isUploadable: bool('is_uploadable').notNull(),
  },
  (t) => [
    index('recording_files_recording_id_idx').on(t.recordingId),
    index('recording_files_segment_id_idx').on(t.segmentId),
    enumCheck('recording_files_kind_check', t.kind, ['segment', 'merged', 'derived']),
    enumCheck('recording_files_container_check', t.container, ['mpegts', 'mp4']),
    enumCheck('recording_files_state_check', t.state, ['writing', 'finalized', 'missing', 'deleted']),
  ],
);

export const exportJobs = sqliteTable(
  'export_jobs',
  {
    id: text('id').primaryKey(),
    requestedBy: text('requested_by')
      .notNull()
      .references(() => users.id),
    requestedAt: text('requested_at').notNull(),
    authSessionId: text('auth_session_id')
      .notNull()
      .references(() => authSessions.id),
    targetVolume: json<{ devicePath: string; mountPath: string; label: string | null; capacityBytes: string }>(
      'target_volume',
    ).notNull(),
    recordingIds: json<string[]>('recording_ids').notNull(),
    fileIds: json<string[]>('file_ids').notNull(),
    bytesTotal: bigint('bytes_total').notNull(),
    bytesCopied: bigint('bytes_copied').notNull(),
    state: text('state').notNull().$type<'queued' | 'copying' | 'completed' | 'failed' | 'cancelled'>(),
    error: text('error'),
  },
  (t) => [
    index('export_jobs_state_idx').on(t.state),
    enumCheck('export_jobs_state_check', t.state, ['queued', 'copying', 'completed', 'failed', 'cancelled']),
  ],
);

// ---------------------------------------------------------------------------
// Context D — Distribution & retention (domain-model §7)
// ---------------------------------------------------------------------------

export const uploadJobs = sqliteTable(
  'upload_jobs',
  {
    id: text('id').primaryKey(),
    recordingId: text('recording_id')
      .notNull()
      .references(() => recordings.id),
    adapterId: text('adapter_id').notNull(),
    state: text('state')
      .notNull()
      .$type<'queued' | 'uploading' | 'completing' | 'done' | 'failed' | 'dead-letter' | 'cancelled'>(),
    attempt: integer('attempt').notNull(),
    nextAttemptAt: text('next_attempt_at'),
    lastError: text('last_error'),
    lastErrorAt: text('last_error_at'),
    failureClass: text('failure_class'),
    blockedBy: text('blocked_by'),
    remoteLectureId: text('remote_lecture_id'),
    metadata: json<unknown>('metadata').notNull(),
    enqueuedAt: text('enqueued_at').notNull(),
    startedAt: text('started_at'),
    completedAt: text('completed_at'),
    requeuedBy: text('requeued_by').references(() => users.id),
    requeuedAt: text('requeued_at'),
    remoteCleanupState: text('remote_cleanup_state').notNull().$type<'not-needed' | 'pending' | 'done' | 'failed'>(),
  },
  (t) => [
    uniqueIndex('one_upload_job_per_recording').on(t.recordingId),
    index('upload_jobs_state_next_attempt_at_idx').on(t.state, t.nextAttemptAt),
    enumCheck('upload_jobs_state_check', t.state, [
      'queued',
      'uploading',
      'completing',
      'done',
      'failed',
      'dead-letter',
      'cancelled',
    ]),
    enumCheck('upload_jobs_remote_cleanup_state_check', t.remoteCleanupState, [
      'not-needed',
      'pending',
      'done',
      'failed',
    ]),
  ],
);

export const uploadFileParts = sqliteTable(
  'upload_file_parts',
  {
    id: text('id').primaryKey(),
    uploadJobId: text('upload_job_id')
      .notNull()
      .references(() => uploadJobs.id),
    recordingFileId: text('recording_file_id')
      .notNull()
      .references(() => recordingFiles.id),
    streamKey: text('stream_key').notNull(),
    state: text('state').notNull().$type<'pending' | 'uploading' | 'uploaded' | 'missing' | 'failed'>(),
    bytesTotal: bigint('bytes_total').notNull(),
    bytesSent: bigint('bytes_sent').notNull(),
    resumeToken: text('resume_token'),
    remoteFileId: text('remote_file_id'),
    checksum: text('checksum'),
    attempt: integer('attempt').notNull(),
    lastError: text('last_error'),
  },
  (t) => [
    uniqueIndex('one_part_per_file').on(t.uploadJobId, t.recordingFileId),
    enumCheck('upload_file_parts_state_check', t.state, ['pending', 'uploading', 'uploaded', 'missing', 'failed']),
  ],
);

export const retentionPolicy = sqliteTable(
  'retention_policy',
  {
    id: text('id').primaryKey().default('retention-policy'),
    maxAgeDays: integer('max_age_days').notNull(),
    warningThresholdPct: integer('warning_threshold_pct').notNull(),
    criticalThresholdPct: integer('critical_threshold_pct').notNull(),
    earlyDeleteOrder: text('early_delete_order').notNull().$type<'uploaded-oldest-first'>(),
    neverDeleteUnuploaded: bool('never_delete_unuploaded').notNull(),
    refuseStartWhenCritical: bool('refuse_start_when_critical').notNull(),
    updatedAt: text('updated_at'),
    updatedBy: text('updated_by').references(() => users.id),
  },
  (t) => [
    check('retention_policy_singleton', sql`${t.id} = 'retention-policy'`),
    enumCheck('retention_policy_early_delete_order_check', t.earlyDeleteOrder, ['uploaded-oldest-first']),
  ],
);

// ---------------------------------------------------------------------------
// Context A — Device, provisioning & capture configuration (domain-model §4)
// ---------------------------------------------------------------------------

export const deviceHealth = sqliteTable(
  'device_health',
  {
    id: text('id').primaryKey().default('device-health'),
    deviceId: text('device_id').notNull(),
    observedAt: text('observed_at').notNull(),
    storageTotalBytes: bigint('storage_total_bytes').notNull(),
    storageFreeBytes: bigint('storage_free_bytes').notNull(),
    storagePressure: text('storage_pressure').notNull().$type<'ok' | 'warning' | 'critical'>(),
    diskHealth: text('disk_health').notNull().$type<'good' | 'warning' | 'failing' | 'unknown'>(),
    captureCardState: text('capture_card_state').notNull().$type<'present' | 'absent' | 'recovering' | 'failed'>(),
    publisherStates: json<Record<string, { status: string; lastErrorCode: string | null; since: string }>>(
      'publisher_states',
    ).notNull(),
    ntpSynced: bool('ntp_synced').notNull(),
    clockOffsetMs: integer('clock_offset_ms'),
    lastBootAt: text('last_boot_at').notNull(),
    cpuLoad1m: real('cpu_load_1m'),
    tempC: real('temp_c'),
  },
  (t) => [
    check('device_health_singleton', sql`${t.id} = 'device-health'`),
    enumCheck('device_health_storage_pressure_check', t.storagePressure, ['ok', 'warning', 'critical']),
    enumCheck('device_health_disk_health_check', t.diskHealth, ['good', 'warning', 'failing', 'unknown']),
    enumCheck('device_health_capture_card_state_check', t.captureCardState, [
      'present',
      'absent',
      'recovering',
      'failed',
    ]),
  ],
);

export const storageVolumes = sqliteTable(
  'storage_volumes',
  {
    id: text('id').primaryKey(),
    uuid: text('uuid').notNull(),
    devicePath: text('device_path').notNull(),
    mountPath: text('mount_path').notNull(),
    label: text('label'),
    filesystem: text('filesystem').notNull(),
    capacityBytes: bigint('capacity_bytes').notNull(),
    freeBytes: bigint('free_bytes').notNull(),
    smartStatus: text('smart_status').notNull().$type<'good' | 'warning' | 'failing' | 'unknown'>(),
    role: text('role').notNull().$type<'recordings' | 'system'>(),
    state: text('state').notNull().$type<'registered' | 'mounted' | 'missing' | 'formatting' | 'failed'>(),
    registeredAt: text('registered_at').notNull(),
    registeredBy: text('registered_by').references(() => users.id),
  },
  (t) => [
    uniqueIndex('one_storage_volume_per_uuid').on(t.uuid),
    uniqueIndex('one_recordings_volume')
      .on(t.role)
      .where(sql`${t.role} = 'recordings' AND ${t.state} = 'mounted'`),
    enumCheck('storage_volumes_smart_status_check', t.smartStatus, ['good', 'warning', 'failing', 'unknown']),
    enumCheck('storage_volumes_role_check', t.role, ['recordings', 'system']),
    enumCheck('storage_volumes_state_check', t.state, ['registered', 'mounted', 'missing', 'formatting', 'failed']),
  ],
);

export const networkConfigs = sqliteTable(
  'network_configs',
  {
    id: text('id').primaryKey(),
    interfaceName: text('interface_name').notNull(),
    kind: text('kind').notNull().$type<'lan' | 'vlan'>(),
    vlanId: integer('vlan_id'),
    addressMode: text('address_mode').notNull().$type<'dhcp' | 'static'>(),
    ipv4Address: text('ipv4_address'),
    prefixLength: integer('prefix_length'),
    gateway: text('gateway'),
    dnsServers: json<string[]>('dns_servers').notNull(),
    appliedAt: text('applied_at'),
    appliedBy: text('applied_by').references(() => users.id),
    lastApplyError: text('last_apply_error'),
  },
  (t) => [
    uniqueIndex('network_configs_interface_name_unique').on(t.interfaceName),
    enumCheck('network_configs_kind_check', t.kind, ['lan', 'vlan']),
    enumCheck('network_configs_address_mode_check', t.addressMode, ['dhcp', 'static']),
  ],
);

export const sourceRoles = sqliteTable(
  'source_roles',
  {
    id: text('id')
      .primaryKey()
      .$type<'presentation' | 'lecturer-cam' | 'students-cam' | 'mic-lecturer' | 'mic-room'>(),
    medium: text('medium').notNull().$type<'video' | 'audio'>(),
    displayLabel: text('display_label').notNull(),
    requiredForStart: bool('required_for_start').notNull(),
    provisionable: bool('provisionable').notNull(),
  },
  (t) => [
    enumCheck('source_roles_id_check', t.id, [
      'presentation',
      'lecturer-cam',
      'students-cam',
      'mic-lecturer',
      'mic-room',
    ]),
    enumCheck('source_roles_medium_check', t.medium, ['video', 'audio']),
  ],
);

export const physicalInputs = sqliteTable(
  'physical_inputs',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull().$type<'v4l2' | 'rtsp' | 'alsa'>(),
    address: text('address').notNull(),
    credentialRef: text('credential_ref'),
    transport: text('transport').$type<'tcp' | 'udp'>(),
    expectedCodec: text('expected_codec').$type<'h264' | 'raw-nv12' | 's16le'>(),
    stableIdentifier: text('stable_identifier'),
    hubPort: text('hub_port'),
    presenceState: text('presence_state').notNull().$type<'present' | 'absent' | 'error' | 'unknown'>(),
    lastSeenAt: text('last_seen_at'),
    updatedAt: text('updated_at').notNull(),
    updatedBy: text('updated_by').references(() => users.id),
  },
  (t) => [
    uniqueIndex('physical_inputs_stable_identifier_unique')
      .on(t.stableIdentifier)
      .where(sql`${t.stableIdentifier} IS NOT NULL`),
    enumCheck('physical_inputs_kind_check', t.kind, ['v4l2', 'rtsp', 'alsa']),
    enumCheck('physical_inputs_transport_check', t.transport, ['tcp', 'udp']),
    enumCheck('physical_inputs_expected_codec_check', t.expectedCodec, ['h264', 'raw-nv12', 's16le']),
    enumCheck('physical_inputs_presence_state_check', t.presenceState, ['present', 'absent', 'error', 'unknown']),
  ],
);

export const sourceBindings = sqliteTable(
  'source_bindings',
  {
    roleId: text('role_id')
      .primaryKey()
      .references(() => sourceRoles.id),
    physicalInputId: text('physical_input_id').references(() => physicalInputs.id),
    enabled: bool('enabled').notNull(),
    updatedAt: text('updated_at').notNull(),
    updatedBy: text('updated_by').references(() => users.id),
  },
  (t) => [uniqueIndex('source_bindings_physical_input_id_unique').on(t.physicalInputId)],
);

export const audioControls = sqliteTable(
  'audio_controls',
  {
    roleId: text('role_id')
      .primaryKey()
      .references(() => sourceRoles.id),
    gain: integer('gain').notNull(),
    muted: bool('muted').notNull(),
    appliedState: text('applied_state').notNull().$type<'applied' | 'pending' | 'failed'>(),
    lastAppliedAt: text('last_applied_at'),
    lastError: text('last_error'),
    updatedBy: text('updated_by').references(() => users.id),
  },
  (t) => [enumCheck('audio_controls_applied_state_check', t.appliedState, ['applied', 'pending', 'failed'])],
);

export const encodingProfiles = sqliteTable(
  'encoding_profiles',
  {
    id: text('id').primaryKey(),
    scope: text('scope').notNull().$type<'device-default' | 'channel'>(),
    channelId: text('channel_id').references((): SQLiteColumn => channelConfigs.channelId),
    videoBitrateKbps: integer('video_bitrate_kbps').notNull(),
    framerate: integer('framerate').notNull(),
    gop: integer('gop').notNull(),
    rateControl: text('rate_control').notNull().$type<'cbr' | 'vbr'>(),
    codec: text('codec').notNull().$type<'h264'>(),
    container: text('container').notNull().$type<'mpegts' | 'mp4' | 'flv'>(),
    audioCodec: text('audio_codec').notNull().$type<'aac'>(),
    audioBitrateKbps: integer('audio_bitrate_kbps').notNull(),
    capabilityVerifiedAt: text('capability_verified_at'),
  },
  (t) => [
    uniqueIndex('one_device_default_encoding_profile')
      .on(t.scope)
      .where(sql`${t.scope} = 'device-default'`),
    enumCheck('encoding_profiles_scope_check', t.scope, ['device-default', 'channel']),
    enumCheck('encoding_profiles_rate_control_check', t.rateControl, ['cbr', 'vbr']),
    enumCheck('encoding_profiles_codec_check', t.codec, ['h264']),
    enumCheck('encoding_profiles_container_check', t.container, ['mpegts', 'mp4', 'flv']),
    enumCheck('encoding_profiles_audio_codec_check', t.audioCodec, ['aac']),
  ],
);

export const layoutPresets = sqliteTable(
  'layout_presets',
  {
    id: text('id')
      .primaryKey()
      .$type<
        | 'fifty-fifty'
        | 'cams-fifty-fifty'
        | 'side-by-side'
        | 'cam-1'
        | 'cam-2'
        | 'pc-only'
        | 'separate-files'
      >(),
    displayName: text('display_name').notNull(),
    description: text('description').notNull(),
    allowedChannels: json<string[]>('allowed_channels').notNull(),
    kind: text('kind').notNull().$type<'single' | 'composite' | 'multi-file'>(),
    canvas: json<{ width: number; height: number }>('canvas').notNull(),
    tiles: json<unknown[]>('tiles').notNull(),
    parametric: bool('parametric').notNull(),
    outputs: json<unknown[]>('outputs').notNull(),
    passthroughEligible: bool('passthrough_eligible').notNull(),
    requiredRoles: json<string[]>('required_roles').notNull(),
  },
  (t) => [
    enumCheck('layout_presets_id_check', t.id, [
      'fifty-fifty',
      'cams-fifty-fifty',
      'side-by-side',
      'cam-1',
      'cam-2',
      'pc-only',
      'separate-files',
    ]),
    enumCheck('layout_presets_kind_check', t.kind, ['single', 'composite', 'multi-file']),
  ],
);

export const channelConfigs = sqliteTable(
  'channel_configs',
  {
    channelId: text('channel_id').primaryKey().$type<'local' | 'meeting' | 'streaming'>(),
    alwaysOn: bool('always_on').notNull(),
    enabledByDefault: bool('enabled_by_default').notNull(),
    presetId: text('preset_id')
      .notNull()
      .references(() => layoutPresets.id),
    ratioA: integer('ratio_a'),
    ratioB: integer('ratio_b'),
    streamTargetIds: json<string[]>('stream_target_ids'),
    updatedAt: text('updated_at').notNull(),
    updatedBy: text('updated_by').references(() => users.id),
  },
  (t) => [enumCheck('channel_configs_channel_id_check', t.channelId, ['local', 'meeting', 'streaming'])],
);

export const streamTargets = sqliteTable(
  'stream_targets',
  {
    id: text('id').primaryKey(),
    platform: text('platform').notNull().$type<'youtube' | 'facebook' | 'custom-rtmp'>(),
    displayName: text('display_name').notNull(),
    ingestUrl: text('ingest_url').notNull(),
    streamKeyRef: text('stream_key_ref').notNull(),
    requiresTlsBridge: bool('requires_tls_bridge').notNull(),
    enabled: bool('enabled').notNull(),
    lastPreflightAt: text('last_preflight_at'),
    lastPreflightResult: text('last_preflight_result').$type<'ok' | 'failed'>(),
  },
  (t) => [
    enumCheck('stream_targets_platform_check', t.platform, ['youtube', 'facebook', 'custom-rtmp']),
    enumCheck('stream_targets_last_preflight_result_check', t.lastPreflightResult, ['ok', 'failed']),
  ],
);

export const firmwareUpdates = sqliteTable(
  'firmware_updates',
  {
    id: text('id').primaryKey(),
    currentVersion: text('current_version').notNull(),
    availableVersion: text('available_version'),
    state: text('state')
      .notNull()
      .$type<'idle' | 'checking' | 'downloading' | 'verifying' | 'applying' | 'rolled-back' | 'failed' | 'done'>(),
    artifactDigest: text('artifact_digest'),
    signatureVerified: bool('signature_verified').notNull(),
    rollbackVersion: text('rollback_version'),
    startedAt: text('started_at'),
    finishedAt: text('finished_at'),
    lastError: text('last_error'),
    startedBy: text('started_by').references(() => users.id),
  },
  (t) => [
    enumCheck('firmware_updates_state_check', t.state, [
      'idle',
      'checking',
      'downloading',
      'verifying',
      'applying',
      'rolled-back',
      'failed',
      'done',
    ]),
  ],
);

// ---------------------------------------------------------------------------
// Context E — AI & quiz (domain-model §8)
// ---------------------------------------------------------------------------

export const transcriptSegments = sqliteTable(
  'transcript_segments',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => lectureSessions.id),
    startOffsetMs: bigint('start_offset_ms').notNull(),
    endOffsetMs: bigint('end_offset_ms').notNull(),
    text: text('text').notNull(),
    confidence: real('confidence'),
    engine: text('engine').notNull(),
    modelVersion: text('model_version').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('transcript_segments_session_id_start_offset_ms_idx').on(t.sessionId, t.startOffsetMs)],
);

export const slideCaptures = sqliteTable(
  'slide_captures',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => lectureSessions.id),
    capturedAt: text('captured_at').notNull(),
    offsetMs: bigint('offset_ms').notNull(),
    imagePath: text('image_path'),
    ocrText: text('ocr_text'),
    dedupeHash: text('dedupe_hash').notNull(),
    isSlideChange: bool('is_slide_change').notNull(),
  },
  (t) => [index('slide_captures_session_id_offset_ms_idx').on(t.sessionId, t.offsetMs)],
);

export const questionSets = sqliteTable(
  'question_sets',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => lectureSessions.id),
    trigger: text('trigger').notNull().$type<'countdown' | 'manual'>(),
    state: text('state')
      .notNull()
      .$type<'requested' | 'generating' | 'ready' | 'failed' | 'reviewed' | 'discarded'>(),
    requestedAt: text('requested_at').notNull(),
    completedAt: text('completed_at'),
    intervalMinutesAtRequest: integer('interval_minutes_at_request').notNull().$type<10 | 15 | 20 | 30>(),
    inputWindow: json<{ fromOffsetMs: number; toOffsetMs: number }>('input_window').notNull(),
    slideCaptureIds: json<string[]>('slide_capture_ids').notNull(),
    modelId: text('model_id').notNull(),
    promptVersion: text('prompt_version').notNull(),
    requestedCount: integer('requested_count').notNull(),
    returnedCount: integer('returned_count'),
    error: text('error'),
  },
  (t) => [
    index('question_sets_session_id_idx').on(t.sessionId),
    enumCheck('question_sets_trigger_check', t.trigger, ['countdown', 'manual']),
    enumCheck('question_sets_state_check', t.state, [
      'requested',
      'generating',
      'ready',
      'failed',
      'reviewed',
      'discarded',
    ]),
    check(
      'question_sets_interval_minutes_at_request_check',
      sql`${t.intervalMinutesAtRequest} IN (10, 15, 20, 30)`,
    ),
  ],
);

export const questions = sqliteTable(
  'questions',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => lectureSessions.id),
    questionSetId: text('question_set_id').references(() => questionSets.id),
    kind: text('kind').notNull().$type<'mcq' | 'short'>(),
    prompt: text('prompt').notNull(),
    correctOptionId: text('correct_option_id').references((): SQLiteColumn => questionOptions.id),
    provenance: text('provenance').notNull().$type<'generated' | 'lecturer-authored'>(),
    edited: bool('edited').notNull(),
    state: text('state').notNull().$type<'draft' | 'sent' | 'closed' | 'discarded'>(),
    createdAt: text('created_at').notNull(),
    createdBy: text('created_by').references(() => users.id),
    orderHint: integer('order_hint'),
  },
  (t) => [
    index('questions_session_id_state_idx').on(t.sessionId, t.state),
    enumCheck('questions_kind_check', t.kind, ['mcq', 'short']),
    enumCheck('questions_provenance_check', t.provenance, ['generated', 'lecturer-authored']),
    enumCheck('questions_state_check', t.state, ['draft', 'sent', 'closed', 'discarded']),
  ],
);

export const questionOptions = sqliteTable(
  'question_options',
  {
    id: text('id').primaryKey(),
    questionId: text('question_id')
      .notNull()
      .references(() => questions.id),
    label: text('label').notNull().$type<'A' | 'B' | 'C' | 'D'>(),
    text: text('text').notNull(),
    position: integer('position').notNull(),
  },
  (t) => [
    uniqueIndex('question_options_question_id_position_unique').on(t.questionId, t.position),
    enumCheck('question_options_label_check', t.label, ['A', 'B', 'C', 'D']),
  ],
);

export const quizSessionProjections = sqliteTable(
  'quiz_session_projections',
  {
    id: text('id').primaryKey(),
    lectureSessionId: text('lecture_session_id')
      .notNull()
      .references(() => lectureSessions.id),
    deviceId: text('device_id').notNull(),
    hallDisplayName: text('hall_display_name').notNull(),
    joinCode: text('join_code'),
    joinUrl: text('join_url'),
    state: text('state').notNull().$type<'absent' | 'requesting' | 'open' | 'closed' | 'failed'>(),
    openedAt: text('opened_at'),
    closedAt: text('closed_at'),
  },
  (t) => [
    uniqueIndex('one_quiz_projection_per_lecture').on(t.lectureSessionId),
    enumCheck('quiz_session_projections_state_check', t.state, ['absent', 'requesting', 'open', 'closed', 'failed']),
  ],
);

export const questionPublications = sqliteTable(
  'question_publications',
  {
    id: text('id').primaryKey(),
    questionId: text('question_id')
      .notNull()
      .references(() => questions.id),
    quizSessionId: text('quiz_session_id')
      .notNull()
      .references(() => quizSessionProjections.id),
    state: text('state').notNull().$type<'publishing' | 'open' | 'closed' | 'failed'>(),
    publishedAt: text('published_at'),
    closedAt: text('closed_at'),
    closeReason: text('close_reason').$type<'next-question' | 'session-ended' | 'lecturer-closed'>(),
    isShowing: bool('is_showing').notNull(),
    projectorState: text('projector_state').notNull().$type<'not-shown' | 'showing' | 'withdrawn'>(),
    syncState: text('sync_state').notNull().$type<'synced' | 'stale' | 'failed'>(),
  },
  (t) => [
    uniqueIndex('one_showing_publication')
      .on(t.quizSessionId)
      .where(sql`${t.isShowing} = 1`),
    enumCheck('question_publications_state_check', t.state, ['publishing', 'open', 'closed', 'failed']),
    enumCheck('question_publications_close_reason_check', t.closeReason, [
      'next-question',
      'session-ended',
      'lecturer-closed',
    ]),
    enumCheck('question_publications_projector_state_check', t.projectorState, ['not-shown', 'showing', 'withdrawn']),
    enumCheck('question_publications_sync_state_check', t.syncState, ['synced', 'stale', 'failed']),
  ],
);

export const answerProjections = sqliteTable(
  'answer_projections',
  {
    id: text('id').primaryKey(),
    publicationId: text('publication_id')
      .notNull()
      .references(() => questionPublications.id),
    studentIdNumber: text('student_id_number').notNull(),
    studentDisplayName: text('student_display_name').notNull(),
    selectedOptionId: text('selected_option_id')
      .notNull()
      .references(() => questionOptions.id),
    isCorrect: bool('is_correct').notNull(),
    responseTimeMs: integer('response_time_ms').notNull(),
    submittedAt: text('submitted_at').notNull(),
    syncedAt: text('synced_at').notNull(),
  },
  (t) => [uniqueIndex('one_answer_projection').on(t.publicationId, t.studentIdNumber)],
);

// ---------------------------------------------------------------------------
// Context F — Observability (domain-model §9)
// ---------------------------------------------------------------------------

export const logEntries = sqliteTable(
  'log_entries',
  {
    id: text('id').primaryKey(),
    at: text('at').notNull(),
    level: text('level').notNull().$type<'INFO' | 'WARN' | 'ERROR'>(),
    category: text('category').notNull().$type<'Auth' | 'System' | 'Hardware' | 'Session'>(),
    service: text('service').notNull().$type<'core-api' | 'pipeline-manager' | 'ai' | 'deploy' | 'quiz-sync'>(),
    message: text('message').notNull(),
    context: json<unknown>('context'),
    sessionId: text('session_id').references(() => lectureSessions.id),
    userId: text('user_id').references(() => users.id),
  },
  (t) => [
    index('log_entries_at_idx').on(t.at),
    index('log_entries_level_idx').on(t.level),
    index('log_entries_category_idx').on(t.category),
    index('log_entries_session_id_idx').on(t.sessionId),
    enumCheck('log_entries_level_check', t.level, ['INFO', 'WARN', 'ERROR']),
    enumCheck('log_entries_category_check', t.category, ['Auth', 'System', 'Hardware', 'Session']),
    enumCheck('log_entries_service_check', t.service, ['core-api', 'pipeline-manager', 'ai', 'deploy', 'quiz-sync']),
  ],
);

export const systemAlerts = sqliteTable(
  'system_alerts',
  {
    id: text('id').primaryKey(),
    code: text('code').notNull(),
    severity: text('severity').notNull().$type<'info' | 'warning' | 'error' | 'critical'>(),
    category: text('category').notNull().$type<'Auth' | 'System' | 'Hardware' | 'Session'>(),
    title: text('title').notNull(),
    detail: text('detail'),
    raisedAt: text('raised_at').notNull(),
    clearedAt: text('cleared_at'),
    clearedReason: text('cleared_reason').$type<'resolved' | 'acknowledged' | 'superseded'>(),
    acknowledgedBy: text('acknowledged_by').references(() => users.id),
    context: json<unknown>('context'),
    relatedEntity: json<{ type: string; id: string }>('related_entity'),
  },
  (t) => [
    index('system_alerts_code_idx')
      .on(t.code)
      .where(sql`${t.clearedAt} IS NULL`),
    enumCheck('system_alerts_severity_check', t.severity, ['info', 'warning', 'error', 'critical']),
    enumCheck('system_alerts_category_check', t.category, ['Auth', 'System', 'Hardware', 'Session']),
    enumCheck('system_alerts_cleared_reason_check', t.clearedReason, ['resolved', 'acknowledged', 'superseded']),
  ],
);

export const auditLogEntries = sqliteTable(
  'audit_log_entries',
  {
    id: text('id').primaryKey(),
    at: text('at').notNull(),
    actorUserId: text('actor_user_id').references(() => users.id),
    actorKind: text('actor_kind').notNull().$type<'user' | 'system' | 'deploy'>(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    action: text('action')
      .notNull()
      .$type<
        | 'create'
        | 'edit'
        | 'discard'
        | 'regenerate'
        | 'send'
        | 'close'
        | 'delete'
        | 'import'
        | 'takeover'
        | 'config-change'
      >(),
    sessionId: text('session_id').references(() => lectureSessions.id),
    before: json<unknown>('before'),
    after: json<unknown>('after'),
    reason: text('reason'),
  },
  (t) => [
    index('audit_log_entries_entity_type_entity_id_idx').on(t.entityType, t.entityId),
    index('audit_log_entries_session_id_idx').on(t.sessionId),
    enumCheck('audit_log_entries_actor_kind_check', t.actorKind, ['user', 'system', 'deploy']),
    enumCheck('audit_log_entries_action_check', t.action, [
      'create',
      'edit',
      'discard',
      'regenerate',
      'send',
      'close',
      'delete',
      'import',
      'takeover',
      'config-change',
    ]),
  ],
);
