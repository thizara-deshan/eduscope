# S-24 Delete recording confirm — the DangerConfirm instance, the never-uploaded warning & the real audit actor — wireframe & screen design

> Closes **W-8** in [screen-inventory §9](../screen-inventory.md#9-screens-needing-wireframe-approval)
> ("Parity §2c delete row"). Nothing in this document may be contradicted by a
> plan or by generated code; if it must change, that is a gate discussion, not an
> in-run improvisation ([frontend-conventions](../frontend-conventions.md) preamble).
>
> **Status:** ✅ **approved 2026-08-09**, Wave 5 design gate. Depends on:
> [S-21](S-21-design.md) / [S-22](S-22-design.md) (the surfaces that open it) and
> **[S-06-design.md §3](S-06-design.md#3-the-destructive-action-vocabulary--product-wide)**
> — the product-wide destructive vocabulary this screen **inherits and may not
> redefine**. **Requires no contract change** (§9).
>
> **This is a small, admin-only surface with one dangerous button.** Its whole
> design is: instantiate the shared `DangerConfirm` correctly, state the right
> consequence (especially the RET-2 never-uploaded case), and record a real
> `deletedBy`/`deleteReason` actor — killing B-33's `deleted(<uid>)` status-string
> smuggling. It invents nothing; it inherits.

---

## 0. Evidence base

| Source | What it fixed here |
|---|---|
| [screen-inventory §4 S-24](../screen-inventory.md#s-24-delete-recording-confirm-overlay-on-s-21--s-22) | The states (`confirm`, `confirm — not yet uploaded`, `pending`, `refused`, `deleted`), the `deleteRecording` data, "destructive button right-aligned, `--record` filled, ≥ 24 px from Cancel", "**no type-to-confirm** (reserved for S-30's format)", and *"prototype coverage none → wireframe required"* |
| **[S-06-design.md §3](S-06-design.md#3-the-destructive-action-vocabulary--product-wide)** | **The product-wide destructive vocabulary S-24 inherits verbatim**: the two tiers (`danger-quiet` entry, `danger-solid` confirm), the shared `DangerConfirm` (title/body/message-slot/footer), `dismissible:false`, initial focus on **Cancel**, the four states (`confirm`/`pending`/`refused`/`done`), the 40 px reserved message slot, the `--sp-10` danger separation |
| [screen-inventory §0.3](../screen-inventory.md#03-universal-states--implemented-once-inherited-by-every-screen) | U-2, U-4, U-5, **U-6** (delete is admin-only; a lecturer never reaches the control) — inherited |
| [screen-inventory §8](../screen-inventory.md#8-design-token-sheet) | Every token used below; `--danger`/`--danger-soft` (shipped with W-1/W-13); **no new value** |
| [state-machines §2 RA-06](../state-machines.md#2-machine-1b--recording-artifact-and-1c--channel-consumer) | `ready → deleted` on `cmd.recording.delete` (admin, `G-ADMIN`): sets `deletedAt`/`deletedBy`/`deleteReason` as **real columns** (B-33's status string dies), removes files, keeps the `LectureSession` row (INV-LS-7), writes an `AuditLogEntry` |
| [state-machines §4.2 U-10](../state-machines.md#4-machine-3--upload-pipeline) | Deleting a recording with an in-flight `UploadJob` transitions the job to `cancelled` (abort + remote cleanup) — the consequence the confirm must warn about |
| [state-machines §4.5 RET-2](../state-machines.md#45-retention-sweep-a-20-pf-7-d-15) | An aged recording with **no successful upload** is **never** auto-deleted (`neverDeleteUnuploaded`, the reversal of B-20) — so deleting one is a stronger, irreversible act the system itself would never take |
| [`contracts/openapi.yaml`](../../../contracts/openapi.yaml) `deleteRecording` | `DELETE /recordings/{recordingId}`, `x-required-role: admin`, **202-async**; `recording.artifact{deleted}` + `upload.job{cancelled}` (U-10) follow; `403` (lecturer) / `404` |
| [`contracts/openapi.yaml`](../../../contracts/openapi.yaml) `Recording` | `title`, `ownerDisplayName`, `durationMs`, `uploadState` — everything the confirm needs to name the target and decide the never-uploaded warning |
| [`contracts/events.md` §2.3 / §2.18](../../../contracts/events.md) | `recording.artifact{deleted, deleteReason}` and `upload.job{cancelled}` — the resolving events |
| [PRD LP-10](../../PRD.md) | *"admin-only delete"* — the charter |
| [behavioral-inventory B-33](../../discovery/behavioral-inventory.md#b-33-delete-recordings-admin-only) | Legacy `POST /fmdelete2` marked queue rows `deleted(<userid>)` — **the actor smuggled into a status string**, and treated a 504 as success. **KEEP audited admin delete; CHANGE the encoding to real columns** — this screen's reason to exist |

---

## 1. Constraints that are not design choices

**C-1. This screen inherits S-06 §3 and defines no destructive treatment of its
own.** The two danger tiers, the shared `DangerConfirm`, its dismissal rule
(`dismissible:false`), its initial focus (Cancel), its four states and its layout
were **settled once** at the W-2 gate for the whole product. S-24 is a `DangerConfirm`
instance — it supplies title, body and the destructive label, and nothing else.
Deciding any of that again here is exactly the "two red buttons meaning two
different things" failure S-06 §3 exists to prevent (S-06 S06-D-3).

**C-2. Delete is admin-only, and the button never renders for a lecturer.** RA-06 is
`G-ADMIN`; `deleteRecording` is `x-required-role: admin`. U-6's rule is that the nav
never offers what the role cannot use — so the **Delete** item is absent from
S-21's row menu and S-22's actions for a lecturer (C-2 there). A `403` reaching this
screen anyway is a **bug surface** (the button should not have been reachable),
rendered as the `refused` state, never as a normal outcome.

**C-3. The confirm names the actual target — title, owner, duration, uploaded — and
the never-uploaded case is a stronger warning.** RET-2 guarantees the system will
**never** auto-delete a recording that was never successfully uploaded
(`neverDeleteUnuploaded`, the reversal of B-20). So an admin deleting such a
recording is doing something the system itself refuses to do on a timer — the only
copy may be about to vanish. The confirm says so explicitly (§2.2), a stronger body
than the ordinary case.

**C-4. Deleting removes media and records a real actor; it does not erase history.**
RA-06 sets `deletedAt`/`deletedBy`/`deleteReason` as **columns** and keeps the
`LectureSession` row (INV-LS-7). B-33 smuggled the actor into a `deleted(<uid>)`
status string; the rewrite records it properly (this is the whole point of the delete
rebuild). The confirm does not surface the audit fields — it *causes* them — but the
copy reflects that deletion is accountable, not silent.

**C-5. An in-flight upload is cancelled, and the confirm warns about it.** U-10: a
`queued`/`uploading` job becomes `cancelled` (abort + remote cleanup) when its
recording is deleted. If `uploadState ∈ {queued, uploading, completing}`, the confirm
adds a line that the upload in progress will be stopped — so the admin is not
surprised by a cancelled job on S-35 afterward.

**C-6. No type-to-confirm.** Screen-inventory §4 reserves type-to-confirm for S-30's
format, where the blast radius is the whole disk. Deleting one recording is a single
`DangerConfirm` (tap Cancel or the solid destructive button); adding a typed
challenge here would both break the shared vocabulary (C-1) and cry wolf.

---

## 2. Wireframe

**The design in one sentence:** the shared `DangerConfirm`, filled with this
recording's real details, with a stronger body when the recording was never
uploaded and an extra line when an upload is in flight — Cancel on the left,
`danger-solid` Delete on the right, ≥ 24 px apart.

### 2.1 `confirm` — the ordinary case (already uploaded)

```
┌──────────── DangerConfirm · --modal-w 680 · --radius-xl ────────────┐
│  Delete this recording?                                 --fs-2xl/800│
│                                                                     │
│  Data Structures — Lecture 12                                       │
│  Priya Fernando · 1:04:11 · uploaded                     --text-muted│
│                                                                     │
│  This permanently removes the recording and its files from this     │
│  device. This can't be undone.                                      │
│                                                                     │
│  ┌─ message slot (pending / refused) ────────────────┐  40px        │  reserved unconditionally (S-06 §3.2)
│  └───────────────────────────────────────────────────┘              │
│                                                                     │
│                              [  Cancel  ]◄─24px─►[  Delete  ]  56    │
│                               default weight        danger-solid     │
└─────────────────────────────────────────────────────────────────────┘
                    scrim: color-mix(in srgb, var(--ink) 55%, transparent)
```

The body names what is destroyed and that it is irreversible. Because the recording
is already uploaded, this is the calm case — the institute copy survives; only the
device copy goes.

### 2.2 `confirm — not yet uploaded` — the stronger warning (RET-2, C-3)

```
│  Delete this recording?                                             │
│                                                                     │
│  Computer Networks — Lecture 9                                      │
│  Dr Silva · 0:48:17 · never uploaded                     --warning   │
│                                                                     │
│  ⚠ This recording was never uploaded, so this device holds the      │
│    only copy. Deleting it removes that copy permanently — the        │
│    system would never delete an un-uploaded recording on its own.    │
│                                                                     │
│  ┌─ message slot ────────────────────────────────────┐  40px        │
│                              [  Cancel  ]◄─24px─►[  Delete  ]  56    │
└─────────────────────────────────────────────────────────────────────┘
```

When `uploadState ≠ done`, the body escalates: it states that the device holds the
**only** copy and that RET-2 would never delete it automatically (C-3). The subtitle
tag reads `never uploaded` in `--warning`. The buttons are unchanged — the
escalation is in the words, not a new control (C-1, C-6).

### 2.3 `confirm` + in-flight upload (C-5)

```
│  This permanently removes the recording and its files from this     │
│  device. This can't be undone.                                      │
│                                                                     │
│  An upload in progress will be cancelled.                --text-muted│  U-10
```

If an upload is in flight, one extra line warns it will be cancelled (U-10). This
line composes with either §2.1 or §2.2's body.

### 2.4 `pending`, `refused`, `deleted`

```
pending (U-4):                              refused (403, U-6 — bug surface):
│  [  Cancel  ]     [  ◌ Deleting…  ]        │  message slot: "You don't have permission
│  both locked; ceiling resolveBySec         │  to delete recordings."
│                                            │  destructive button REPLACED by [ Close ]

deleted (done):
the dialog closes; S-21 removes the row (or S-22 routes back). No lingering toast
beyond the shell's own confirmation.
```

These are the shared §3.4 states, not new ones: `pending` locks both buttons and
shows U-4 on the destructive button; `refused` renders the named reason in the
reserved slot and **replaces** the destructive button with Close (never leaves it
live to re-tap); `done` closes the dialog and the opening surface reflects the
removal.

---

## 3. Component breakdown

```
apps/panel/src/screens/library/
  delete-recording-confirm.tsx   the DangerConfirm instance + the delete mutation
apps/panel/src/danger/           ← SHARED, defined by S-06 §3; NOT redefined here
  danger-confirm.tsx             the dialog shell + four states
  danger-button.tsx              quiet | solid
```

| Unit | What it does | How you use it | What it depends on |
|---|---|---|---|
| `delete-recording-confirm.tsx` | Supplies the title/body/label for **this** recording (choosing the §2.1 vs §2.2 body from `uploadState`, adding §2.3's line when an upload is in flight), owns the `deleteRecording` 202 and its resolution on `recording.artifact{deleted}`. **All this screen adds** | `open(<DeleteRecordingConfirm rec={…}/>, { dismissible:false })` | `DangerConfirm` (S-06 §3), `EduscopeClient.deleteRecording`, `recording` selector |
| `DangerConfirm` | The shared dialog: title, body, 40 px message slot, footer, the four §3.4 states, focus trap, scrim. **Inherited unchanged** | (as S-06 §3.2) | `useOverlays` |
| `DangerButton` | `quiet` (the S-21/S-22 entry control) \| `solid` (the confirm here). **Inherited unchanged** | `<DangerButton variant="solid">Delete</DangerButton>` | tokens |

`delete-recording-confirm.tsx` is the **entire** screen: everything else is the
shared danger folder. The one branch it owns — pick the body from `uploadState`, add
the in-flight line — is a pure function of the `Recording` and is tested without the
dialog (§12). Nothing here imports `fetch`/`axios`/`WebSocket` (frontend-conventions §1).

---

## 4. States

### 4.1 The four shared `DangerConfirm` states, filled in

| # | State | Entered by | Rendering | Governed by |
|---|---|---|---|---|
| 1 | `confirm` (uploaded) | admin opened Delete, `uploadState = done` | §2.1 — names target; calm irreversible body | S-06 §3.4, RA-06 |
| 1s | `confirm` (never uploaded) | `uploadState ≠ done`, aged or not | §2.2 — stronger body: only copy, RET-2 wouldn't auto-delete | C-3, RET-2 |
| 1u | `confirm` + in-flight upload | `uploadState ∈ {queued, uploading, completing}` | §2.3 line composed onto 1/1s | C-5, U-10 |
| 2 | `pending` (U-4) | Delete tapped | pending on the destructive button; both locked; ceiling `CommandAccepted.resolveBySec` | S-06 §3.4, SM-R-2 |
| 3 | `refused` | `403` (lecturer — bug surface, C-2) or `404`/`409` (deleted/changed while open) | named reason in the 40 px slot; destructive button **replaced** by Close | S-06 §3.4, U-5, U-6 |
| 4 | `deleted` (done) | `recording.artifact{deleted}` | dialog closes; opener (S-21 row / S-22) reflects removal; in-flight `upload.job{cancelled}` (U-10) | RA-06, U-10 |
| — | `U-2` reconnecting | `T-WS-STALE` while open | the destructive button is disabled (a delete tapped offline must never fire on reconnect); the dialog stays open, read-only | §0.3 U-2 |

There is **no** `confirm — not yet uploaded` as a *separate dialog*; it is the same
`confirm` state with an escalated body chosen from `uploadState` (C-1). The
inventory's "`confirm — not yet uploaded`" is state 1s here.

### 4.2 Diagram

```mermaid
stateDiagram-v2
    [*] --> confirm: admin opens Delete (uploaded → calm body)
    [*] --> confirmNeverUploaded: admin opens Delete (uploadState≠done → stronger body, C-3)
    confirm --> pending: Delete tapped (U-4)
    confirmNeverUploaded --> pending: Delete tapped
    pending --> deleted: recording.artifact{deleted} (RA-06); upload.job{cancelled} if in flight (U-10)
    pending --> refused: 403 / 409 (bug surface or changed underneath)
    refused --> [*]: Close (destructive button replaced, never re-tappable)
    deleted --> [*]: dialog closes; S-21 removes the row
    note right of confirmNeverUploaded
      RET-2: the system would NEVER auto-delete an
      un-uploaded recording. Deleting it removes the
      only copy. deletedBy/deleteReason are real
      columns (RA-06) — B-33's status string dies.
    end note
```

---

## 5. Copy deck

| Where | Copy |
|---|---|
| Title | `Delete this recording?` |
| Target line | `{title}` |
| Target meta | `{owner} · {duration} · {uploaded ? "uploaded" : "never uploaded"}` |
| Body — uploaded | `This permanently removes the recording and its files from this device. This can't be undone.` |
| Body — never uploaded | `This recording was never uploaded, so this device holds the only copy. Deleting it removes that copy permanently — the system would never delete an un-uploaded recording on its own.` |
| In-flight line | `An upload in progress will be cancelled.` |
| Cancel | `Cancel` |
| Destructive | `Delete` |
| Pending | `Deleting…` |
| Refused (lecturer) | `You don't have permission to delete recordings.` |
| Refused (changed) | `This recording is no longer available.` |
| Refused replacement button | `Close` |

Two notes:

- **The never-uploaded body names the RET-2 fact** — "the system would never delete
  an un-uploaded recording on its own" — so the admin understands they are overriding
  a safety rule, not performing a routine cleanup (C-3).
- **The uploaded/never-uploaded distinction is `uploadState`, not age.** A freshly
  recorded, not-yet-uploaded lecture gets the stronger warning too — the risk is
  "only copy", which is about upload, not about being 14 days old (C-3).

---

## 6. Token usage

**No new token.** Every value is inherited from S-06 §3 and the token sheet.

| Element | Tokens |
|---|---|
| Dialog shell | `--modal-w` (680), `--surface`, `--radius-xl`, `--sp-10` padding, `--shadow-lg` (S-06 §3.2) |
| Title | `--fs-2xl` / 800, `--text` |
| Target line | `--fs-md` / 700, `--text` |
| Target meta | `--fs-sm`, `--text-muted`; `never uploaded` tag `--warning` |
| Body | `--fs-base`, `--text-muted`, ~60ch measure (S-06 §3.2) |
| Never-uploaded body | same, with a leading ⚠ in `--warning` |
| In-flight line | `--fs-sm`, `--text-muted` |
| Message slot | reserved 40 px, `aria-live="polite"` (S-06 §3.2) |
| Cancel | default weight: `--surface`, 1 px `--border`, `--text`, 600 |
| Delete (`danger-solid`) | `--danger` fill, `#fff` label, `--radius-lg`, `--shadow-md`, 56 px (S-06 §3.1) |
| Footer gap | `--sp-10` (24, "danger separation", S-06 §3.2) |
| Scrim | `color-mix(in srgb, var(--ink) 55%, transparent)` (S-06 §3.2) |

The destructive button is `--danger`-filled per S-06 §3.1 — **not** `--record`.
(The inventory's S-24 note says "`--record` filled"; S-06 §3 supersedes that:
`--danger` is the destructive fill product-wide, split from `--record` precisely so
"recording" and "will destroy data" stop sharing a colour. This is the one place
S-24 corrects the inventory, and it does so by inheriting the settled vocabulary —
§9.1 records it.)

---

## 7. Touch, kiosk & accessibility

- **Destructive on the right, ≥ 24 px from Cancel** (screen-inventory §4, S-06 §3.2):
  the `--sp-10` footer gap; Delete is last in DOM order → rightmost → last in tab
  order.
- **Initial focus is Cancel, never Delete** (S-06 §3.3): a bench keyboard's stray
  Enter must not destroy anything. `role="alertdialog"`, `aria-labelledby` the title,
  `aria-describedby` the body, message slot `aria-live="polite"`.
- **`dismissible:false`** (S-06 §3.3): the kiosk has no Escape key; a stray palm on
  the scrim must not cancel, and must certainly not dismiss a dialog whose delete is
  already in flight. The only exits are Cancel, Delete, or the outcome.
- **No type-to-confirm** (C-6): one recording is a `DangerConfirm`, not a typed
  challenge (that is S-30's format).
- **Colour is never the sole carrier:** the never-uploaded escalation is the ⚠ + the
  sentence, not just the `--warning` tag; a colour-blind admin reads the risk in
  words.
- **U-6:** the Delete **entry** control (in S-21/S-22) is absent for lecturers, so
  this dialog is normally unreachable by them; a `403` arriving anyway renders
  `refused` with the destructive button replaced by Close — never a live retry (C-2).
- **`prefers-reduced-motion`:** the dialog's fade/scale is the shared overlay motion
  (S-06 §3); no information is carried by it (§8.6).

---

## 8. Contract changes this design requires

**None.**

`deleteRecording` (`DELETE /recordings/{recordingId}`, admin, 202-async) exists and
carries everything this screen needs; `Recording` supplies `title`,
`ownerDisplayName`, `durationMs`, `uploadState` for the confirm body; RA-06 already
records `deletedAt`/`deletedBy`/`deleteReason` as real columns and writes the
`AuditLogEntry`; U-10 already transitions an in-flight upload to `cancelled`; and the
resolving events (`recording.artifact{deleted}`, `upload.job{cancelled}`) already
exist. The destructive **vocabulary** is inherited from S-06 §3 (also no new
contract or token). This is the wave's clean "a design run can add nothing" case, in
the shape of the W-14 / W-15 gate.

### 8.1 A note the design *records* (not a contract change)

- The inventory's S-24 line says the destructive button is "`--record` filled"; the
  W-2 gate later split `--danger` from `--record` and made `--danger` the
  product-wide destructive fill (S-06 §3.1). S-24 follows the **later, settled**
  vocabulary (`--danger`), and this is recorded here (§6, §10 DEL-D-2) so the
  divergence from the inventory line is a decision, not a drift. **No token is
  added** — `--danger`/`--danger-soft` already ship (W-1/W-13).

### 8.2 Changes this design deliberately does **not** require

- **No `deleteReason` in the request.** For an admin manual delete, RA-06 sets
  `deleteReason = admin` server-side; the client does not choose a reason (the enum's
  other values, `retention`/`disk-pressure`, are the sweep's, not a person's).
- **No last-admin / self-delete guard here.** That is a *user*-deletion concern
  (CG-8, S-32), not a *recording*-deletion one; deleting a recording never bricks
  administration.
- **No soft-delete/undo affordance.** RA-06 removes the media; the `LectureSession`
  row survives for audit (C-4), but the media is gone. An undo would be a promise the
  storage model does not keep.

---

## 9. Decisions taken here

| Id | Decision | Rationale | Cost to reverse |
|---|---|---|---|
| **DEL-D-1** | **S-24 is a `DangerConfirm` instance and defines no destructive treatment of its own** | S-06 §3 settled the vocabulary product-wide precisely so S-24/S-30 inherit it; redefining any of it here is how two red buttons diverge (C-1, S-06 S06-D-3) | Low — it is one instance |
| **DEL-D-2** | **The destructive fill is `--danger`, following S-06 §3.1, not the inventory's `--record`** | The W-2 gate split `--danger` from `--record` so "recording" and "will destroy data" stop sharing a colour; S-24 follows the settled vocabulary. No token added (§8.1) | Low |
| **DEL-D-3** | **The never-uploaded case is an escalated *body*, not a separate dialog or a new control** | The risk (only copy, RET-2) is a matter of *words*, not of a stronger interaction; keeping one dialog with two bodies preserves the shared vocabulary (C-1, C-3) | Low |
| **DEL-D-4** | **An in-flight upload adds one warning line (U-10), it does not block the delete** | The admin may legitimately delete a recording mid-upload; the confirm's job is to make the `cancelled` consequence unsurprising, not to prevent it (C-5) | Low |
| **DEL-D-5** | **No type-to-confirm; a single recording is one `DangerConfirm`** | Type-to-confirm is reserved for S-30's whole-disk format; using it here would break the shared vocabulary and cry wolf (C-6) | Low |

---

## 10. Requirements this screen places on other screens

- **S-21 and S-22 own the Delete *entry* control** (`danger-quiet`, admin-only) and
  open this dialog through `useOverlays().open(…, {dismissible:false})`. They must
  not render the entry for lecturers (U-6); this dialog assumes the entry was
  admin-gated and treats a `403` as a bug surface (C-2).
- **S-21 reflects the removal** on `recording.artifact{deleted}` (its state
  `deleting`/`removed-under-user`); S-22 routes back to S-21 on the same event. This
  dialog owns the confirm and the command; the openers own the post-delete view.
- **S-35 will show the cancelled upload** if one was in flight (U-10); this dialog's
  in-flight warning (§2.3) is the heads-up that a `cancelled` row will appear there.
- **S-30 (format) inherits the same S-06 §3 vocabulary** and, unlike S-24, adds
  type-to-confirm for its whole-disk blast radius — the contrast this screen's C-6
  draws.

---

## 11. Testing floor

- **Testing Library:** one rendering test per §4 state — `confirm` (uploaded),
  `confirm` (never uploaded — asserts the stronger body and the RET-2 sentence),
  `confirm` + in-flight (asserts the cancel-warning line), `pending`, `refused`
  (lecturer `403` → Close replaces Delete; changed `409`), `deleted`, U-2.
- **The body branch is a pure-function test:** given a `Recording`, the chosen body
  (uploaded vs never-uploaded) and the presence of the in-flight line are asserted
  from `uploadState` alone, without rendering the dialog (§3).
- **The shared-vocabulary assertions** (inheriting S-06 §3's suite): initial focus is
  **Cancel**; the dialog is not `dismissible` (scrim tap and — on a bench keyboard —
  Escape do nothing); the destructive button is `--danger`-filled, rightmost, ≥ 24 px
  from Cancel; on `refused` the destructive button is replaced, never left live.
- **U-6:** a lecturer never sees the Delete entry (asserted in S-21/S-22 tests); a
  `403` here renders `refused`, not a normal delete.
- **U-2 does not fire on reconnect:** a Delete tapped while disconnected is rejected
  client-side and never replayed.
- **Playwright:** as admin, delete an uploaded recording from S-21 (row disappears);
  delete a never-uploaded recording and confirm the stronger warning renders; delete
  a recording mid-upload and confirm the upload shows `cancelled` on S-35 afterward.
- **Contract honesty:** the mocked `deleteRecording` (202) and the resolving
  `recording.artifact{deleted}` / `upload.job{cancelled}` validate against the
  `contracts/` zod schemas. **No new schema is exercised** — this screen adds none.
