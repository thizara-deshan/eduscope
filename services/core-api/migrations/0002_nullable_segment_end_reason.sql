PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_recording_segments` (
	`id` text PRIMARY KEY NOT NULL,
	`recording_id` text NOT NULL,
	`index` integer NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`duration_ms` integer,
	`end_reason` text,
	`state` text NOT NULL,
	FOREIGN KEY (`recording_id`) REFERENCES `recordings`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "recording_segments_end_reason_check" CHECK("__new_recording_segments"."end_reason" IN ('pause', 'stop', 'crash', 'error', 'takeover')),
	CONSTRAINT "recording_segments_state_check" CHECK("__new_recording_segments"."state" IN ('capturing', 'finalizing', 'finalized', 'truncated', 'failed'))
);
--> statement-breakpoint
INSERT INTO `__new_recording_segments`("id", "recording_id", "index", "started_at", "ended_at", "duration_ms", "end_reason", "state") SELECT "id", "recording_id", "index", "started_at", "ended_at", "duration_ms", "end_reason", "state" FROM `recording_segments`;--> statement-breakpoint
DROP TABLE `recording_segments`;--> statement-breakpoint
ALTER TABLE `__new_recording_segments` RENAME TO `recording_segments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `recording_segments_recording_id_index_unique` ON `recording_segments` (`recording_id`,`index`);