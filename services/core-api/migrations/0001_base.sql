CREATE TABLE `answer_projections` (
	`id` text PRIMARY KEY NOT NULL,
	`publication_id` text NOT NULL,
	`student_id_number` text NOT NULL,
	`student_display_name` text NOT NULL,
	`selected_option_id` text NOT NULL,
	`is_correct` integer NOT NULL,
	`response_time_ms` integer NOT NULL,
	`submitted_at` text NOT NULL,
	`synced_at` text NOT NULL,
	FOREIGN KEY (`publication_id`) REFERENCES `question_publications`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`selected_option_id`) REFERENCES `question_options`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `one_answer_projection` ON `answer_projections` (`publication_id`,`student_id_number`);--> statement-breakpoint
CREATE TABLE `audio_controls` (
	`role_id` text PRIMARY KEY NOT NULL,
	`gain` integer NOT NULL,
	`muted` integer NOT NULL,
	`applied_state` text NOT NULL,
	`last_applied_at` text,
	`last_error` text,
	`updated_by` text,
	FOREIGN KEY (`role_id`) REFERENCES `source_roles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "audio_controls_applied_state_check" CHECK("audio_controls"."applied_state" IN ('applied', 'pending', 'failed'))
);
--> statement-breakpoint
CREATE TABLE `audit_log_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`at` text NOT NULL,
	`actor_user_id` text,
	`actor_kind` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`session_id` text,
	`before` text,
	`after` text,
	`reason` text,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `lecture_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "audit_log_entries_actor_kind_check" CHECK("audit_log_entries"."actor_kind" IN ('user', 'system', 'deploy')),
	CONSTRAINT "audit_log_entries_action_check" CHECK("audit_log_entries"."action" IN ('create', 'edit', 'discard', 'regenerate', 'send', 'close', 'delete', 'import', 'takeover', 'config-change'))
);
--> statement-breakpoint
CREATE INDEX `audit_log_entries_entity_type_entity_id_idx` ON `audit_log_entries` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `audit_log_entries_session_id_idx` ON `audit_log_entries` (`session_id`);--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`client` text NOT NULL,
	`refresh_token_hash` text,
	`issued_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`last_activity_at` text NOT NULL,
	`revoked_at` text,
	`revoked_reason` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "auth_sessions_client_check" CHECK("auth_sessions"."client" IN ('panel', 'admin', 'api')),
	CONSTRAINT "auth_sessions_revoked_reason_check" CHECK("auth_sessions"."revoked_reason" IN ('logout', 'takeover', 'admin', 'expiry'))
);
--> statement-breakpoint
CREATE INDEX `auth_sessions_user_id_idx` ON `auth_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `auth_sessions_expires_at_idx` ON `auth_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `channel_configs` (
	`channel_id` text PRIMARY KEY NOT NULL,
	`always_on` integer NOT NULL,
	`enabled_by_default` integer NOT NULL,
	`preset_id` text NOT NULL,
	`ratio_a` integer,
	`ratio_b` integer,
	`stream_target_ids` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`preset_id`) REFERENCES `layout_presets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "channel_configs_channel_id_check" CHECK("channel_configs"."channel_id" IN ('local', 'meeting', 'streaming'))
);
--> statement-breakpoint
CREATE TABLE `device_health` (
	`id` text PRIMARY KEY DEFAULT 'device-health' NOT NULL,
	`device_id` text NOT NULL,
	`observed_at` text NOT NULL,
	`storage_total_bytes` integer NOT NULL,
	`storage_free_bytes` integer NOT NULL,
	`storage_pressure` text NOT NULL,
	`disk_health` text NOT NULL,
	`capture_card_state` text NOT NULL,
	`publisher_states` text NOT NULL,
	`ntp_synced` integer NOT NULL,
	`clock_offset_ms` integer,
	`last_boot_at` text NOT NULL,
	`cpu_load_1m` real,
	`temp_c` real,
	CONSTRAINT "device_health_singleton" CHECK("device_health"."id" = 'device-health'),
	CONSTRAINT "device_health_storage_pressure_check" CHECK("device_health"."storage_pressure" IN ('ok', 'warning', 'critical')),
	CONSTRAINT "device_health_disk_health_check" CHECK("device_health"."disk_health" IN ('good', 'warning', 'failing', 'unknown')),
	CONSTRAINT "device_health_capture_card_state_check" CHECK("device_health"."capture_card_state" IN ('present', 'absent', 'recovering', 'failed'))
);
--> statement-breakpoint
CREATE TABLE `encoding_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`channel_id` text,
	`video_bitrate_kbps` integer NOT NULL,
	`framerate` integer NOT NULL,
	`gop` integer NOT NULL,
	`rate_control` text NOT NULL,
	`codec` text NOT NULL,
	`container` text NOT NULL,
	`audio_codec` text NOT NULL,
	`audio_bitrate_kbps` integer NOT NULL,
	`capability_verified_at` text,
	FOREIGN KEY (`channel_id`) REFERENCES `channel_configs`(`channel_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "encoding_profiles_scope_check" CHECK("encoding_profiles"."scope" IN ('device-default', 'channel')),
	CONSTRAINT "encoding_profiles_rate_control_check" CHECK("encoding_profiles"."rate_control" IN ('cbr', 'vbr')),
	CONSTRAINT "encoding_profiles_codec_check" CHECK("encoding_profiles"."codec" IN ('h264')),
	CONSTRAINT "encoding_profiles_container_check" CHECK("encoding_profiles"."container" IN ('mpegts', 'mp4', 'flv')),
	CONSTRAINT "encoding_profiles_audio_codec_check" CHECK("encoding_profiles"."audio_codec" IN ('aac'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `one_device_default_encoding_profile` ON `encoding_profiles` (`scope`) WHERE "encoding_profiles"."scope" = 'device-default';--> statement-breakpoint
CREATE TABLE `export_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`requested_by` text NOT NULL,
	`requested_at` text NOT NULL,
	`auth_session_id` text NOT NULL,
	`target_volume` text NOT NULL,
	`recording_ids` text NOT NULL,
	`file_ids` text NOT NULL,
	`bytes_total` integer NOT NULL,
	`bytes_copied` integer NOT NULL,
	`state` text NOT NULL,
	`error` text,
	FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`auth_session_id`) REFERENCES `auth_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "export_jobs_state_check" CHECK("export_jobs"."state" IN ('queued', 'copying', 'completed', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX `export_jobs_state_idx` ON `export_jobs` (`state`);--> statement-breakpoint
CREATE TABLE `firmware_updates` (
	`id` text PRIMARY KEY NOT NULL,
	`current_version` text NOT NULL,
	`available_version` text,
	`state` text NOT NULL,
	`artifact_digest` text,
	`signature_verified` integer NOT NULL,
	`rollback_version` text,
	`started_at` text,
	`finished_at` text,
	`last_error` text,
	`started_by` text,
	FOREIGN KEY (`started_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "firmware_updates_state_check" CHECK("firmware_updates"."state" IN ('idle', 'checking', 'downloading', 'verifying', 'applying', 'rolled-back', 'failed', 'done'))
);
--> statement-breakpoint
CREATE TABLE `layout_presets` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`description` text NOT NULL,
	`allowed_channels` text NOT NULL,
	`kind` text NOT NULL,
	`canvas` text NOT NULL,
	`tiles` text NOT NULL,
	`parametric` integer NOT NULL,
	`outputs` text NOT NULL,
	`passthrough_eligible` integer NOT NULL,
	`required_roles` text NOT NULL,
	CONSTRAINT "layout_presets_id_check" CHECK("layout_presets"."id" IN ('fifty-fifty', 'cams-fifty-fifty', 'side-by-side', 'cam-1', 'cam-2', 'pc-only', 'separate-files')),
	CONSTRAINT "layout_presets_kind_check" CHECK("layout_presets"."kind" IN ('single', 'composite', 'multi-file'))
);
--> statement-breakpoint
CREATE TABLE `lecture_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`hall_code` text NOT NULL,
	`hall_display_name` text NOT NULL,
	`device_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`started_by_actor` text NOT NULL,
	`state` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`wall_duration_ms` integer,
	`recorded_duration_ms` integer,
	`pause_count` integer NOT NULL,
	`channel_activations` text NOT NULL,
	`source_snapshot` text NOT NULL,
	`error_code` text,
	`error_message` text,
	`recovered_at` text,
	`recovery_outcome` text,
	`ai_enabled_at_start` integer NOT NULL,
	`takeover_by` text,
	`takeover_at` text,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`takeover_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "lecture_sessions_started_by_actor_check" CHECK("lecture_sessions"."started_by_actor" IN ('user')),
	CONSTRAINT "lecture_sessions_state_check" CHECK("lecture_sessions"."state" IN ('starting', 'recording', 'paused', 'stopping', 'finalizing', 'completed', 'error')),
	CONSTRAINT "lecture_sessions_recovery_outcome_check" CHECK("lecture_sessions"."recovery_outcome" IN ('auto-resumed', 'finalized'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `one_active_session` ON `lecture_sessions` (`device_id`) WHERE "lecture_sessions"."state" IN ('starting','recording','paused','stopping','finalizing');--> statement-breakpoint
CREATE TABLE `log_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`at` text NOT NULL,
	`level` text NOT NULL,
	`category` text NOT NULL,
	`service` text NOT NULL,
	`message` text NOT NULL,
	`context` text,
	`session_id` text,
	`user_id` text,
	FOREIGN KEY (`session_id`) REFERENCES `lecture_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "log_entries_level_check" CHECK("log_entries"."level" IN ('INFO', 'WARN', 'ERROR')),
	CONSTRAINT "log_entries_category_check" CHECK("log_entries"."category" IN ('Auth', 'System', 'Hardware', 'Session')),
	CONSTRAINT "log_entries_service_check" CHECK("log_entries"."service" IN ('core-api', 'pipeline-manager', 'ai', 'deploy', 'quiz-sync'))
);
--> statement-breakpoint
CREATE INDEX `log_entries_at_idx` ON `log_entries` (`at`);--> statement-breakpoint
CREATE INDEX `log_entries_level_idx` ON `log_entries` (`level`);--> statement-breakpoint
CREATE INDEX `log_entries_category_idx` ON `log_entries` (`category`);--> statement-breakpoint
CREATE INDEX `log_entries_session_id_idx` ON `log_entries` (`session_id`);--> statement-breakpoint
CREATE TABLE `network_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`interface_name` text NOT NULL,
	`kind` text NOT NULL,
	`vlan_id` integer,
	`address_mode` text NOT NULL,
	`ipv4_address` text,
	`prefix_length` integer,
	`gateway` text,
	`dns_servers` text NOT NULL,
	`applied_at` text,
	`applied_by` text,
	`last_apply_error` text,
	FOREIGN KEY (`applied_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "network_configs_kind_check" CHECK("network_configs"."kind" IN ('lan', 'vlan')),
	CONSTRAINT "network_configs_address_mode_check" CHECK("network_configs"."address_mode" IN ('dhcp', 'static'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `network_configs_interface_name_unique` ON `network_configs` (`interface_name`);--> statement-breakpoint
CREATE TABLE `physical_inputs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`address` text NOT NULL,
	`credential_ref` text,
	`transport` text,
	`expected_codec` text,
	`stable_identifier` text,
	`hub_port` text,
	`presence_state` text NOT NULL,
	`last_seen_at` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "physical_inputs_kind_check" CHECK("physical_inputs"."kind" IN ('v4l2', 'rtsp', 'alsa')),
	CONSTRAINT "physical_inputs_transport_check" CHECK("physical_inputs"."transport" IN ('tcp', 'udp')),
	CONSTRAINT "physical_inputs_expected_codec_check" CHECK("physical_inputs"."expected_codec" IN ('h264', 'raw-nv12', 's16le')),
	CONSTRAINT "physical_inputs_presence_state_check" CHECK("physical_inputs"."presence_state" IN ('present', 'absent', 'error', 'unknown'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `physical_inputs_stable_identifier_unique` ON `physical_inputs` (`stable_identifier`) WHERE "physical_inputs"."stable_identifier" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `question_options` (
	`id` text PRIMARY KEY NOT NULL,
	`question_id` text NOT NULL,
	`label` text NOT NULL,
	`text` text NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "question_options_label_check" CHECK("question_options"."label" IN ('A', 'B', 'C', 'D'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `question_options_question_id_position_unique` ON `question_options` (`question_id`,`position`);--> statement-breakpoint
CREATE TABLE `question_publications` (
	`id` text PRIMARY KEY NOT NULL,
	`question_id` text NOT NULL,
	`quiz_session_id` text NOT NULL,
	`state` text NOT NULL,
	`published_at` text,
	`closed_at` text,
	`close_reason` text,
	`is_showing` integer NOT NULL,
	`projector_state` text NOT NULL,
	`sync_state` text NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`quiz_session_id`) REFERENCES `quiz_session_projections`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "question_publications_state_check" CHECK("question_publications"."state" IN ('publishing', 'open', 'closed', 'failed')),
	CONSTRAINT "question_publications_close_reason_check" CHECK("question_publications"."close_reason" IN ('next-question', 'session-ended', 'lecturer-closed')),
	CONSTRAINT "question_publications_projector_state_check" CHECK("question_publications"."projector_state" IN ('not-shown', 'showing', 'withdrawn')),
	CONSTRAINT "question_publications_sync_state_check" CHECK("question_publications"."sync_state" IN ('synced', 'stale', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `one_showing_publication` ON `question_publications` (`quiz_session_id`) WHERE "question_publications"."is_showing" = 1;--> statement-breakpoint
CREATE TABLE `question_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`trigger` text NOT NULL,
	`state` text NOT NULL,
	`requested_at` text NOT NULL,
	`completed_at` text,
	`interval_minutes_at_request` integer NOT NULL,
	`input_window` text NOT NULL,
	`slide_capture_ids` text NOT NULL,
	`model_id` text NOT NULL,
	`prompt_version` text NOT NULL,
	`requested_count` integer NOT NULL,
	`returned_count` integer,
	`error` text,
	FOREIGN KEY (`session_id`) REFERENCES `lecture_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "question_sets_trigger_check" CHECK("question_sets"."trigger" IN ('countdown', 'manual')),
	CONSTRAINT "question_sets_state_check" CHECK("question_sets"."state" IN ('requested', 'generating', 'ready', 'failed', 'reviewed', 'discarded')),
	CONSTRAINT "question_sets_interval_minutes_at_request_check" CHECK("question_sets"."interval_minutes_at_request" IN (10, 15, 20, 30))
);
--> statement-breakpoint
CREATE INDEX `question_sets_session_id_idx` ON `question_sets` (`session_id`);--> statement-breakpoint
CREATE TABLE `questions` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`question_set_id` text,
	`kind` text NOT NULL,
	`prompt` text NOT NULL,
	`correct_option_id` text,
	`provenance` text NOT NULL,
	`edited` integer NOT NULL,
	`state` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`order_hint` integer,
	FOREIGN KEY (`session_id`) REFERENCES `lecture_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`question_set_id`) REFERENCES `question_sets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`correct_option_id`) REFERENCES `question_options`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "questions_kind_check" CHECK("questions"."kind" IN ('mcq', 'short')),
	CONSTRAINT "questions_provenance_check" CHECK("questions"."provenance" IN ('generated', 'lecturer-authored')),
	CONSTRAINT "questions_state_check" CHECK("questions"."state" IN ('draft', 'sent', 'closed', 'discarded'))
);
--> statement-breakpoint
CREATE INDEX `questions_session_id_state_idx` ON `questions` (`session_id`,`state`);--> statement-breakpoint
CREATE TABLE `quiz_session_projections` (
	`id` text PRIMARY KEY NOT NULL,
	`lecture_session_id` text NOT NULL,
	`device_id` text NOT NULL,
	`hall_display_name` text NOT NULL,
	`join_code` text,
	`join_url` text,
	`state` text NOT NULL,
	`opened_at` text,
	`closed_at` text,
	FOREIGN KEY (`lecture_session_id`) REFERENCES `lecture_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "quiz_session_projections_state_check" CHECK("quiz_session_projections"."state" IN ('absent', 'requesting', 'open', 'closed', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `one_quiz_projection_per_lecture` ON `quiz_session_projections` (`lecture_session_id`);--> statement-breakpoint
CREATE TABLE `recording_files` (
	`id` text PRIMARY KEY NOT NULL,
	`recording_id` text NOT NULL,
	`segment_id` text,
	`kind` text NOT NULL,
	`stream_key` text NOT NULL,
	`path` text NOT NULL,
	`container` text NOT NULL,
	`size_bytes` integer,
	`duration_ms` integer,
	`checksum` text,
	`state` text NOT NULL,
	`has_audio` integer NOT NULL,
	`is_uploadable` integer NOT NULL,
	FOREIGN KEY (`recording_id`) REFERENCES `recordings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`segment_id`) REFERENCES `recording_segments`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "recording_files_kind_check" CHECK("recording_files"."kind" IN ('segment', 'merged', 'derived')),
	CONSTRAINT "recording_files_container_check" CHECK("recording_files"."container" IN ('mpegts', 'mp4')),
	CONSTRAINT "recording_files_state_check" CHECK("recording_files"."state" IN ('writing', 'finalized', 'missing', 'deleted'))
);
--> statement-breakpoint
CREATE INDEX `recording_files_recording_id_idx` ON `recording_files` (`recording_id`);--> statement-breakpoint
CREATE INDEX `recording_files_segment_id_idx` ON `recording_files` (`segment_id`);--> statement-breakpoint
CREATE TABLE `recording_segments` (
	`id` text PRIMARY KEY NOT NULL,
	`recording_id` text NOT NULL,
	`index` integer NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`duration_ms` integer,
	`end_reason` text NOT NULL,
	`state` text NOT NULL,
	FOREIGN KEY (`recording_id`) REFERENCES `recordings`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "recording_segments_end_reason_check" CHECK("recording_segments"."end_reason" IN ('pause', 'stop', 'crash', 'error', 'takeover')),
	CONSTRAINT "recording_segments_state_check" CHECK("recording_segments"."state" IN ('capturing', 'finalizing', 'finalized', 'truncated', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recording_segments_recording_id_index_unique` ON `recording_segments` (`recording_id`,`index`);--> statement-breakpoint
CREATE TABLE `recordings` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`state` text NOT NULL,
	`layout_preset_id` text NOT NULL,
	`duration_ms` integer,
	`total_bytes` integer,
	`segment_count` integer NOT NULL,
	`merge_state` text NOT NULL,
	`retention_delete_after` text NOT NULL,
	`deleted_at` text,
	`deleted_by` text,
	`delete_reason` text,
	`playback_auth_required` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `lecture_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`layout_preset_id`) REFERENCES `layout_presets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deleted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "recordings_state_check" CHECK("recordings"."state" IN ('capturing', 'finalizing', 'merging', 'ready', 'failed', 'deleted')),
	CONSTRAINT "recordings_merge_state_check" CHECK("recordings"."merge_state" IN ('not-needed', 'pending', 'running', 'done', 'failed')),
	CONSTRAINT "recordings_delete_reason_check" CHECK("recordings"."delete_reason" IN ('admin', 'retention', 'disk-pressure'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recordings_session_id_unique` ON `recordings` (`session_id`);--> statement-breakpoint
CREATE INDEX `recordings_owner_user_id_state_idx` ON `recordings` (`owner_user_id`,`state`);--> statement-breakpoint
CREATE INDEX `recordings_retention_delete_after_idx` ON `recordings` (`retention_delete_after`);--> statement-breakpoint
CREATE TABLE `retention_policy` (
	`id` text PRIMARY KEY DEFAULT 'retention-policy' NOT NULL,
	`max_age_days` integer NOT NULL,
	`warning_threshold_pct` integer NOT NULL,
	`critical_threshold_pct` integer NOT NULL,
	`early_delete_order` text NOT NULL,
	`never_delete_unuploaded` integer NOT NULL,
	`refuse_start_when_critical` integer NOT NULL,
	`updated_at` text,
	`updated_by` text,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "retention_policy_singleton" CHECK("retention_policy"."id" = 'retention-policy'),
	CONSTRAINT "retention_policy_early_delete_order_check" CHECK("retention_policy"."early_delete_order" IN ('uploaded-oldest-first'))
);
--> statement-breakpoint
CREATE TABLE `slide_captures` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`captured_at` text NOT NULL,
	`offset_ms` integer NOT NULL,
	`image_path` text,
	`ocr_text` text,
	`dedupe_hash` text NOT NULL,
	`is_slide_change` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `lecture_sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `slide_captures_session_id_offset_ms_idx` ON `slide_captures` (`session_id`,`offset_ms`);--> statement-breakpoint
CREATE TABLE `source_bindings` (
	`role_id` text PRIMARY KEY NOT NULL,
	`physical_input_id` text,
	`enabled` integer NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`role_id`) REFERENCES `source_roles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`physical_input_id`) REFERENCES `physical_inputs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_bindings_physical_input_id_unique` ON `source_bindings` (`physical_input_id`);--> statement-breakpoint
CREATE TABLE `source_roles` (
	`id` text PRIMARY KEY NOT NULL,
	`medium` text NOT NULL,
	`display_label` text NOT NULL,
	`required_for_start` integer NOT NULL,
	`provisionable` integer NOT NULL,
	CONSTRAINT "source_roles_id_check" CHECK("source_roles"."id" IN ('presentation', 'lecturer-cam', 'students-cam', 'mic-lecturer', 'mic-room')),
	CONSTRAINT "source_roles_medium_check" CHECK("source_roles"."medium" IN ('video', 'audio'))
);
--> statement-breakpoint
CREATE TABLE `storage_volumes` (
	`id` text PRIMARY KEY NOT NULL,
	`uuid` text NOT NULL,
	`device_path` text NOT NULL,
	`mount_path` text NOT NULL,
	`label` text,
	`filesystem` text NOT NULL,
	`capacity_bytes` integer NOT NULL,
	`free_bytes` integer NOT NULL,
	`smart_status` text NOT NULL,
	`role` text NOT NULL,
	`state` text NOT NULL,
	`registered_at` text NOT NULL,
	`registered_by` text,
	FOREIGN KEY (`registered_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "storage_volumes_smart_status_check" CHECK("storage_volumes"."smart_status" IN ('good', 'warning', 'failing', 'unknown')),
	CONSTRAINT "storage_volumes_role_check" CHECK("storage_volumes"."role" IN ('recordings', 'system')),
	CONSTRAINT "storage_volumes_state_check" CHECK("storage_volumes"."state" IN ('registered', 'mounted', 'missing', 'formatting', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `one_storage_volume_per_uuid` ON `storage_volumes` (`uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `one_recordings_volume` ON `storage_volumes` (`role`) WHERE "storage_volumes"."role" = 'recordings' AND "storage_volumes"."state" = 'mounted';--> statement-breakpoint
CREATE TABLE `stream_targets` (
	`id` text PRIMARY KEY NOT NULL,
	`platform` text NOT NULL,
	`display_name` text NOT NULL,
	`ingest_url` text NOT NULL,
	`stream_key_ref` text NOT NULL,
	`requires_tls_bridge` integer NOT NULL,
	`enabled` integer NOT NULL,
	`last_preflight_at` text,
	`last_preflight_result` text,
	CONSTRAINT "stream_targets_platform_check" CHECK("stream_targets"."platform" IN ('youtube', 'facebook', 'custom-rtmp')),
	CONSTRAINT "stream_targets_last_preflight_result_check" CHECK("stream_targets"."last_preflight_result" IN ('ok', 'failed'))
);
--> statement-breakpoint
CREATE TABLE `system_alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`severity` text NOT NULL,
	`category` text NOT NULL,
	`title` text NOT NULL,
	`detail` text,
	`raised_at` text NOT NULL,
	`cleared_at` text,
	`cleared_reason` text,
	`acknowledged_by` text,
	`context` text,
	`related_entity` text,
	FOREIGN KEY (`acknowledged_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "system_alerts_severity_check" CHECK("system_alerts"."severity" IN ('info', 'warning', 'error', 'critical')),
	CONSTRAINT "system_alerts_category_check" CHECK("system_alerts"."category" IN ('Auth', 'System', 'Hardware', 'Session')),
	CONSTRAINT "system_alerts_cleared_reason_check" CHECK("system_alerts"."cleared_reason" IN ('resolved', 'acknowledged', 'superseded'))
);
--> statement-breakpoint
CREATE INDEX `system_alerts_code_idx` ON `system_alerts` (`code`) WHERE "system_alerts"."cleared_at" IS NULL;--> statement-breakpoint
CREATE TABLE `transcript_segments` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`start_offset_ms` integer NOT NULL,
	`end_offset_ms` integer NOT NULL,
	`text` text NOT NULL,
	`confidence` real,
	`engine` text NOT NULL,
	`model_version` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `lecture_sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `transcript_segments_session_id_start_offset_ms_idx` ON `transcript_segments` (`session_id`,`start_offset_ms`);--> statement-breakpoint
CREATE TABLE `upload_file_parts` (
	`id` text PRIMARY KEY NOT NULL,
	`upload_job_id` text NOT NULL,
	`recording_file_id` text NOT NULL,
	`stream_key` text NOT NULL,
	`state` text NOT NULL,
	`bytes_total` integer NOT NULL,
	`bytes_sent` integer NOT NULL,
	`resume_token` text,
	`remote_file_id` text,
	`checksum` text,
	`attempt` integer NOT NULL,
	`last_error` text,
	FOREIGN KEY (`upload_job_id`) REFERENCES `upload_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recording_file_id`) REFERENCES `recording_files`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "upload_file_parts_state_check" CHECK("upload_file_parts"."state" IN ('pending', 'uploading', 'uploaded', 'missing', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `one_part_per_file` ON `upload_file_parts` (`upload_job_id`,`recording_file_id`);--> statement-breakpoint
CREATE TABLE `upload_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`recording_id` text NOT NULL,
	`adapter_id` text NOT NULL,
	`state` text NOT NULL,
	`attempt` integer NOT NULL,
	`next_attempt_at` text,
	`last_error` text,
	`last_error_at` text,
	`failure_class` text,
	`blocked_by` text,
	`remote_lecture_id` text,
	`metadata` text NOT NULL,
	`enqueued_at` text NOT NULL,
	`started_at` text,
	`completed_at` text,
	`requeued_by` text,
	`requeued_at` text,
	`remote_cleanup_state` text NOT NULL,
	FOREIGN KEY (`recording_id`) REFERENCES `recordings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requeued_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "upload_jobs_state_check" CHECK("upload_jobs"."state" IN ('queued', 'uploading', 'completing', 'done', 'failed', 'dead-letter', 'cancelled')),
	CONSTRAINT "upload_jobs_remote_cleanup_state_check" CHECK("upload_jobs"."remote_cleanup_state" IN ('not-needed', 'pending', 'done', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `one_upload_job_per_recording` ON `upload_jobs` (`recording_id`);--> statement-breakpoint
CREATE INDEX `upload_jobs_state_next_attempt_at_idx` ON `upload_jobs` (`state`,`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `user_import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`filename` text NOT NULL,
	`uploaded_by` text NOT NULL,
	`uploaded_at` text NOT NULL,
	`state` text NOT NULL,
	`row_count` integer NOT NULL,
	`accepted_count` integer NOT NULL,
	`rejections` text NOT NULL,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "user_import_batches_state_check" CHECK("user_import_batches"."state" IN ('validating', 'rejected', 'applied'))
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text NOT NULL,
	`source` text NOT NULL,
	`external_id` text,
	`password_hash` text,
	`must_reset_password` integer NOT NULL,
	`disabled` integer NOT NULL,
	`last_login_at` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`import_batch_id` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`import_batch_id`) REFERENCES `user_import_batches`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "users_role_check" CHECK("users"."role" IN ('lecturer', 'admin')),
	CONSTRAINT "users_source_check" CHECK("users"."source" IN ('local', 'institute'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);