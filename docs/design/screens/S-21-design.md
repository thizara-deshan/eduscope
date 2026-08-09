# S-21 Recordings library — the list, the badge vocabulary & the export/delete entry points — wireframe & screen design

> Closes **W-5** in [screen-inventory §9](../screen-inventory.md#9-screens-needing-wireframe-approval)
> ("Parity §5.1 item 1 — the largest gap in the product") and settles **SI-D-3**
> ("Library entry point"). Nothing in this document may be contradicted by a plan
> or by generated code; if it must change, that is a gate discussion, not an
> in-run improvisation ([frontend-conventions](../frontend-conventions.md) preamble).
>
> **Status:** ✅ **approved 2026-08-09**, Wave 5 design gate. Blocks:
> [S-22](S-22-design.md), [S-23](S-23-design.md), [S-24](S-24-design.md) — it is
> the list they all open from. Depends on: [S-03](../screen-inventory.md#s-03-panel-shell-chrome--alert-host)
> (the shell that hosts the header entry point and the alert host) and the Wave 0
> scaffold (client boundary, router, tokens, list primitives).
> Siblings: **S-35** (the admin upload queue) shares this document's **badge
> vocabulary** (§3) verbatim — one derivation, two screens.
>
> **This is the single biggest design gap in the product** (parity §1 FM row,
> §5.1 item 1). Its one load-bearing job: show a lecturer *their own* recordings
> and an admin *everyone's*, each with an honest, derived upload/merge badge — and
> be the door to playback (S-22), export (S-23) and deletion (S-24) without ever
> resurrecting the legacy File-Manager's client-side ownership filter, hover-only
> row actions, or user-triggered merge.

---

## 0. Evidence base

| Source | What it fixed here |
|---|---|
| [screen-inventory §4 S-21](../screen-inventory.md#s-21-recordings-library-panel-library) | The states, the **upload/merge badge matrix** (§3 here), the `listRecordings` data, the row fields, "no hover-revealed row actions", "chips not a menu", pagination = "load more", the two empty states, and *"prototype coverage none → wireframe required"* |
| [screen-inventory §4 preamble](../screen-inventory.md#4-lecturer-panel--recordings-library) | The pre-decided rules: A-20 (everyone plays, admin-only delete, 14-day auto-delete), A-12 (system merges pause segments — the convert flow is gone), server-side ownership filtering (B-31), authenticated playback (B-37 closed) |
| [screen-inventory §0.3](../screen-inventory.md#03-universal-states--implemented-once-inherited-by-every-screen) | U-1 (cold skeleton), U-2 (reconnecting — dim, never hide), U-3 (resync without a populated→skeleton flash), U-4 (command pending), U-5 (refusal in plain language), U-6 (delete is admin-only) — inherited, not re-invented |
| [screen-inventory §8](../screen-inventory.md#8-design-token-sheet) | Every token used below; `--tap-row-lg` (64) for multi-target rows; `--success`/`--warning`/`--danger` semantics; **no new colour, size or spacing value** |
| [state-machines §2 Machine 1b](../state-machines.md#2-machine-1b--recording-artifact-and-1c--channel-consumer) | `Recording.state × mergeState`, transitions RA-01…RA-07 and **SM-D-1** (the `merging` job never exists — the queued job carries `blockedBy=merge`, rendered "Preparing…") |
| [state-machines §4.5 retention](../state-machines.md#45-retention-sweep-a-20-pf-7-d-15) | RET-1 (delete when aged **and** uploaded), **RET-2** (aged but never uploaded → **not** deleted, `retention.blocked`), RET-3 (disk-pressure early delete), RET-6 (`LectureSession` row survives, `deletedAt/By/Reason` are columns) |
| [state-machines §1 SEG-2](../state-machines.md#1-machine-1a--recordingstate-the-spine) | Ordering is by `index` only — never id arithmetic (INV-RS-1, B-25/B-10) |
| [`contracts/openapi.yaml`](../../../contracts/openapi.yaml) `listRecordings` | `GET /recordings?cursor=&limit=&state=&includeDeleted=` → `{items: Recording[], nextCursor}`; **ownership filtered server-side** (INV-RC-5); `includeDeleted` is admin-only |
| [`contracts/openapi.yaml`](../../../contracts/openapi.yaml) `Recording` | `title`, `hallDisplayName`, `ownerUserId`, `ownerDisplayName`, `startedAt`, `durationMs`, `totalBytes`, `segmentCount`, `mergeState`, **derived** `uploadState`, `retentionDeleteAfter`, `deletedAt`, `deleteReason` — the row is a projection, the badge a derivation, never a second truth |
| [`contracts/events.md` §2.3](../../../contracts/events.md) | `recording.artifact` — `{recordingId, sessionId, state, mergeState, durationMs, totalBytes, deleteReason}`, on transition (≤ ~6/lecture); the live driver of every badge change and of the "removed under the user" case (carries `deleteReason`) |
| [`contracts/events.md` §2.18](../../../contracts/events.md) | `upload.job` — `{jobId, recordingId, state, attempt, nextAttemptAt, progressPct, lastError, blockedBy}`; the live driver of the upload half of the badge |
| [PRD LP-10](../../PRD.md) | *"recordings with upload-status badges, playback, download, multi-select copy-to-USB and admin-only delete"* — this screen's charter |
| [behavioral-inventory B-31](../../discovery/behavioral-inventory.md#b-31-file-listing-with-upload-status-and-per-user-visibility) | The legacy listing: per-user visibility **enforced client-side only**, status badge from the queue, twin grouping. **KEEP the library view + badges; ownership filtering MUST move server-side** |
| [behavioral-inventory B-33](../../discovery/behavioral-inventory.md#b-33-delete-recordings-admin-only) | Legacy encoded the actor in a `deleted(<uid>)` status string. **KEEP audited delete; CHANGE to real columns** (owned by S-24) |
| [behavioral-inventory B-34](../../discovery/behavioral-inventory.md#b-34-pause-segment-combining-cmb-on-file-manager-open) | Merging was **user-initiated on FM open** — and the upload window could ship unmerged segments. **CHANGE per A-12: automatic/server-side; the "Preparing…" badge is the only trace the user sees** |
| [behavioral-inventory B-20](../../discovery/behavioral-inventory.md#b-20-storage-cleanup-cron) | Legacy parsed the recording date **out of the filename** and hard-coded thresholds. This screen reads `retentionDeleteAfter` and quotes nothing hardcoded (INV-RP-1) |
| [open-decisions SI-D-3](../../discovery/open-decisions.md) | The library entry-point recommendation this document adopts and settles |

---

## 1. Constraints that are not design choices

**C-1. Ownership filtering is the server's job, and the client never re-implements
it.** `listRecordings` is *"ownership filtered SERVER-SIDE (INV-RC-5)"*: a
lecturer's page already contains only their recordings; an admin's contains
everyone's. The legacy File-Manager filtered client-side on `filename token 3 ==
userid` (B-31) — a visibility control that a curl request walked straight past.
This screen therefore **renders exactly what the page returns** and adds no
owner predicate of its own. The `owner` column exists only in the admin view, as
information, not as a filter the client enforces.

**C-2. The badge is derived, and there is exactly one.** A row's status is a pure
function of `Recording.mergeState` and the derived `Recording.uploadState`
(§3). It is **never** a second stored truth, never a free-text string smuggling
state (B-33's `deleted(<uid>)`), and never two competing chips. The same
derivation drives S-35's queue rows — so a recording that reads "Preparing…"
here reads "Preparing…" there, by construction (§3, §12).

**C-3. Merging is invisible and automatic; the user has no convert button.** A-12
and SM-D-1 move pause-segment combining server-side, triggered on entering
`finalizing` (SEG-6). The legacy "Start File Conversion" prompt on FM-open
(B-34) — and the race where the upload window shipped *unmerged* segments before
anyone clicked it — are both gone. The only trace merging leaves on this screen
is the **"Preparing…" badge**; there is no control that starts, hurries or
re-runs a merge from the list. (The one exception — an admin retrying a *failed*
merge — is a deep-link into S-22, not an inline action; §11 LIB-D-4.)

**C-4. Row actions are always visible or they do not exist.** *"No hover-revealed
row actions — the legacy pattern of icons appearing on hover is unusable on a
touch panel"* (screen-inventory §4). Every per-row action lives in a persistent
trailing control or in selection mode. There is no hover state that reveals
information or a target; a bench mouse may add hover *feedback*, never hover-only
*function* (§0.4).

**C-5. Deletion removes the media, not the history.** RA-06 sets
`deletedAt`/`deletedBy`/`deleteReason` as **real columns** and keeps the
`LectureSession` row (RET-6, INV-LS-7). A row vanishing from this list means the
media is gone; it does not mean the lecture never happened. When a row disappears
under the user — retention fired on a timer (RET-1/RET-3), not on their tap — the
explanation is non-alarming and names the reason from `recording.artifact.deleteReason`
(§5, state `removed-under-user`).

**C-6. "Never uploaded" is a reason to keep, and the row says so.** RET-2 is the
explicit reversal of B-20: a recording past its 14-day age with **no** successful
upload is **not** deleted. So an old row that is still here is not a bug — it is
the safety rule working. The row states it (`Kept — never uploaded`), because a
lecturer who sees a three-week-old recording needs to know *why the system left
it*, not to wonder whether cleanup is broken. This is derivable client-side
(`now > retentionDeleteAfter ∧ uploadState ≠ done`) and needs no new field (§9.1).

**C-7. The list is paged by cursor, and "everything" is never assumed loaded.**
`listRecordings` returns `nextCursor`; the UI offers **Load more**, never numbered
pages and never a promise that the whole 14-day set is in hand. This is why
filtering (§9 CG-5) must be a **server** parameter, not a client filter over the
loaded page — you cannot filter what you have not fetched (C-1's discipline
applied to pagination).

---

## 2. Wireframe

**The design in one sentence:** a scannable list of 64 px rows, each carrying one
derived badge and a persistent action affordance, with an admin-only owner column,
a two-chip filter (title + owner) that maps to real server parameters, a
selection mode that feeds S-23, and a "Load more" cursor — reached from a header
entry point present for both roles.

### 2.1 The list — populated, lecturer view

```
┌ .us-panel 1280×800 ─────────────────────────────────────────────────────────┐
│  [Header S-03: logo · Hall A · clock · Priya ▾]                               │
│                                                                              │
│  Recordings                                            [ 🔍 Search ]  [Select]│  ← title row (no owner chip; lecturer sees only own)
│  ────────────────────────────────────────────────────────────────────────── │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │ Data Structures — Lecture 12                                          │   │  row: --tap-row-lg (64)
│  │ Hall A · Fri 8 Aug, 14:02 · 1:04:11 · 2.1 GB · 3 segments             │   │  meta: --fs-xs, --text-muted
│  │ ● Uploaded                                       [ ▷ Play ]  [ ⋯ ]     │   │  badge --success · actions persistent (C-4)
│  ├──────────────────────────────────────────────────────────────────────┤   │
│  │ Algorithms — Lecture 11                                               │   │
│  │ Hall A · Thu 7 Aug, 09:00 · 0:52:40 · 1.6 GB · 1 segment              │   │
│  │ ◐ Preparing…                                     [ ▷ Play ]  [ ⋯ ]     │   │  badge --text-muted (merge in flight)
│  ├──────────────────────────────────────────────────────────────────────┤   │
│  │ Operating Systems — Lecture 10                                        │   │
│  │ Hall A · Wed 6 Aug, 11:00 · 1:12:03 · 2.4 GB · 2 segments             │   │
│  │ ▲ Upload failed — retrying (next try 14:20)      [ ▷ Play ]  [ ⋯ ]     │   │  badge --warning + nextAttemptAt
│  ├──────────────────────────────────────────────────────────────────────┤   │
│  │ Computer Networks — Lecture 9                                         │   │
│  │ Hall A · Fri 25 Jul, 10:00 · 0:48:17 · 1.4 GB · 2 segments            │   │
│  │ ⚠ Kept — never uploaded (won't auto-delete)      [ ▷ Play ]  [ ⋯ ]     │   │  RET-2 (C-6), --warning
│  └──────────────────────────────────────────────────────────────────────┘   │
│                              [  Load more  ]                                  │  cursor (C-7); only if nextCursor
└──────────────────────────────────────────────────────────────────────────────┘
```

The **row body** (title + meta) is the tap target for detail (→ S-22). **Play** is
a distinct target (→ S-22 opened directly on the player). **⋯** opens a small
persistent action menu (Download, Copy to USB, and — admin only — Delete); it is a
tap target, never a hover reveal (C-4).

### 2.2 The list — populated, admin view

```
│  Recordings                        [ 🔍 Search ] [ ▾ Owner: All ] [Select]    │  ← owner chip present (admin only)
│  ────────────────────────────────────────────────────────────────────────── │
│  │ Data Structures — Lecture 12                                          │   │
│  │ Priya Fernando · Hall A · Fri 8 Aug, 14:02 · 1:04:11 · 2.1 GB · 3 seg │   │  ← owner shown (ownerDisplayName)
│  │ ● Uploaded                                       [ ▷ Play ]  [ ⋯ ]     │   │
```

The admin view adds the **owner** to the meta line and the **Owner** filter chip.
Both are additive to the same row; nothing else changes. `includeDeleted` is an
admin-only chip (`[ ▾ Show deleted ]`) that, when on, renders deleted rows as
tombstones (§5, state `deleted-tombstone`) — never as playable rows.

### 2.3 The filter chips — mapped to server parameters (§9 CG-5)

```
[ 🔍 Search: "networks" ✕ ]      → listRecordings(q="networks")
[ ▾ Owner: Priya Fernando ✕ ]    → listRecordings(ownerUserId=<ulid>)   (admin only)
```

Both are **chips, not a menu** (screen-inventory §4). Search is a text field →
`?q=` (title substring, server-side); Owner is a picker → `?ownerUserId=` (admin
only, C-1). **There is no client-side filter** — each chip re-issues
`listRecordings` with the parameter and resets the cursor (C-7). Clearing a chip
re-issues without it. **No date-range chip** — the window is already 14 days
(§9 CG-5, §11 LIB-D-2). The Search field opens the on-screen keyboard
(frontend-conventions §3).

### 2.4 Selection mode → S-23

```
│  4 selected · 6.8 GB                        [ Cancel ]      [ Copy to USB → ] │  ← selection bar replaces title row
│  ────────────────────────────────────────────────────────────────────────── │
│  │ ☑  Data Structures — Lecture 12    …    ● Uploaded                    │   │  checkbox is its own ≥44 px target
│  │ ☐  Algorithms — Lecture 11         …    ◐ Preparing…                  │   │
```

Selection mode shows a **checkbox column** (each checkbox a ≥44 px target,
separate from the row-body tap; screen-inventory §4). The bar shows the **count
and summed bytes** (Σ `totalBytes`) so the lecturer knows the transfer size
before opening S-23. **Copy to USB →** opens [S-23](S-23-design.md), passing the
selected `recordingIds`. In selection mode, tapping a row toggles its checkbox
rather than opening detail.

### 2.5 Empty states

```
Lecturer, no recordings:                    Admin, none on device:
┌───────────────────────────────┐           ┌───────────────────────────────┐
│                               │           │                               │
│   You haven't recorded        │           │   No recordings on this       │
│   anything yet.               │           │   device.                     │
│                               │           │                               │
│   Recordings appear here      │           │                               │
│   after you stop a lecture.   │           │                               │
└───────────────────────────────┘           └───────────────────────────────┘
```

Two distinct empty states (screen-inventory §4): the lecturer's is reassuring and
explains *when* rows appear; the admin's is a factual device statement. Neither is
a spinner or a bare "no data".

---

## 3. The upload/merge badge vocabulary  *(shared with S-35)*

The badge is the one thing this screen and **S-35** must render identically. It is
settled once, here; S-35 inherits it unchanged for its row-state labels
(§12, S-35 §3). It is a **pure derivation** of two fields on `Recording`
(`mergeState`, derived `uploadState`) plus the client-derivable retention
predicate (C-6) — never a stored string (C-2).

### 3.1 LIB-D-1 — the matrix

| # | Source condition | Badge label | Colour | Row affordance |
|---|---|---|---|---|
| 1 | `mergeState ∈ {pending, running}` (1b `merging`; SM-D-1: the upload job is `queued` + `blockedBy=merge`) | `Preparing…` | `--text-muted` + spinner glyph | Play offered on what exists (S-22 `preparing`) |
| 2 | `mergeState = failed` (1b `failed`) | `Couldn't prepare this recording` | `--warning` | Tap → S-22, where **admin** sees Retry (RA-07, CG-7). **No upload job exists** (INV-UJ-3) |
| 3 | `uploadState = queued` (and not `blockedBy=merge`) | `Waiting to upload` | `--text-muted` | — |
| 4 | `uploadState ∈ {uploading, completing}` | `Uploading… {progressPct}%` | `--accent` | `completing` renders as uploading (no separate label) |
| 5 | `uploadState = done` | `Uploaded` | `--success` | — |
| 6 | `uploadState = failed` | `Upload failed — retrying (next try {nextAttemptAt})` | `--warning` | Detail/queue owns retry; the badge quotes `nextAttemptAt` |
| 7 | `uploadState = dead-letter` | `Upload needs attention` | `--danger` | Admin: tap → **S-35**. Lecturer: informational |
| 8 | No job yet, `Recording.state = capturing` | `Recording` | `--record` | Still capturing — the row is live |
| 9 | Aged past `retentionDeleteAfter` ∧ `uploadState ≠ done` (RET-2, C-6) | `Kept — never uploaded (won't auto-delete)` | `--warning` | Retention marker; not a job state |

**Precedence:** merge state outranks upload state (a recording still `merging` has
no meaningful upload state yet — SM-D-1); the RET-2 marker (#9) is shown as a
*second line* under an otherwise-normal badge, not instead of it, because "kept"
and "upload failed" can both be true and the lecturer needs both.

### 3.2 LIB-D-2 — colour is never the only signal

Every badge pairs a **word** with its colour (screen-inventory §0.4, and the
colour-blind-safety rule S-35's touch note repeats): `Uploaded` is green *and*
says "Uploaded"; `Upload needs attention` is `--danger` *and* says it. Greyscale
reading survives. The glyphs (● ◐ ▲ ⚠) are decorative reinforcement, never the
sole carrier.

### 3.3 LIB-D-3 — the badge quotes the contract, and hardcodes nothing

The retention marker (#9) and any storage-derived copy are generated from the
`Recording` fields and `RetentionPolicy` (INV-RP-1) — the badge never hardcodes
"14 days" or "80 %" the way B-20/B-53 did. `nextAttemptAt` (#6) is rendered from
the field, not computed from a guessed backoff table.

---

## 4. Component breakdown

```
apps/panel/src/screens/library/
  library-screen.tsx        route container: header, filter chips, list, load-more, empty states
  recording-row.tsx         one 64 px row: title/meta, badge, action affordance, checkbox (selection)
  recording-badge.tsx       the §3 derivation → label + colour + glyph. PURE. SHARED with S-35
  library-filters.tsx       the two chips (search + owner); maps to listRecordings params
  selection-bar.tsx         count + Σ bytes + Copy-to-USB; owns selection state
  use-recordings.ts         paged listRecordings query merged with recording.artifact / upload.job events
  use-recording-badge.ts    the pure derivation as a testable function (no JSX). SHARED with S-35
```

| Unit | What it does | How you use it | What it depends on |
|---|---|---|---|
| `use-recording-badge.ts` | `(Recording) → { label, tone, glyph, secondary? }` — the whole §3 matrix as one pure function. **The only place badge logic is written**; imported by both S-21 rows and S-35 rows | `const badge = recordingBadge(rec)` | nothing but the `Recording` shape + `RetentionPolicy` (for #9 copy) |
| `use-recordings.ts` | The paged `listRecordings` TanStack Query keyed on `{q, ownerUserId, state, includeDeleted, cursor}`, merged live with `recording.artifact` and `upload.job` through `selectors.ts`. Handles U-1/U-3 (no populated→skeleton flash) | `const { rows, loadMore, hasMore } = useRecordings(filters)` | `EduscopeClient.listRecordings`, WS `recording.artifact` / `upload.job` |
| `recording-row.tsx` | Presentation only: renders title, meta (owner only if `showOwner`), `<RecordingBadge/>`, the persistent action affordance, and — in selection mode — the checkbox. Knows nothing about fetching or roles | `<RecordingRow rec={…} showOwner={isAdmin} selectable={…}/>` | `recording-badge`, tokens |
| `recording-badge.tsx` | Renders `use-recording-badge`'s verdict as the chip. **Pure of data source** — like S-20's `quiz-qr`, it can only receive a `Recording`, so it can never be wired to a placebo | `<RecordingBadge rec={…}/>` | `use-recording-badge` |
| `library-filters.tsx` | The search + owner chips; each edit re-issues the query with the mapped parameter and resets the cursor (C-7) | `<LibraryFilters value={…} onChange={…} isAdmin={…}/>` | `use-recordings` filters, keyboard host |
| `selection-bar.tsx` | Selection count, Σ `totalBytes`, Cancel, Copy-to-USB → S-23 | `<SelectionBar ids={…} onExport={…}/>` | S-23 overlay open |

`use-recording-badge.ts` is deliberately JSX-free and data-source-free: the one
derivation this wave must get right — and get *identical* across S-21 and S-35 — is
written once and tested without rendering either screen (§13). Nothing in this
folder imports `fetch`, `axios` or `WebSocket` (frontend-conventions §1).

---

## 5. States

### 5.1 The screen — mapped to the machines

| # | State | Entered by | Rendering | Governed by |
|---|---|---|---|---|
| 1 | `loading` (U-1) | cold mount | skeleton rows in the list's own shape from the REST snapshot; **no full-screen spinner**, no layout shift | §0.3 U-1 |
| 2 | `empty (lecturer)` | 200, `items = []`, role lecturer | "You haven't recorded anything yet." (§2.5) | screen-inventory §4 |
| 3 | `empty (admin)` | 200, `items = []`, role admin | "No recordings on this device." (§2.5) | screen-inventory §4 |
| 4 | `populated` | 200, `items ≠ []` | the list (§2.1/§2.2); each row's badge from §3 | LP-10 |
| 5 | `badge: preparing` | `recording.artifact{mergeState∈{pending,running}}` | row badge #1 "Preparing…" | RA-01, SM-D-1 |
| 6 | `badge: merge-failed` | `recording.artifact{state=failed}` | row badge #2; tap → S-22 (admin retry there) | RA-05, CG-7 |
| 7 | `badge: uploading/failed/done/dead-letter` | `upload.job{state}` | row badges #3–#7 | U-01…U-10 |
| 8 | `retention-marker` | `now > retentionDeleteAfter ∧ uploadState ≠ done` | row badge #9 second line (C-6) | RET-2 |
| 9 | `removed-under-user` | `recording.artifact{state=deleted}` for a visible row, **not** initiated by this client | the row animates out with a one-line, non-alarming note keyed on `deleteReason` (`retention` → "removed after 14 days"; `disk-pressure` → "removed to free space"; `admin` → "removed by an administrator") | RA-06, RET-1/RET-3, C-5 |
| 10 | `deleting (self-initiated)` (U-4) | this client confirmed S-24 | U-4 pending on the row; on `recording.artifact{deleted}` the row disappears | RA-06, S-24 |
| 11 | `deleted-tombstone` | admin, `includeDeleted=true` | deleted rows render as **non-playable tombstones** showing `deletedAt`/`deleteReason`/`deletedBy` (real columns, C-5); never a Play affordance | RA-06, INV-RC-3 |
| 12 | `selection mode` | Select tapped | §2.4 — checkboxes, count, Σ bytes, Copy-to-USB | LP-10 |
| 13 | `load-more pending` (U-4) | Load more tapped | the button shows pending; the next page appends without re-skeletoning existing rows (U-3 discipline) | §0.3, C-7 |
| — | `U-2` reconnecting | `T-WS-STALE` (10 s) | live badges **dimmed** and marked not-live (never hidden); the list stays readable; actions that issue a command (Delete, Copy-to-USB) are disabled — a delete tapped offline must never fire on reconnect | §0.3 U-2 |
| — | `U-3` resync | `seq` gap | full snapshot re-request; unchanged rows must **not** flash populated→skeleton→populated | §0.3 U-3 |
| — | `U-5` refused | a row command refused | the named reason renders next to the row/menu that issued it (delete → S-24 owns its refusal; filter/query errors → an inline error card, not a raw code) | §0.3 U-5 |
| — | `U-6` forbidden | lecturer | the **Delete** item is absent from `⋯` and `includeDeleted` is not offered — the nav never shows what the role cannot use; a 403 arriving anyway is a bug surface (error card) | §0.3 U-6 |

### 5.2 Diagram — a row's badge lifecycle (Machine 1b × 3a, as the list sees it)

```mermaid
stateDiagram-v2
    [*] --> Recording: capturing (badge #8)
    Recording --> Preparing: RA-01 finalizing→merging (badge #1, SM-D-1)
    Recording --> WaitingUpload: RA-02 single segment, no convert (badge #3)
    Preparing --> WaitingUpload: RA-03 merge ok → job queued (badge #3)
    Preparing --> MergeFailed: RA-05 no usable segment (badge #2)
    MergeFailed --> Preparing: RA-07 admin retry (CG-7; from S-22)
    WaitingUpload --> Uploading: U-02 (badge #4)
    Uploading --> Uploaded: U-04 (badge #5)
    Uploading --> UploadFailed: U-05 (badge #6, quotes nextAttemptAt)
    UploadFailed --> Uploading: U-06 backoff elapsed
    UploadFailed --> DeadLetter: U-07 cap / permanent (badge #7)
    Uploaded --> Removed: RET-1 aged & uploaded (row #9→out)
    WaitingUpload --> Kept: RET-2 aged & never uploaded (badge #9, C-6)
    note right of Removed
      Row leaves the list; LectureSession survives (RET-6).
      deleteReason drives the non-alarming note (state 9).
    end note
    note right of DeadLetter
      Admin: tap → S-35. Lecturer: informational.
      No upload job exists for MergeFailed (INV-UJ-3).
    end note
```

---

## 6. Copy deck

| Where | Copy |
|---|---|
| Screen title | `Recordings` |
| Search placeholder | `Search recordings` |
| Owner chip (admin) | `Owner: {name}` / `Owner: All` |
| Show-deleted chip (admin) | `Show deleted` |
| Select button | `Select` / (in mode) `Cancel` |
| Selection bar | `{n} selected · {bytes}` |
| Selection action | `Copy to USB →` |
| Row meta (lecturer) | `{hall} · {date}, {time} · {duration} · {size} · {n} segment(s)` |
| Row meta (admin) | `{owner} · {hall} · {date}, {time} · {duration} · {size} · {n} segment(s)` |
| Badge #1 | `Preparing…` |
| Badge #2 | `Couldn't prepare this recording` |
| Badge #3 | `Waiting to upload` |
| Badge #4 | `Uploading… {pct}%` |
| Badge #5 | `Uploaded` |
| Badge #6 | `Upload failed — retrying (next try {time})` |
| Badge #7 | `Upload needs attention` |
| Badge #8 | `Recording` |
| Badge #9 | `Kept — never uploaded (won't auto-delete)` |
| Removed-under-user note | retention → `This recording was removed after 14 days.` · disk-pressure → `This recording was removed to free up space.` · admin → `This recording was removed by an administrator.` |
| Tombstone (admin) | `Deleted {date} by {actor} · {reason}` |
| Empty (lecturer) | `You haven't recorded anything yet.` / `Recordings appear here after you stop a lecture.` |
| Empty (admin) | `No recordings on this device.` |
| Load more | `Load more` |
| Row action menu | `Play` · `Download` · `Copy to USB` · `Delete` *(admin)* |

Two notes:

- **"Kept — never uploaded (won't auto-delete)"** states the RET-2 safety rule as a
  reassurance, not a warning about the recording. The threat B-20 posed was
  *deleting* an un-uploaded lecture; this copy tells the lecturer the opposite is
  guaranteed.
- **The removed-under-user note is keyed on `deleteReason`, never generic.** A row
  that vanishes must say *why*, because retention firing on a timer looks
  identical to a bug unless it explains itself (C-5).

---

## 7. Token usage

**No new token.** Badges reuse the existing semantic palette (§8.2); rows reuse
`--tap-row-lg`.

| Element | Tokens |
|---|---|
| Screen title | `--fs-xl` / 800, `--text` |
| Row container | `--tap-row-lg` (64) min-height, `--surface`, 1 px `--border` between rows, `--radius-md`, `--sp-6` padding |
| Row title | `--fs-md` / 700, `--text` |
| Row meta | `--fs-xs`, `--text-muted` |
| Badge #1/#3 | `--fs-2xs` / 700, `--text-muted`, `--surface-2` plate, `--radius-pill` |
| Badge #4 | `--accent` text, `--accent-soft` plate |
| Badge #5 | `--success` text, `--success-soft` plate |
| Badge #2/#6/#9 | `--warning` text, plate `color-mix(--warning, transparent)` |
| Badge #7 | `--danger` text, `--danger-soft` plate |
| Badge #8 | `--record` text, `--record-soft` plate |
| Filter chips | `--surface-2`, 1 px `--border`, `--radius-pill`, `--fs-sm` / 600, ≥ `--tap-min` |
| Selection checkbox | ≥ `--tap-min` (44) target, `--accent` when checked |
| Selection bar | `--surface-2`, `--fs-sm`, count `--text` / 700, bytes `--text-muted` |
| Action buttons (Play/⋯) | existing icon/text buttons, ≥ `--tap-min`, `--sp-3` apart |
| Load more | full-width `--surface-2` button, `--radius-md`, ≥ `--tap-row` (56) |
| Tombstone row | `--surface-2`, `--text-faint`, no Play affordance |

`--danger` / `--danger-soft` and `--warning` are the existing semantic tokens
(§8.2, shipped with W-1/W-13 for danger); if a plan finds the badge needs a tone
not in §8.2, that is a token-sheet question for the gate, **not** a colour minted
in-run.

---

## 8. Touch, kiosk & accessibility

- **Rows are ≥ 64 px** (`--tap-row-lg`) with the row body as the detail target and
  each action (Play, ⋯, checkbox) as its **own** ≥ 44 px target, ≥ 8 px apart — a
  lecturer scrolling must not open detail when reaching for Play (screen-inventory §4).
- **No hover-only anything** (C-4): actions are persistent; a bench mouse gets hover
  *feedback* on the same always-present controls, never hover-*revealed* function.
- **No page scroll** (§0.4): the header/title/filter rows are fixed and the **list
  body scrolls internally**; the list sizes with `calc(var(--panel-h) − …)` and the
  Search field's on-screen keyboard is absorbed via `--osk-h` (frontend-conventions §3)
  — the list never re-renders when the keyboard opens.
- **Selection checkboxes** are a distinct column of ≥ 44 px targets; entering
  selection mode does not shift the row content under a finger.
- **Screen readers:** each row is an `article` with an accessible name of
  `{title}, {badge label}, {duration}`; the badge label is text (§3, LIB-D-2), so
  the status reads without the glyph or colour. The list is a `list`/`listitem`
  structure; Load more is a `button` announcing "Load more recordings".
- **Colour-blind safety:** every badge is word + colour (LIB-D-2); no status is
  distinguishable by colour alone.
- **`prefers-reduced-motion`:** the only motion is the row remove/append and the
  "Preparing…" spinner glyph; both must survive the reduced-motion block — the
  status is carried by the word, never by the animation (§8.6).
- **U-2 disables commands, never hides rows:** a delete or export tapped while
  disconnected must not queue for replay (§0.3 U-2); the badge dims but the row and
  its (static) metadata stay readable.

---

## 9. Contract changes this design requires

**One resolved gap (CG-5) and two inherited dependencies (CG-7 for the merge-retry
exit, owned by S-22; nothing new from the badge itself).**

### CG-5 — `listRecordings` cannot be filtered by owner or title *(resolved: additive)*

`GET /recordings` takes `cursor`, `limit`, `state`, `includeDeleted` only. A
lecturer is server-scoped to their own recordings (C-1) and rarely needs more; an
**admin** sees every lecturer's 14 days with **scroll as the only tool**
(screen-inventory §10 CG-5). The filter chips (§2.3) need real server parameters —
a client filter over a cursor-paged list is incoherent (C-7).

| | |
|---|---|
| **Gap** | No `?q=` (title) or `?ownerUserId=` (owner) on `listRecordings` |
| **Screen** | S-21 (§2.3 filter chips) |
| **Severity** | **Low** — the list works without them; admin triage is the only real pain |
| **Fix** | Add **`?q=`** (case-insensitive title substring) and **`?ownerUserId=`** (admin-only; a lecturer's `ownerUserId` is already pinned server-side, so the param is ignored/forbidden for them). **Additive** — two optional query params, no schema change to `Recording`. **`?from=`/`?to=` are deliberately *not* added** (§11 LIB-D-2): the window is 14 days, so date filtering earns less than its mock/test cost |
| **Kind** | **additive** |
| **Status** | ✅ **answered 2026-08-09** at this gate; to be **applied v0.5** before Wave 5's plan run. Registered in [screen-inventory §10](../screen-inventory.md#10-contract-gaps) CG-5 |
| **If rejected** | Admin triage stays scroll-only; recorded as a deliberate no-change, and the filter chips are dropped rather than faked client-side |

### CG-7 — no merge-retry endpoint *(dependency; the binding is owned by S-22)*

Badge #2 (`Couldn't prepare this recording`) is a **reachable state with no exit**
until RA-07 (`cmd.recording.retry-merge`, admin) is bound to a REST path
([screen-inventory §10](../screen-inventory.md#10-contract-gaps) CG-7). This
screen only **deep-links** to that control (it lives in S-22, §11 LIB-D-4), so the
endpoint is specified in [S-22-design.md §9](S-22-design.md#9-contract-changes-this-design-requires),
not here. S-21 records the dependency: without CG-7 the merge-failed badge points
at a screen whose Retry does nothing.

### 9.1 Changes this design deliberately does **not** require

- **No `retentionState` field.** The RET-2 "kept" marker (#9) is derivable
  client-side from `retentionDeleteAfter` + `uploadState` (C-6); a stored flag
  would be a second truth for a value two existing fields already determine.
- **No `deleteReason` on the list snapshot beyond what exists.** `recording.artifact`
  already carries `deleteReason` (§2.3 evidence), which is all the removed-under-user
  note needs.
- **No per-row upload-progress polling.** `upload.job{progressPct}` drives badge #4
  live (≥ 5 % steps); the row never polls `getUploadJob` (that detail belongs to
  S-35).
- **No date-range filter** (see CG-5, §11 LIB-D-2).

---

## 10. Mock & scenario work Wave 5 inherits

| Gap | Where | Fix |
|---|---|---|
| Every badge state must be reachable in the overlay | `packages/api-client/src/mock/` recordings | Seed recordings covering §3 rows #1–#9, including a `mergeState=failed` and a `dead-letter` (extend the catalog, never fork — frontend-conventions §4) |
| `disk-full` must show RET-3 removing a row under the user | `mock/scenario/scripts/disk-full` | Emit `recording.artifact{deleted, deleteReason=disk-pressure}` for a visible row; assert the non-alarming note (state 9), not a silent disappearance |
| RET-2 "kept" marker | `mock/rest/` recordings | Seed a recording with `endedAt` > 14 days ago and `uploadState ≠ done`; assert badge #9 renders and the row is **not** removed |
| CG-5 params | `mock/rest/` recordings | Once applied v0.5, mock `listRecordings` honours `q`/`ownerUserId`; a test drives each chip and asserts the request carries the param and the cursor resets |
| Admin vs lecturer scoping | `mock/rest/` recordings | The mock returns owner-scoped pages for a lecturer token and all rows for an admin token — the scoping is exercised as server-side (C-1), never faked in the component |
| Selection Σ bytes | `mock` | Multiple recordings with known `totalBytes` so the selection bar total is asserted before S-23 opens |

---

## 11. Decisions taken here

| Id | Decision | Rationale | Cost to reverse |
|---|---|---|---|
| **LIB-D-1** | **The badge is one derived chip, settled here and shared verbatim with S-35** (§3) | A recording's status is a pure function of `mergeState` + `uploadState`; deriving it twice, differently, is how a library row and a queue row end up disagreeing about the same recording. One function, tested once (§4, §13) | Medium — S-35 inherits it |
| **LIB-D-2** | **Filtering is `q` + `ownerUserId` server-side; no client filter, no date range** | A cursor-paged list can't be client-filtered (C-7); the 14-day window makes date filtering low-value (CG-5). Chips map to real params or they don't exist (G-5, S-20's rule) | Low — CG-5 is additive; adding `from`/`to` later is another additive param |
| **LIB-D-3** | **Row actions are persistent (trailing affordance + selection mode), never hover-revealed** | The legacy hover-icon pattern (B-31) is unusable on a touch panel; C-4 / §0.4 forbid hover-only function | Low |
| **LIB-D-4** | **The merge-failed badge deep-links to S-22 for Retry; the list has no inline merge control** | A-12/SM-D-1 make merging automatic and invisible (C-3). The one manual exit — admin retry of a *failed* merge — is a single control, and it lives with the detail that explains the failure (S-22), not scattered onto every list row | Low |
| **LIB-D-5** | **Deleted recordings are tombstones (admin, `includeDeleted`), never playable rows; the LectureSession survives** | RA-06/RET-6: deletion removes media, not history (C-5). A deleted row that still offered Play would be a lie about what's on disk | Low |
| **LIB-D-6** | **Entry point (SI-D-3): a header entry visible to both roles, plus a link from the post-stop "Saved" toast** | The prototype has no library and thus no door; both roles need it, and the moment a lecturer most wants it is right after stopping (J-1). Settles SI-D-3 | Low |

---

## 12. Requirements this screen places on other screens

- **S-35 inherits §3 verbatim.** The upload/merge badge vocabulary is defined here
  and consumed by both screens through the shared `use-recording-badge.ts`; a test
  asserts a given `Recording` renders the same label in a library row and a queue
  row (§13, S-35 §12). S-35 may not define its own badge labels.
- **S-22 owns the merge-retry control and CG-7.** Badge #2 deep-links into S-22,
  where the admin Retry lives; S-21 assumes that control exists (LIB-D-4) and does
  not reimplement it.
- **S-23 receives the selection.** Selection mode passes `recordingIds` and the
  summed bytes to S-23; S-23 owns the drive picker and the transfer, S-21 owns only
  the selection and its Σ-bytes display (§2.4).
- **S-24 owns deletion and its confirm.** The `⋯` → Delete item (admin only) opens
  S-24; S-21 renders the row's disappearance on `recording.artifact{deleted}` but
  does not own the confirm, the copy, or the refusal (S-24 §3, inheriting S-06 §3).
- **S-03 hosts the entry point** (LIB-D-6) and the post-stop "Saved" toast's library
  link; the shell owns the alert host that surfaces `upload.dead-letter` beyond this
  screen's badge #7.

---

## 13. Testing floor

- **Testing Library:** one rendering test per §5.1 row — `loading`, both `empty`
  states, `populated`, each badge (#1–#9 via `use-recording-badge` **and** rendered
  in a row), `removed-under-user` (each `deleteReason`), `deleting`,
  `deleted-tombstone`, `selection mode`, `load-more pending`, U-2, U-6.
- **The badge derivation is tested as a pure function:** `use-recording-badge`
  given each `mergeState`/`uploadState`/retention combination returns the §3 label
  and tone, with **no rendering** — the same test suite S-35 imports (§12).
- **One truth across S-35:** a test feeding one `Recording` to both a library row
  and an S-35 queue row asserts an identical badge label (LIB-D-1).
- **Server-side scoping is not faked:** a test with a lecturer token asserts the
  component renders exactly the rows the mock returns and issues **no** owner
  predicate of its own (C-1); an admin token sees all rows and the owner column.
- **Filter chips map to params (CG-5, once applied):** a test types in Search and
  selects an Owner and asserts `listRecordings` is called with `q`/`ownerUserId`
  and the cursor reset — and that **no** client-side filtering occurs.
- **U-2 does not fire commands on reconnect:** a delete/export tapped while
  disconnected is rejected client-side and never replayed when the socket returns
  (§0.3 U-2).
- **Playwright:** stop a recording → follow the Saved-toast link into the library →
  see the new row cycle `Preparing… → Waiting to upload → Uploading… → Uploaded`
  under the `happy` script; then `disk-full` removing a row with the non-alarming
  note as the failure path.
- **Contract honesty:** every mocked `listRecordings` / `recording.artifact` /
  `upload.job` validates against the `contracts/` zod schemas, including the CG-5
  params once applied v0.5.
