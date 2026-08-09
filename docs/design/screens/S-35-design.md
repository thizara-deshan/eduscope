# S-35 Upload Queue — per-recording jobs, the offline vs failed distinction & manual re-enqueue — wireframe & screen design

> Closes **W-9** in [screen-inventory §9](../screen-inventory.md#9-screens-needing-wireframe-approval)
> ("Parity §5.1 item 2"). Nothing in this document may be contradicted by a plan
> or by generated code; if it must change, that is a gate discussion, not an
> in-run improvisation ([frontend-conventions](../frontend-conventions.md) preamble).
>
> **Status:** ✅ **approved 2026-08-09**, Wave 5 design gate. Depends on:
> [S-25](../screen-inventory.md#s-25-advanced-shell-panel-advanced) (the Advanced
> shell that hosts it) and **[S-21-design.md §3](S-21-design.md#3-the-uploadmerge-badge-vocabulary-shared-with-s-35)**
> — the **badge vocabulary this screen inherits verbatim** for its row-state
> labels. Owns: **CG-20** (the `failureClass` field that makes the `offline`
> row-state reachable, §9).
>
> **This is the admin's upload-recovery console.** Its load-bearing job: show one
> honest row per recording — never hiding a dead-letter (B-28), never crying "failed
> 8 times" when the device is merely offline (§4.4) — with a manual re-enqueue that
> replaces legacy's hardcoded manual-upload endpoint (B-35).

---

## 0. Evidence base

| Source | What it fixed here |
|---|---|
| [screen-inventory §5 S-35](../screen-inventory.md#s-35-upload-queue-admin-advanceduploads) | The states (`loading`/`empty`/`populated`, the machine-3a row states, **`offline`**, `part expansion`, `requeue`, **`no cancel action`**), the `listUploadJobs`/`getUploadJob`/`requeueUploadJob` data, "dead-letter always visible with its reason", "≥ 64 px rows with expand", "progress bars not the only signal", "Retry states what it will do", and *"prototype coverage none → wireframe required"* |
| [S-21-design.md §3](S-21-design.md#3-the-uploadmerge-badge-vocabulary-shared-with-s-35) | **The upload/merge badge vocabulary S-35 inherits** for its row-state labels — one derivation (`use-recording-badge`), two screens; a row reads the same here as in the library |
| [screen-inventory §0.3](../screen-inventory.md#03-universal-states--implemented-once-inherited-by-every-screen) | U-1, U-2, U-3, U-4, U-5, **U-6** (this is an admin route) — inherited |
| [screen-inventory §8](../screen-inventory.md#8-design-token-sheet) | Every token used below; `--tap-row-lg` (64); `--danger`/`--warning`/`--success`; no new value |
| [state-machines §4 Machine 3a](../state-machines.md#4-machine-3--upload-pipeline) | `UploadJob.state` U-01…U-10: `queued`·(`blockedBy=merge`→"Preparing…", SM-D-1)·`uploading`·`completing`(renders as uploading)·`done`·`failed`·`dead-letter`·`cancelled`; **one job per Recording** (INV-UJ-1); **requeue only from dead-letter** (U-09, else `409 upload.not-requeueable`); **U-10 cancel = recording deletion** (C-1, no cancel button) |
| [state-machines §4.4](../state-machines.md#4-machine-3--upload-pipeline) | **The offline classification: connectivity failures do NOT consume attempts** (retry at the capped 6 h interval indefinitely, `upload.offline` after 24 h); 5xx/reset/stall consume attempts → dead-letter at the cap; 4xx → dead-letter after 2; part-missing → immediate dead-letter (U-08). **The distinction S-35 must render but the contract can't express — CG-20** |
| [state-machines §4.3 Machine 3b](../state-machines.md#4-machine-3--upload-pipeline) | `UploadFilePart` UP-01…UP-05 with `bytesSent`/`bytesTotal` — the part-expansion rows |
| [`contracts/openapi.yaml`](../../../contracts/openapi.yaml) `listUploadJobs` | `GET /uploads?cursor=&limit=&state=`, `x-required-role: admin` → `{items: UploadJob[], nextCursor}` |
| [`contracts/openapi.yaml`](../../../contracts/openapi.yaml) `getUploadJob` | `GET /uploads/{jobId}` → `UploadJobDetail` (`UploadJob` + `parts: UploadFilePart[]` + `metadata`), admin |
| [`contracts/openapi.yaml`](../../../contracts/openapi.yaml) `requeueUploadJob` | `POST /uploads/{jobId}/requeue`, admin → 202 / **`409 upload.not-requeueable`** (only dead-letter is requeueable; remote cleanup runs first) |
| [`contracts/openapi.yaml`](../../../contracts/openapi.yaml) `UploadJob` | `{recordingTitle, state, attempt, nextAttemptAt, lastError, lastErrorAt, progressPct, blockedBy, enqueuedAt, requeuedAt, remoteLectureId}` — **but no field distinguishing a connectivity stall from a server failure** (CG-20, §9) |
| [`contracts/events.md` §2.18/§2.19](../../../contracts/events.md) | `upload.job` (job rows, on transition + ≥ 5 % steps) and `upload.part` (per-file expansion); `system.alert{upload.dead-letter, upload.offline}` |
| [PRD AD-9](../../PRD.md) | *"per-file upload state, retry history, and a manual re-enqueue"* — the charter |
| [behavioral-inventory B-28](../../discovery/behavioral-inventory.md#b-28-nofile-status) | Legacy silently **excluded** `nofile` items from the queue view — a dead-lettered upload vanished. **CHANGE: dead-letter is always visible with its reason** (INV-UJ-4) |
| [behavioral-inventory B-35](../../discovery/behavioral-inventory.md#b-35-manual-per-file-upload-endpoint--hardcoded-target-orphaned-ui) | Legacy's manual upload hit a **hardcoded** remote with a hardcoded key and `uid=136`, behind a commented-out button. **DROP the hardcoded endpoint; the requeue is its principled successor** (`[D-13]`) |

---

## 1. Constraints that are not design choices

**C-1. There is no cancel button — cancelling an upload means deleting the
recording.** Contract C-1 (events.md) and U-10: `cancelled` is reachable *only* via
recording deletion. The brief's "list/retry/cancel" conflicts with Machine 3, and v0
ships **list + detail + requeue** only. So this screen offers no cancel — a "Cancel
upload" button would map to no transition (G-5's placebo). An admin who truly wants to
stop an upload deletes the recording (S-24), and the confirm there warns the upload
will be cancelled (S-24 §2.3, C-5 there).

**C-2. One row per recording, never per file.** INV-UJ-1: one `UploadJob` per
`Recording`. The row is the *job*; per-file detail (`UploadFilePart`s) lives behind an
expand (§2.4). A `separate-files` or multi-segment recording has several parts under
**one** row — the legacy per-file listing (B-31's shape) is not resurrected here.

**C-3. Dead-letter is always visible, with its reason.** B-28 silently dropped
`nofile`/dead-lettered items, so an upload that would never succeed simply
disappeared from view. INV-UJ-4 reverses this: a `dead-letter` row is **always
shown**, with `lastError` as its reason and a requeue affordance (C-4). The whole
point of an upload console is that nothing recovers silently and nothing fails
silently.

**C-4. Requeue is only for dead-letter, and it says what it will do.** U-09: only a
`dead-letter` job is requeueable (`409 upload.not-requeueable` otherwise); requeue
resets `attempt = 0`, runs remote cleanup first if `remoteLectureId` is set, and is
audited (`AuditLogEntry(reason=requeue)`) — the principled successor to B-35's
hardcoded endpoint. The button appears **only** on dead-letter rows and states its
effect ("Try again now"), never a bare icon (screen-inventory §5).

**C-5. "Offline" is not "failed" — and the row must be able to tell them apart.**
§4.4 is explicit: connectivity failures (no route / DNS / TLS / connect timeout) **do
not consume attempts** — the job retries at the capped 6 h interval *indefinitely* and
raises `upload.offline` only after 24 h. A server failure (5xx / reset / stall)
consumes attempts and dead-letters at the cap. Both currently surface as
`state = failed`, and the difference is invisible on the wire: `UploadJob` has no
field saying which class this pause is. Rendering "failed 8 times" for a device that
is simply offline over a weekend is the exact lie the screen exists to prevent — so
this screen **requires CG-20** (§9), the field that makes the `offline` row-state
reachable. Reading `lastError` text to guess the class is forbidden (INV-RF-1's
no-string-parsing discipline).

**C-6. Progress is never carried by colour or a bar alone.** Screen-inventory §5:
"progress bars must not be the only signal (colour-blind safety) — pair with a
percentage and state label." Every row carries a **word** (its badge label, from
S-21 §3) and a number; the bar and colour reinforce, never replace.

**C-7. `empty` is a good state and must read that way.** "Everything has been
uploaded" is a genuinely healthy device (INT-1's goal reached), not an absence of
data. It is rendered as a reassuring statement, not a bare "no rows".

---

## 2. Wireframe

**The design in one sentence:** inside the Advanced shell, one 64 px row per
recording carrying the shared badge, attempt/next-retry/progress, a dead-letter reason
and a requeue button — with an honest **"waiting for the network"** for offline jobs
and an expand for per-file parts.

### 2.1 Populated

```
┌ .us-adm__content (inside S-25 Advanced shell) ──────────────────────────────┐
│  Upload Queue                                        [ ▾ State: All ]        │  state filter chip (listUploadJobs?state=)
│  ────────────────────────────────────────────────────────────────────────── │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │ Data Structures — Lecture 12                                     ▸    │   │  ≥64 px row; ▸ expands parts
│  │ ● Uploaded · finished 14:31                                           │   │  badge #5 (S-21 §3)
│  ├──────────────────────────────────────────────────────────────────────┤   │
│  │ Algorithms — Lecture 11                                          ▸    │   │
│  │ ◐ Preparing… · waiting for the recording to be combined               │   │  queued + blockedBy=merge (SM-D-1)
│  ├──────────────────────────────────────────────────────────────────────┤   │
│  │ Operating Systems — Lecture 10                                   ▾    │   │  expanded (▾)
│  │ ▲ Uploading… 58% · 1.4 GB of 2.4 GB                                    │   │  badge #4 + real bytes
│  │   ├ composite.mp4    ████████░░░  62%   1.5 GB / 2.4 GB                │   │  UploadFilePart rows (C-2)
│  │   └ camera-2.mp4     ██████░░░░░  51%   0.7 GB / 1.4 GB                │   │
│  ├──────────────────────────────────────────────────────────────────────┤   │
│  │ Networks — Lecture 9                                             ▸    │   │
│  │ ⏳ Waiting for the network · will keep trying (last tried 13:40)       │   │  OFFLINE (CG-20) — NOT "failed" (C-5)
│  ├──────────────────────────────────────────────────────────────────────┤   │
│  │ Databases — Lecture 8                                            ▸    │   │
│  │ ▲ Upload failed · attempt 3 of 8 · next try 15:10                      │   │  badge #6 (server-class, C-5)
│  ├──────────────────────────────────────────────────────────────────────┤   │
│  │ Graphics — Lecture 7                                             ▸    │   │
│  │ ⚠ Upload needs attention · a file went missing        [ Try again now]│   │  dead-letter (C-3) + requeue (C-4)
│  └──────────────────────────────────────────────────────────────────────┘   │
│                              [  Load more  ]                                  │
└──────────────────────────────────────────────────────────────────────────────┘
```

Each row is the **job** (one per recording, C-2); the badge and label come from the
shared vocabulary (S-21 §3). The **offline** row (`⏳ Waiting for the network`) is
visibly distinct from the **failed** row (`▲ Upload failed · attempt 3 of 8`) — the
CG-20 distinction (C-5). Only the **dead-letter** row carries **Try again now** (C-4).
The **▸/▾** expands per-file parts (C-2, §2.4). **No cancel button anywhere** (C-1).

### 2.2 `empty` — the good state (C-7)

```
│              ┌───────────────────────────────┐                      │
│              │            ✓                   │                      │
│              │   Everything has been          │                      │
│              │   uploaded.                    │                      │
│              │                               │                      │
│              │   New recordings appear here   │                      │
│              │   while they upload.           │                      │
│              └───────────────────────────────┘                      │
```

`empty` reads as the achievement it is (INT-1), not a void — `--success` mark, a plain
statement, and a note about when rows return.

### 2.3 The offline row, in full (CG-20, C-5)

```
│  Networks — Lecture 9                                            ▸    │
│  ⏳ Waiting for the network · will keep trying                         │  failureClass=connectivity
│     Last tried 13:40. No attempts used — the device just can't reach   │  §4.4: connectivity ≠ attempt
│     the upload server right now.                                       │
```

When `state = failed ∧ failureClass = connectivity` (CG-20), the row says the device
is **waiting for the network**, states that **no attempts are being spent** (§4.4),
and shows the last-tried time — never "attempt N of 8". After 24 h the shell's
`upload.offline` alert reinforces it, but the row is honest from the first minute, not
only after a day.

### 2.4 Part expansion (C-2)

```
│  Operating Systems — Lecture 10                                  ▾    │
│  ▲ Uploading… 58% · 1.4 GB of 2.4 GB                                   │
│   ├ composite.mp4    ████████░░░  62%   1.5 GB / 2.4 GB                │  UploadFilePart{bytesSent/Total}
│   └ camera-2.mp4     ██████░░░░░  51%   0.7 GB / 1.4 GB   ✕ missing?   │  a missing part → immediate dead-letter (U-08)
```

Expanding a row reveals its `UploadFilePart` rows (`getUploadJob` detail + live
`upload.part`), each with `bytesSent/bytesTotal`. A part in `missing` (UP-04) explains
the job's dead-letter (U-08). The expand is a ≥ 44 px affordance; parts are read-only
(there is no per-part action — requeue is per-job, C-4).

---

## 3. The badge vocabulary — inherited, not redefined

S-35's row-state labels **are** the S-21 §3 matrix, read through the same
`use-recording-badge` derivation. This screen adds nothing to the vocabulary except
the **offline rendering** (CG-20), which S-21's badge #6 does not need to distinguish
(a library reader cares that upload is retrying; the *admin console* cares whether
attempts are being spent). The mapping:

| S-35 row | S-21 §3 badge | Note |
|---|---|---|
| `Preparing…` | #1 (`mergeState` merging) | SM-D-1: `queued` + `blockedBy=merge` |
| `Waiting to upload` | #3 (`queued`) | — |
| `Uploading… {pct}%` | #4 (`uploading`/`completing`) | `completing` renders as uploading |
| `Uploaded` | #5 (`done`) | — |
| **`Waiting for the network`** | — (S-35-only) | `failed ∧ failureClass=connectivity` (CG-20, C-5) — the one label S-35 adds |
| `Upload failed · attempt N of 8 · next try {t}` | #6 (`failed`) | `failed ∧ failureClass∈{server}` (C-5) |
| `Upload needs attention · {reason}` | #7 (`dead-letter`) | + requeue (C-4) |
| `Cancelled` | — | via recording deletion only (U-10, C-1); shown if `includeDeleted`-adjacent, read-only |

A recording therefore reads the **same** in the library and here for every state that
S-21 shows — the "one truth, two screens" guarantee (S-21 LIB-D-1) — with S-35 adding
only the offline/failed split its console needs.

---

## 4. Component breakdown

```
apps/panel/src/screens/advanced/uploads/
  upload-queue-screen.tsx     the admin page: state filter, list, load-more, empty
  upload-job-row.tsx          one 64 px job row: badge, attempt/next/progress, requeue (dead-letter), expand
  upload-parts.tsx            the per-file UploadFilePart rows (expanded)
  requeue-button.tsx          dead-letter-only "Try again now" → cmd.upload.requeue
  use-upload-jobs.ts          listUploadJobs query merged with upload.job / upload.part
  use-upload-row-label.ts     job → { badge (S-21 §3), offlineCopy? } — reuses use-recording-badge, adds the offline split
```

| Unit | What it does | How you use it | What it depends on |
|---|---|---|---|
| `use-upload-jobs.ts` | The paged `listUploadJobs` query keyed on `{state, cursor}`, merged live with `upload.job` (rows) and `upload.part` (expanded parts) through `selectors.ts`; handles U-1/U-3 | `const { jobs, loadMore } = useUploadJobs(filter)` | `EduscopeClient.listUploadJobs` / `getUploadJob`, WS `upload.job` / `upload.part` |
| `use-upload-row-label.ts` | `(UploadJob) → { badge, offline? }` — reuses `use-recording-badge` for every shared state, and adds the **offline vs server** split from `failureClass` (CG-20, C-5). The **only** place the offline distinction is written | `const l = uploadRowLabel(job)` | `use-recording-badge` (S-21 §4), `UploadJob.failureClass` |
| `upload-job-row.tsx` | Presentation: badge/label, attempt/next-retry/progress, the expand affordance, and — only on dead-letter — the requeue button. No cancel (C-1) | `<UploadJobRow job={…}/>` | `use-upload-row-label`, `requeue-button` |
| `upload-parts.tsx` | The `UploadFilePart` rows with `bytesSent/bytesTotal`; read-only (C-2) | `<UploadParts jobId={…}/>` | `getUploadJob`, WS `upload.part` |
| `requeue-button.tsx` | Dead-letter-only "Try again now"; owns the `cmd.upload.requeue` 202 and its resolution on `upload.job{queued}`; renders `409 upload.not-requeueable` as U-5 | `<RequeueButton jobId={…}/>` | `EduscopeClient.requeueUploadJob` |

`use-upload-row-label.ts` composes S-21's derivation rather than forking it: every
state S-21 shows is delegated to `use-recording-badge` (so the two screens cannot
disagree, §12), and S-35 adds *only* the connectivity/server split its console needs.
Nothing here imports `fetch`/`axios`/`WebSocket` (frontend-conventions §1).

---

## 5. States

### 5.1 Mapped to Machine 3a + §4.4

| # | State | Entered by | Rendering | Governed by |
|---|---|---|---|---|
| 1 | `loading` (U-1) | cold mount | skeleton rows; no full-screen spinner | §0.3 U-1 |
| 2 | `empty` | 200, `items = []` | §2.2 "Everything has been uploaded" — the good state (C-7) | INV-UJ-4 |
| 3 | `queued` | `upload.job{queued}` (no `blockedBy`) | badge #3 "Waiting to upload" | U-01 |
| 3b | `preparing` | `queued ∧ blockedBy=merge` | badge #1 "Preparing…" | SM-D-1 |
| 4 | `uploading` / `completing` | `upload.job{uploading\|completing}` | badge #4 + real bytes; `completing` renders as uploading | U-02/U-03 |
| 5 | `done` | `upload.job{done}` | badge #5 "Uploaded · finished {t}" | U-04 |
| 6 | `offline` | `failed ∧ failureClass=connectivity` (CG-20) | §2.3 "Waiting for the network · will keep trying"; **no attempt count** (C-5, §4.4) | §4.4, CG-20 |
| 7 | `failed` (server) | `failed ∧ failureClass=server` | badge #6 "Upload failed · attempt N of 8 · next try {nextAttemptAt}" | U-05, §4.4 |
| 8 | `dead-letter` | `upload.job{dead-letter}` (U-07/U-08) | badge #7 + reason (`lastError`); **Try again now** (C-3/C-4) | U-07/U-08 |
| 9 | `requeue pending` (U-4) | Try again now tapped | pending on the button; resolves on `upload.job{queued}` | U-09, §0.3 U-4 |
| 10 | `requeue refused` (U-5) | `409 upload.not-requeueable` | named reason next to the button (the job left dead-letter under the admin — U-3 territory) | U-05, C-4 |
| 11 | `part expansion` | ▸ tapped | §2.4 `UploadFilePart` rows; a `missing` part explains the dead-letter | U-08, C-2 |
| 12 | `cancelled` | `upload.job{cancelled}` (U-10, via S-24 deletion) | read-only terminal; **no cancel control produced it** (C-1) | U-10 |
| — | `U-2` reconnecting | `T-WS-STALE` | live progress dimmed + not-live marker (never hidden); requeue disabled (a requeue tapped offline must not fire on reconnect) | §0.3 U-2 |
| — | `U-3` resync | `seq` gap | full snapshot re-request; unchanged rows must not flash populated→skeleton | §0.3 U-3 |
| — | `U-6` forbidden | non-admin | the whole route is `x-required-role: admin`; the nav never shows it to a lecturer (S-25 role gate); a `403` is a bug surface | §0.3 U-6 |

### 5.2 Diagram — a job row (Machine 3a + §4.4, as the console sees it)

```mermaid
stateDiagram-v2
    [*] --> queued: U-01 (blockedBy=merge → "Preparing…", SM-D-1)
    queued --> uploading: U-02
    uploading --> completing: U-03
    completing --> done: U-04 ("Uploaded")
    uploading --> failedServer: U-05 server error (attempt++, §4.4)
    uploading --> offline: U-05 connectivity (attempt NOT spent, §4.4, CG-20)
    offline --> uploading: retry at 6h cap when network returns
    failedServer --> queued: U-06 backoff elapsed
    failedServer --> deadLetter: U-07 attempt cap / permanent
    uploading --> deadLetter: U-08 part missing
    deadLetter --> queued: U-09 requeue (admin, "Try again now", C-4)
    uploading --> cancelled: U-10 recording deleted (S-24; no cancel button, C-1)
    note right of offline
      "Waiting for the network" — NOT "failed 8 times".
      Needs failureClass on UploadJob — CG-20 (C-5).
      upload.offline alert reinforces after 24h.
    end note
    note right of deadLetter
      ALWAYS visible with its reason (INV-UJ-4, B-28).
      The ONLY requeueable state (else 409, C-4).
    end note
```

---

## 6. Copy deck

| Where | Copy |
|---|---|
| Screen title | `Upload Queue` |
| State filter | `State: All` / `State: {value}` |
| Row — done | `Uploaded · finished {time}` |
| Row — preparing | `Preparing… · waiting for the recording to be combined` |
| Row — queued | `Waiting to upload` |
| Row — uploading | `Uploading… {pct}% · {copied} of {total}` |
| Row — offline | `Waiting for the network · will keep trying` / `Last tried {time}. No attempts used — the device just can't reach the upload server right now.` |
| Row — failed (server) | `Upload failed · attempt {n} of {cap} · next try {time}` |
| Row — dead-letter | `Upload needs attention · {reason}` |
| Row — cancelled | `Cancelled` |
| Requeue button | `Try again now` |
| Requeue refused | `This upload can't be requeued right now.` |
| Part row | `{fileName} · {pct}% · {sent} / {total}` |
| Part — missing | `✕ file missing` |
| Empty | `Everything has been uploaded.` / `New recordings appear here while they upload.` |
| Load more | `Load more` |

Three notes:

- **"Waiting for the network · No attempts used"** is the sentence CG-20 exists to
  enable: it tells the admin the device is fine and patient, not that an upload is
  burning through retries (§4.4, C-5).
- **The dead-letter reason is `lastError`, surfaced, never parsed** (C-5): the screen
  shows the string; it does not read it to *decide* the state (that is `state` +
  `failureClass`).
- **"Try again now" states its effect** (screen-inventory §5): the admin knows a tap
  re-enqueues immediately (resets attempts, cleans up remote first), not a vague
  "retry".

---

## 7. Token usage

**No new token.** Row states reuse S-21 §3's palette; the offline state uses
`--warning` (patient, not failed) distinct from the dead-letter `--danger`.

| Element | Tokens |
|---|---|
| Screen title | `--fs-xl` / 800, `--text` |
| State filter chip | `--surface-2`, 1 px `--border`, `--radius-pill`, `--fs-sm`, ≥ `--tap-min` |
| Job row | `--tap-row-lg` (64), `--surface`, 1 px `--border` between rows, `--radius-md`, `--sp-6` |
| Row title | `--fs-md` / 700, `--text` |
| Badge/label | reuses S-21 §3 tones (`--success`/`--accent`/`--warning`/`--danger` + soft plates) |
| Offline label | `--warning` text (patient), `⏳` glyph — deliberately **not** `--danger` |
| Failed label | `--warning`; attempt/next-try `--text-muted` |
| Dead-letter label | `--danger`; reason `--text-muted` |
| Progress bar | track `--surface-3`, fill `--accent`, ≥ 8 px tall (paired with % + word, C-6) |
| Expand ▸/▾ | ≥ `--tap-min` icon, `--text-muted` |
| Part row | `--surface-2`, `--fs-xs`, indented; missing `✕` `--danger` |
| Requeue "Try again now" | `--accent` fill (a **recovery**, never `--danger`), `--radius-md`, ≥ 44 px |
| Empty plate | `--success` mark, `--fs-lg` statement, `--text-muted` note |
| Load more | full-width `--surface-2`, ≥ `--tap-row` (56) |

The **offline** state is `--warning` (amber — degraded but self-healing), pointedly
different from **dead-letter** `--danger` (needs a human). Requeue is `--accent`, not
`--danger`: re-enqueuing recovers, it does not destroy (the S-06 §3 discipline, kept
off a recovery control — the same call S-22's Retry makes).

---

## 8. Touch, kiosk & accessibility

- **Rows ≥ 64 px** (`--tap-row-lg`) with a ≥ 44 px expand affordance for parts
  (screen-inventory §5); the requeue button (dead-letter only) is its own ≥ 44 px
  target, ≥ 8 px from the expand.
- **Progress is never colour/bar alone** (C-6, screen-inventory §5): every row pairs
  the bar with a **percentage** and a **state word**; a colour-blind admin reads the
  state without the bar.
- **The offline/failed distinction is in words** (C-5): "Waiting for the network"
  vs "Upload failed · attempt N" — not two shades of the same badge.
- **No page scroll:** the list body scrolls inside `.us-adm__content` (S-25 shell);
  the title and filter are fixed. The Advanced shell already fits 800 px at 10 nav
  items (S-25 touch note).
- **Screen readers:** each row is an `article` named `{title}, {state label}`; the
  state label is text (§3), so "waiting for the network" or "attempt 3 of 8" reads
  without colour. The expand is a `button` with `aria-expanded`; parts are a `list`.
  Requeue announces "Try again now — re-enqueue this upload".
- **`prefers-reduced-motion`:** progress bars fill without animation; no state is
  carried by motion — the word and percentage carry it (§8.6).
- **U-2:** live progress dims and is marked not-live (never hidden); requeue is
  disabled while disconnected so a tap can't fire on reconnect. Dead-letter rows —
  being static — stay fully readable, which matters because they are the ones an
  admin came to act on.

---

## 9. Contract changes this design requires

**One — CG-20 (additive). This screen owns it.**

### CG-20 — `UploadJob` cannot distinguish an offline stall from a server failure

§4.4 classifies upload failures into three classes with **different behaviour**:
*connectivity* (no route / DNS / TLS / connect timeout) **does not consume attempts** —
it retries at the capped 6 h interval indefinitely and raises `upload.offline` only
after 24 h; *server* (5xx / reset / stall) consumes attempts and dead-letters at the
cap; *permanent* (4xx / part-missing) dead-letters fast. The server **computes** this
class. But `UploadJob` (and `UploadJobPayload`) expose only `state`, `attempt`,
`nextAttemptAt`, `lastError` — a connectivity stall and a server failure are **both**
`state = failed`, and nothing on the wire says which. So S-35's `offline` row-state
(§2.3, the inventory's own "waiting for the network, not failed 8 times") is
**unreachable**: the only way to guess the class would be to parse `lastError` text,
which INV-RF-1's no-string-parsing discipline forbids.

| | |
|---|---|
| **Gap** | `UploadJob` has no field distinguishing a connectivity/offline stall (non-attempt-consuming) from a server failure (attempt-consuming). Both are `state = failed` |
| **Screen** | S-35 (state `offline`, §2.3 / §5.1 #6); no other screen needs the split (S-21's badge #6 shows "retrying" without the class) |
| **Severity** | **Medium** — without it the console shows "failed, attempt N of 8" for a device that is merely offline, the exact §4.4 lie the `offline` state exists to prevent; the `upload.offline` alert (device-wide, after 24 h) is not a per-row substitute |
| **Fix** | Add **`failureClass ∈ {connectivity, server, permanent} \| null`** to `UploadJob` and `UploadJobPayload` (events.md §2.18), mirroring the §4.4 classification the emitter already computes. `null` when `state ∉ {failed, dead-letter}`. **Additive** — one enum field; the value already exists server-side (it decides whether `attempt` increments), so nothing new is computed |
| **Kind** | **additive** |
| **Status** | ✅ **answered 2026-08-09** at this gate; to be **applied v0.5** (openapi.yaml `UploadJob` + events.md §2.18 `UploadJobPayload`) before Wave 5's plan run. Registered in [screen-inventory §10](../screen-inventory.md#10-contract-gaps) CG-20 |
| **If rejected** | S-35 cannot render `offline` distinctly and must either mislabel connectivity stalls as attempt-consuming failures (the §4.4 lie) or wait 24 h for the device-wide `upload.offline` alert to explain a row — both strictly worse. Recorded here so the fallback is a decision, not a silent omission |

### 9.1 Changes this design deliberately does **not** require

- **No cancel endpoint.** Contract C-1 (events.md): cancel = delete the recording
  (C-1 here). This screen produces no cancel control, so it needs none (the brief's
  "cancel" is reconciled to deletion, not invented).
- **No per-part action.** Requeue is per-job (C-4); parts are read-only detail. No
  `UploadFilePart`-level operation is needed.
- **No `attemptCap` field.** The cap (8) is a §4.4 policy constant the copy renders
  ("attempt N of 8"); if it ever becomes configurable that is a `RetentionPolicy`-style
  additive, flagged here rather than assumed.
- **No new alert.** `system.alert{upload.dead-letter, upload.offline}` already exist;
  CG-20 makes the **per-row** offline state honest from minute one, which the 24 h
  alert cannot.

---

## 10. Mock & scenario work Wave 5 inherits

| Gap | Where | Fix |
|---|---|---|
| Every row state reachable | `packages/api-client/src/mock/` uploads | Seed jobs covering §5.1 — `preparing`, `queued`, `uploading`, `done`, `failed` (server), `dead-letter` (part-missing and cap), `cancelled`; extend the catalog, never fork (frontend-conventions §4) |
| The offline vs failed split (CG-20) | `mock/scenario/scripts/` (extend `disk-full`/add a `wan-loss`) | Once `failureClass` is applied v0.5, drive a job to `failed` with `failureClass=connectivity` and assert the row reads "Waiting for the network · No attempts used" — **not** an attempt count; and a separate job to `failed`/`server` that **does** show "attempt N of 8" |
| Dead-letter always visible (B-28) | `mock/rest/` uploads | A dead-letter job is returned by `listUploadJobs` and rendered with its reason + requeue; a test asserts it is **never** filtered out |
| Requeue (CG-4) | `mock` | `requeueUploadJob` on a dead-letter job → 202 → `upload.job{queued}`; on a non-dead-letter job → `409 upload.not-requeueable` rendered as U-5 |
| Part expansion | `mock/rest/` uploads + `mock/ws/` upload.part | `getUploadJob` returns parts with `bytesSent/bytesTotal`; a `missing` part explains a dead-letter; live `upload.part` updates the expanded rows |
| Empty good-state | `mock` | `listUploadJobs` → `[]` renders "Everything has been uploaded" (C-7), not a bare empty |

---

## 11. Decisions taken here

| Id | Decision | Rationale | Cost to reverse |
|---|---|---|---|
| **UQ-D-1** | **The row-state labels are S-21 §3, inherited through `use-recording-badge`; S-35 adds only the offline/failed split** | One derivation, two screens — a recording reads the same in the library and the console (S-21 LIB-D-1). The admin console needs *one* extra distinction (attempts spent or not), which is CG-20, not a new vocabulary | Medium — coupled to S-21 §3 |
| **UQ-D-2** | **`offline` is a first-class row-state, styled `--warning` and worded "Waiting for the network · No attempts used"** — requiring CG-20 | §4.4 makes connectivity failures non-attempt-consuming; rendering them as "failed 8 times" is a lie the console exists to prevent (C-5). The field already exists server-side; surfacing it is additive | Low — CG-20 is additive |
| **UQ-D-3** | **No cancel button; cancel = delete the recording (S-24)** | Contract C-1 / U-10: `cancelled` has no other trigger; a cancel button would be a placebo (G-5). The reconciliation is deletion, warned about in S-24 | Low |
| **UQ-D-4** | **Requeue appears only on dead-letter, states its effect, and is `--accent` not `--danger`** | U-09: only dead-letter is requeueable (else `409`); "Try again now" tells the admin it re-enqueues immediately; re-enqueuing recovers, so it is not a destructive colour (C-4) | Low |
| **UQ-D-5** | **One row per recording; parts are read-only behind an expand** | INV-UJ-1: one job per recording; per-file detail is diagnostic, not a place to act (C-2). The legacy per-file listing (B-31) is not resurrected | Low |
| **UQ-D-6** | **`empty` is rendered as a good state** | "Everything has been uploaded" is INT-1's goal reached, not an absence — the console should celebrate it, not show a void (C-7) | Low |

---

## 12. Requirements this screen places on other screens

- **S-21 owns the badge vocabulary (§3); S-35 inherits it.** Both read
  `use-recording-badge`; a test feeds one `Recording`/`UploadJob` to a library row
  and a queue row and asserts an identical badge label for every shared state
  (S-21 §13, §12 here). S-35 may add the offline label but not redefine the rest.
- **S-24's in-flight-delete warning points here.** Deleting a mid-upload recording
  produces a `cancelled` row (U-10); S-24 §2.3 is the heads-up that this row appears.
- **S-22's `file missing` links here.** A dead-lettered file (U-08) is explained on
  S-22 and acted on here (requeue); the two share the U-08 cause.
- **S-03's alert host** owns `upload.dead-letter`/`upload.offline` beyond this
  screen's rows; the per-row `offline` state (CG-20) is honest from minute one, the
  shell alert is the 24 h escalation — they are the same fact at two time-scales and
  must not be conflated.
- **S-25 (Advanced shell) hosts this route**, role-gated to admin (U-6); the nav
  never offers it to a lecturer.

---

## 13. Testing floor

- **Testing Library:** one rendering test per §5.1 state — `loading`, `empty`,
  `preparing`, `queued`, `uploading`, `done`, **`offline`** (asserts "Waiting for the
  network · No attempts used", **no** attempt count), `failed` (server — asserts
  "attempt N of 8"), `dead-letter` (asserts reason + requeue), `requeue pending`,
  `requeue refused` (`409`), `part expansion` (incl. a `missing` part), `cancelled`,
  U-2, U-6.
- **The offline/failed split is the headline test (CG-20, C-5):** two jobs both
  `state = failed`, one `failureClass=connectivity` and one `failureClass=server`,
  render **different** rows — the console never shows an attempt count for the
  connectivity job.
- **Badge parity with S-21 (UQ-D-1):** the shared `use-recording-badge` test suite is
  imported; a recording renders the same label here and in the library for every
  shared state.
- **Dead-letter is never hidden (B-28, C-3):** a test asserts a dead-letter job is in
  the rendered list with its reason and a requeue button.
- **Requeue guard (C-4):** requeue on dead-letter → `upload.job{queued}`; requeue on
  any other state → `409 upload.not-requeueable` rendered as U-5, and the button is
  not left live to re-tap.
- **No cancel control (C-1):** a structural test asserts no button matching
  `/cancel/i` renders on any row.
- **U-6:** the route is admin-only; a lecturer never sees it in the nav, and a `403`
  is a bug surface, not a normal state.
- **Playwright:** as admin, watch a job go `Preparing… → Waiting to upload →
  Uploading… → Uploaded` under `happy`; then a `wan-loss` scenario showing "Waiting
  for the network" (not "failed"), and a dead-letter requeued with "Try again now".
- **Contract honesty:** every mocked `listUploadJobs` / `getUploadJob` / `upload.job`
  / `upload.part` validates against the `contracts/` zod schemas, including
  `failureClass` once CG-20 is applied v0.5.
