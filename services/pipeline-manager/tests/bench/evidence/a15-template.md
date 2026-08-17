# A-15 evidence — publishers and record EOS bench gate

Copy this file to `a15-<YYYYMMDD>-<device>.md` and fill every field from the
actual target run. An unrun row stays `NOT RUN — gate failed` — never leave
it blank and never mark the task complete with a blank or invented PASS.

## Identity

| Field | Value |
|---|---|
| Date | NOT RUN — gate failed |
| Commit SHA | NOT RUN — gate failed |
| Device serial | NOT RUN — gate failed |
| OS / kernel | NOT RUN — gate failed |
| GStreamer version | NOT RUN — gate failed |
| Pipeline engineer sign-off | NOT RUN — gate failed |

## Source bindings (secrets redacted)

| Role | Publisher | Address/device | Notes |
|---|---|---|---|
| presentation | usb | NOT RUN — gate failed | |
| lecturer-cam | rtsp | NOT RUN — gate failed | |
| students-cam | rtsp2 | NOT RUN — gate failed | |
| mic-lecturer | audio | NOT RUN — gate failed | |

## Recordings mount

| Field | Value |
|---|---|
| Mount point | NOT RUN — gate failed |
| Filesystem UUID | NOT RUN — gate failed |

## Commands and exit codes

```text
NOT RUN — gate failed
```

## Publisher pid before/after table (restart isolation)

| Publisher | pid before | pid after | sibling consumers unchanged? |
|---|---|---|---|
| usb | NOT RUN — gate failed | NOT RUN — gate failed | NOT RUN — gate failed |
| rtsp | NOT RUN — gate failed | NOT RUN — gate failed | NOT RUN — gate failed |
| rtsp2 | NOT RUN — gate failed | NOT RUN — gate failed | NOT RUN — gate failed |
| audio | NOT RUN — gate failed | NOT RUN — gate failed | NOT RUN — gate failed |

## Segments (path / size / duration)

| Phase | Path | Size (bytes) | Duration (s) |
|---|---|---|---|
| warm-attach | NOT RUN — gate failed | NOT RUN — gate failed | NOT RUN — gate failed |
| camera-only | NOT RUN — gate failed | NOT RUN — gate failed | NOT RUN — gate failed |
| targeted-eos | NOT RUN — gate failed | NOT RUN — gate failed | NOT RUN — gate failed |
| pause-resume before | NOT RUN — gate failed | NOT RUN — gate failed | NOT RUN — gate failed |
| pause-resume after | NOT RUN — gate failed | NOT RUN — gate failed | NOT RUN — gate failed |
| source-loss | NOT RUN — gate failed | NOT RUN — gate failed | NOT RUN — gate failed |

## Pause/resume A/V offset

| File | video start_time | audio start_time | \|offset\| (s) | ≤ 0.100 s? |
|---|---|---|---|---|
| before-pause | NOT RUN — gate failed | NOT RUN — gate failed | NOT RUN — gate failed | NOT RUN — gate failed |
| after-resume | NOT RUN — gate failed | NOT RUN — gate failed | NOT RUN — gate failed | NOT RUN — gate failed |

## Source-loss placeholder

| Field | Value |
|---|---|
| Placeholder frame path | NOT RUN — gate failed |
| Record consumer pgid unchanged? | NOT RUN — gate failed |
| File grew during loss? | NOT RUN — gate failed |

## journald excerpt

```text
NOT RUN — gate failed
```

## PASS/FAIL per phase

| Phase | Result |
|---|---|
| A15-PUB warm publishers, sockets, isolated restarts | NOT RUN — gate failed |
| A15-REC warm-attach | NOT RUN — gate failed |
| A15-REC camera-only | NOT RUN — gate failed |
| A15-REC targeted-eos | NOT RUN — gate failed |
| A15-REC pause-resume-sync | NOT RUN — gate failed |
| A15-REC source-loss-placeholder | NOT RUN — gate failed |
