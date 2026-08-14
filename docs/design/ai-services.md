# ai-services — Service Design (Phase-3, prompt 11)

> Phase-3 design artifact. Formalizes the proven `/scripts/python` prototypes
> (`live_lecture_start.py`, `live_slide_capture.py`, `slide_ocrnew.py`,
> `send_to_llm.py` — **evidence of the flow, not final code**) into three
> Python/FastAPI services on the device: **stt-service**, **slide-service**,
> **question-service**. Constrained by ADR-020 (A-02: on-device/LAN AI, no
> cloud; A-14: MCQ, 3–5 per batch, 10/15/20/30-min countdown default 20),
> ADR-014/ADR-015 (board + pipeline architecture), the QUESTION machines 2a–2d
> in [state-machines.md](state-machines.md), and the entity shapes in
> [domain-model.md](domain-model.md) §8.
>
> **Ownership rule (target-architecture §2.3, domain model):** these services
> **persist nothing**. core-api (module M8, [core-api.md](core-api.md) §10) is
> the single client, owns the countdown and all persistence
> (`TranscriptSegment`, `SlideCapture`, `QuestionSet`), and drives every
> machine transition. The services are stateless workers with bounded
> in-memory session buffers.
>
> Ends at a **STOP gate** (§8).

---

## 0. Topology & shared conventions

Three FastAPI services, separate systemd units, separate virtualenvs, all
bound to `127.0.0.1` (defense in depth: plus the shared internal bearer token
from the provisioning store — same pattern as pipeline-manager §3.1):

| Service | Port | Consumes | Produces |
|---|---|---|---|
| `stt-service` | 127.0.0.1:7101 | `/tmp/audio.sock` shm (decision §1.1) | rolling transcript segments (SSE) |
| `slide-service` | 127.0.0.1:7102 | snapshot PNGs from pipeline-manager's `snapshot` consumer | deduped slide captures + OCR text (SSE) |
| `question-service` | 127.0.0.1:7103 | transcript + slide text **in the request** | validated MCQ batches (sync HTTP response) |

Shared conventions (identical to pipeline-manager §3, so core-api has one
client shape for all device-internal services):

- **Commands are REST**; continuous outputs are an **SSE `GET /events`**
  stream (one JSON object per line). core-api subscribes once per service and
  re-reads `GET /status` on reconnect.
- Every service: `GET /healthz` (process liveness), `GET /status` (full
  snapshot incl. model/versions), structured stderr → journald; product-log
  entries via core-api's internal `POST /internal/logs` with
  `service="ai"` (subservice in context — core-api.md flag F-1).
- Ids crossing the boundary are ULIDs minted by core-api; offsets are
  **milliseconds relative to `LectureSession.startedAt`** (domain §8.1 —
  clock-drift safe).
- A dead or degraded AI service never affects recording or any panel function
  outside the AI studio (INV-TS-1, INV-QS-1, LP-18) — structurally true
  because nothing in the capture path depends on these processes.

Failure containment: each service is `Restart=on-failure` under systemd with
its own memory cap (`MemoryMax`, §5); a crash loses only the un-emitted tail
of its in-memory buffer (≤ one Vosk utterance / ≤ one slide).

---

## 1. stt-service (Vosk)

### 1.1 Audio source — decision: **shm tap on `/tmp/audio.sock`, not an ALSA tap**

The brief offers two options. Decision: **consume the pipeline-manager `audio`
publisher's shm socket** via a tiny GStreamer reader subprocess
(`shmsrc socket-path=/tmp/audio.sock ! audio/x-raw,S16LE,48000,2ch !
audioconvert ! audioresample ! audio/x-raw,S16LE,16000,1ch ! fdsink`), piping
16 kHz mono PCM into Vosk over a pipe.

Justification:

1. **Capture-once is an architecture invariant.** A-05/ADR-015: each physical
   input is captured exactly once by its publisher; consumers attach via shm.
   An ALSA tap is a second capture path on the same hardware — exactly the
   two-card workaround the prototype needed (`STT_ALSA_CARD = 6` vs "card 7 is
   GStreamer-only", and B-57's fragile device-name matching). One capture path
   means one place where device names, sample rates and mute live.
2. **Consistency with the recording.** Whatever the lecture file hears, STT
   hears — including `AudioControl` gain/mute applied at the source (INV-AC-1).
   An ALSA tap could diverge (different mixer route), producing transcripts of
   audio the recording doesn't contain or vice versa.
3. **Crash isolation is preserved.** shm `wait-for-connection=false` decoupling
   means an stt-service crash/restart never back-pressures the publisher or
   any consumer (the whole point of the shm design, pipeline-audit §4.1).
4. **No new contention.** ALSA devices are single-open in practice without
   dsnoop plumbing; shm rings are built for N readers. The 4 MB audio ring
   holds ~20 s — ample for an stt-service restart to reattach without loss
   beyond its own buffer.

Trade-off accepted: stt-service depends on the `audio` publisher being up. If
the publisher is down, the mic is *also* absent from the recording — the
right shared failure mode (HL-06 raises the critical alert; STT reports
`degraded{no-audio}` and produces nothing rather than silence-transcribing).
The GStreamer reader is spawned/supervised exactly like pipeline-manager
supervises children (argv list, `shell=False`, process group) — but it is a
*reader*, never a pipeline owner.

### 1.2 Engine & recognition loop

Carried from `live_lecture_start.py` (proven) with the prototype's two bug
lessons kept as design rules:

| Prototype element | Carried as | Note |
|---|---|---|
| Vosk `Model` + `KaldiRecognizer`, `SetWords(false)` | same; model loaded once at service start | model load ~10–20 s — service starts at boot, not per lecture |
| Bounded audio queue, drop-oldest (`maxsize=600`) | bounded ring between reader pipe and recognizer thread | the prototype's unbounded-queue OOM (~2 h) must not recur |
| LLM calls off the audio thread | **structural**: stt-service never calls the LLM at all (question-service does) | the prototype's biggest fix, made architectural |
| `MIN_WORDS_PER_SEGMENT = 3` | same default, config | drops "uh" noise segments |
| Heartbeat file | replaced by SSE liveness + `GET /healthz` | no file-based IPC |
| `s`/`e` stdin keys (via `eduscope_web.py sends_keys`) | replaced by the REST session lifecycle (§1.4) | pipeline-manager §6.2 dropped `sends_keys` for this reason |
| 44.1 kHz capture + numpy resample | dropped — the shm reader delivers 16 kHz mono via `audioresample` | element-quality resample, no numpy in the hot path |

Recognition thread: read 100 ms PCM blocks from the ring; `AcceptWaveform`
finalizes an utterance → a **transcript segment**.

### 1.3 Timestamps & pause handling

Offsets are computed from **sample count**, not wall clock: the service tracks
`samplesConsumed` since the current *capture span* began, and each span is
anchored to a wall offset supplied by core-api.

- `POST /sessions` supplies `anchorOffsetMs = 0` at start (R-05).
- On pause (R-08) core-api calls `pause`; the reader detaches (mic keeps
  publishing; we just stop consuming — nothing is transcribed from a paused
  lecture, matching Q-07's "no new transcript while paused").
- On resume (R-05 after R-10) core-api calls `resume` with a fresh
  `anchorOffsetMs = recordedDurationMs at resume` — **rebasing** the sample
  clock so offsets stay aligned with the recording timeline the panel and
  question windows use.
- Segment offsets: `startOffsetMs = anchor + floor(startSample/16)`,
  `endOffsetMs = anchor + floor(endSample/16)` (16 samples/ms at 16 kHz).

Vosk word-level timing is not needed (utterance bounds suffice for the
`inputWindow` math in machine 2b); `confidence` is emitted when Vosk provides
it, else null.

### 1.4 HTTP contract (core-api = the only client)

| Method / path | Body → Result | Notes |
|---|---|---|
| `POST /sessions` | `{sessionId, anchorOffsetMs:0}` → `202 {state:"listening"}` | one active session max; a second `sessionId` answers `409 session_active` (mirrors INV-LS-1) |
| `POST /sessions/{sessionId}/pause` | — → 202 | idempotent |
| `POST /sessions/{sessionId}/resume` | `{anchorOffsetMs}` → 202 | rebases the sample clock (§1.3) |
| `DELETE /sessions/{sessionId}` | → 202; flushes the final partial utterance as a last segment | R-11/R-14 |
| `GET /status` | → `{state: idle\|listening\|paused\|degraded, sessionId, model, modelVersion, samplesConsumed, lastSegmentAt, audioSource:{attached, fps}}` | resync target after SSE reconnect |
| `GET /events` (SSE) | stream of `evt.stt.segment` and `evt.stt.state` | below |
| `GET /healthz` | 200 while the recognizer thread and reader child are alive | systemd + core-api probes |

`evt.stt.segment` payload (consumed by core-api → persisted as
`TranscriptSegment`, append-only INV-TS-2):

```jsonc
{ "event": "evt.stt.segment",
  "payload": { "sessionId": "01J…", "startOffsetMs": 123400, "endOffsetMs": 129800,
               "text": "so the second law tells us …", "confidence": 0.87,
               "engine": "vosk", "modelVersion": "vosk-model-en-us-0.22" } }
```

`evt.stt.state`: `{state, reason}` — e.g. `degraded{no-audio}` when the shm
reader has delivered no samples for 10 s (the mic is offline — machine 5a will
already be critical), back to `listening` on recovery.

### 1.5 Resources

- Model: **vosk-model-en-us-0.22** (the prototype's choice) — ≈ 1.8 GB on
  disk, **≈ 3.5 GB resident** with the recognizer. Fallback if the Phase-4
  bench shows pressure: `vosk-model-small-en-us-0.15` (≈ 40 MB disk,
  ≈ 300 MB resident, lower accuracy) as a provisioning-selectable option.
- CPU: pinned per the proven policy `taskset -c 4-7` (A76 cluster) —
  pipeline-manager §4.3 carries the pinning *policy*; this service is the
  process it applies to. Steady-state ≈ 0.5–1 A76 core at 16 kHz mono.
- systemd `MemoryMax=5G` (headroom over the resident model), `Nice=5` (the
  pipelines outrank STT).

---

## 2. slide-service (snapshot consumer + Tesseract + dedupe)

### 2.1 Input: the pipeline-manager `snapshot` consumer

core-api starts pipeline-manager's snapshot consumer at R-05 when
`G-AI-ENABLED` (`POST /consumers/snapshot/start {intervalSec:1, outputPath}` —
pipeline-manager §3.2), with
`outputPath = /run/eduscope/slides/<sessionId>/current.png` (tmpfs — 1 fps PNG
writes never touch the recordings disk until a slide is *kept*). The consumer
overwrites `current.png` atomically (write-to-temp + rename — a builder detail
noted for prompt-10 review). slide-service watches that file. No ALSA/V4L2
access, no GStreamer here — the manager owns all capture (A-05).

### 2.2 Dedupe + OCR pipeline (formalizing `live_slide_capture.py` + `slide_ocrnew.py`)

| Prototype element | Carried as | Note |
|---|---|---|
| 1 s poll of `current.png` | inotify watch with 1 s debounce (poll fallback) | event-driven, same cadence |
| `imagehash.phash` on 1280×720, threshold **10** | same, config `PHASH_THRESHOLD=10` | proven slide-vs-animation discriminator |
| candidate-vs-final two-stage (animation frames replace the candidate; a distinct frame finalizes the previous) | same state machine, in-memory | keeps the *last* frame of an animated slide — the fullest build |
| `.tmp` candidate dir so OCR never sees candidates | **structural**: OCR runs on finalize, in-process — no directory hand-off at all | the junk `frame_xxxxx.txt` bug class is gone |
| `slide_ocrnew.py` polling directory watcher | deleted — OCR is called on finalize | one service, no cross-directory coupling |
| Tesseract `--oem 1 --psm 6`, `lang=eng`, whitespace normalize | same (`pytesseract`), config | proven settings |

On finalize: copy the kept PNG to
`<recordings-volume>/sessions/<sessionId>/slides/slide-NNN.png` (path prefix
given by core-api at session start — the service derives nothing, B-02/SEG-7
spirit), run Tesseract (in a worker thread; ~0.5–2 s per slide is fine at
slide cadence), emit the event. `isSlideChange` is true for every finalized
slide except a re-emit of an unchanged first frame; `dedupeHash` is the phash
hex. Retention of these images follows the parent recording (DM-16/DM-P1 — a
PM ruling is still open; the *path layout* above makes delete-with-recording
trivial either way).

### 2.3 HTTP contract

| Method / path | Body → Result | Notes |
|---|---|---|
| `POST /sessions` | `{sessionId, imageDir, sourcePath}` → 202 | `sourcePath` = the snapshot consumer's output; `imageDir` = durable slide home |
| `DELETE /sessions/{sessionId}` | → 202; finalizes the pending candidate | R-11 |
| `GET /status` | `{state, sessionId, slideCount, lastCaptureAt, ocrBacklog}` | |
| `GET /events` (SSE) | `evt.slide.captured` | below |
| `GET /healthz` | | |

`evt.slide.captured` payload (core-api persists as `SlideCapture`):

```jsonc
{ "event": "evt.slide.captured",
  "payload": { "sessionId": "01J…", "capturedAt": "2026-08-14T09:12:03+00:00",
               "offsetMs": 732000, "imagePath": ".../slide-014.png",
               "ocrText": "Second Law of Thermodynamics …",
               "dedupeHash": "c3a1f0…", "isSlideChange": true } }
```

Pause: slides keep being captured while paused? **No** — core-api stops/starts
the snapshot consumer with the session (the projector may show anything during
a pause; capturing it would feed the question window corridor content — same
reasoning as SM-Q-3). No pause route needed: the manager's consumer stop is
the pause.

### 2.4 Resources

Negligible: phash on a 1280×720 downscale ≈ 10 ms/s; Tesseract bursts
100–200 MB RSS transient per slide. `MemoryMax=1G`, no core pinning (A55
cluster is fine — `taskset -c 0-3`).

---

## 3. question-service (prompt → llama.cpp → validated MCQs)

### 3.1 Role & flow

Stateless request/response: core-api (machine 2b executor) sends the material;
question-service prompts the **LAN llama.cpp** `/completion` endpoint
(ADR-020 — the LLM runs on a LAN server, not on the board;
`DeviceProvisioning.llmEndpoint`), parses/repairs/validates, and returns
structured MCQs. It holds no transcript, no session state, no queue — retries
and degradation policy belong to machine 2b/2a in core-api (Q-13/Q-14/Q-05).

### 3.2 Prompt templates — versioned in-repo

`services/ai/question-service/prompts/` is the single home:

```
prompts/
  mcq/
    v1/
      system.md        # role + hard rules (MCQ only, 2–4 options, exactly one correct)
      user.md.j2       # jinja2: transcript window, slide texts, count, difficulty hints
      grammar.gbnf     # llama.cpp GBNF grammar constraining output to the JSON schema
      schema.json      # the output JSON schema (mirrors zod QuestionCreate shape)
  CHANGELOG.md
```

- A template set is immutable once shipped; changes create `v2/`. The version
  string (`mcq/v1`) is returned in every response and persisted by core-api as
  `QuestionSet.promptVersion` (provenance, domain §8.3) — an answered question
  can always be traced to the exact prompt that produced it.
- The prompt asks for **3–5 MCQs as a JSON array** of
  `{prompt, options:[{text, isCorrect}]}` — deliberately the same shape as the
  contract's `QuestionCreate`, so core-api mints option ULIDs and
  `correctOptionId` **as ids** itself (INV-G-2, INV-Q-2/DM-7); the LLM never
  sees or produces ids.

### 3.3 llama.cpp call & structured-output parsing with repair

Request to `{llmEndpoint}/completion`:
`{prompt, n_predict: 1200, temperature: 0.3, grammar: <grammar.gbnf>, cache_prompt: true}`
— temperature 0.3 carried from the prototype; the **GBNF grammar is the
primary structural guarantee** (llama.cpp constrains generation to valid JSON
matching the schema), with parsing as defense in depth:

1. **Extract**: take `response.content`; strip whitespace/fences; locate the
   first balanced `[...]` block (grammar makes this trivially the whole
   output; the extractor exists for non-grammar-capable servers).
2. **Parse + validate** (pydantic against `schema.json`): 3–5 items; each
   2–4 options; exactly one `isCorrect`; prompt/option text length caps
   (512); reject near-duplicate options (case-folded equality).
3. **Item-level salvage**: invalid items are dropped, valid ones kept —
   matching Q-12's "drop invalid items; persist survivors".
4. **Repair pass** (max 1, internal): if **zero** items survive but the model
   returned *something*, re-prompt once with the validation errors appended
   ("Your previous output failed validation because … Return only corrected
   JSON."). This is invisible to core-api and fits inside the request budget.
5. Outcome: `200` with survivors, or a typed error (§3.4).

### 3.4 HTTP contract (sync — the response IS `evt.ai.generation.*`)

| Method / path | Body → Result |
|---|---|
| `POST /generate` | request/response below; server-side hard deadline 40 s |
| `GET /probe` | probes `{llmEndpoint}/health` (fallback: 1-token completion) → `{reachable, latencyMs, model?}` — the `T-LLM-PROBE` target for Q-06 |
| `GET /status` | `{promptVersions: ["mcq/v1"], llmEndpoint, lastGenerationAt, lastError}` |
| `GET /healthz` | — |

Request:

```jsonc
{ "sessionId": "01J…", "questionSetId": "01J…",
  "count": { "min": 3, "max": 5 },                       // A-14
  "transcript": { "fromOffsetMs": 1200000, "toOffsetMs": 2400000,
                  "text": "…the transcript window…" },   // core-api selects the window (machine 2b Q-11)
  "slides": [ { "offsetMs": 1310000, "ocrText": "…" } ], // texts only; images never cross
  "promptVersion": "mcq/v1",                             // optional pin; default = latest
  "llmEndpoint": "http://…:5000" }                       // from DeviceProvisioning, per request (INV-DP-3)
```

Response `200`:

```jsonc
{ "questionSetId": "01J…", "promptVersion": "mcq/v1", "modelId": "<from llama.cpp /props when available>",
  "requested": 5, "returned": 4, "droppedInvalid": 1,
  "questions": [ { "prompt": "…", "options": [ { "text": "…", "isCorrect": false },
                                               { "text": "…", "isCorrect": true } ] } ] }
```

Typed errors (HTTP + `code` — core-api maps them onto Q-13's classification):

| HTTP | code | Maps to (machine 2b/2a) |
|---|---|---|
| 503 | `llm.unreachable` (connect refused/DNS, ≤ 5 s connect timeout) | Q-13 `unreachable` → after retries Q-05 `degraded` |
| 504 | `llm.timeout` (deadline hit) | Q-13 `timeout` |
| 422 | `llm.invalid-payload` (zero valid items after repair) | Q-13 `invalid-payload` → Q-14 one automatic regeneration |
| 400 | `bad-request` (caller error) | surfaces as a bug, not a machine state |

**Timeout/retry split (explicit):** question-service enforces one internal
40 s deadline and one repair re-prompt. core-api owns `T-LLM-REQUEST` (45 s),
the 2 automatic retries at `T-LLM-RETRY` (10 s/30 s, Q-14), the transition to
`degraded` (Q-05), and the `T-LLM-PROBE` (60 s) recovery loop (Q-06) — the
budgets nest (40 < 45) so a hung LLM can never wedge the machine timer.

### 3.5 LLM server requirements (LAN box — not the board)

| Requirement | Value | Why |
|---|---|---|
| API | llama.cpp server `/completion` with `grammar` support (b2xxx+) | §3.3 structural JSON |
| Model class | 7–8B instruct, Q4_K_M (≈ 5–6 GB RAM/VRAM) or better | MCQ quality floor; quality tuning is an ADR-020-acknowledged task |
| Context | ≥ 8k tokens | 20-min transcript window (~2.5–3.5k tokens) + slides + prompt + output |
| Throughput | ≥ 15 tok/s sustained | ~1.2k output tokens inside the 40 s deadline with margin |
| Concurrency | 1 (device-serial by construction — one generation per device at a time; N devices ⇒ queue or scale the LAN box) | machine 2b is serial per session |

### 3.6 Degradation behavior when the LLM is unreachable

- question-service fails **fast and typed** (§3.4); it never queues or retries
  on its own — so core-api's countdown state is always honest.
- Machine 2a goes `degraded` (Q-05): countdown **held**, studio shows the
  retry state (J-2), `system.alert{ai.unavailable}` raised once (re-evaluated
  per `T-ALERT-REEVALUATE`), recording and every other function untouched
  (INV-QS-1, LP-18).
- **STT and slide capture keep running** while degraded — the transcript and
  slide record keep accumulating, so the first successful generation after
  recovery covers the gap (its `inputWindow` spans from the last *successful*
  set's `toOffsetMs`, machine 2b Q-11 — no material is lost, only delayed).
- Recovery: `GET /probe` succeeding flips 2a back to `armed` (Q-06), resuming
  the held `remainingMs`.
- Provisioned-off (`llmEndpoint = null` / `aiQuizEnabled = false`): core-api
  never starts any AI session; the services idle at `state=idle` (INT-10,
  INV-DP-4).

---

## 4. What formalizes from `/scripts/python` — disposition table

| Prototype | Element | Disposition |
|---|---|---|
| `live_lecture_start.py` | Vosk model/recognizer settings, bounded queue, min-words filter, off-thread LLM lesson | **KEEP** → stt-service §1.2 |
| | ALSA card selection (`STT_ALSA_CARD=6`, device-name match) | **DROP** → shm tap decision §1.1 |
| | 4/15-min summary cadence + summary prompts | **DROP** — summaries are not a product feature; the cadence lives in machine 2a (10/15/20/30, default 20 — INT-11), the prompt in question-service `prompts/` |
| | silence-based lecture auto-end | **DROP** — session lifecycle is machine 1a's, never inferred from audio |
| | heartbeat file, stdin `s`/`e` keys | **DROP** → REST lifecycle + `/healthz` |
| `live_slide_capture.py` | phash dedupe (threshold 10), candidate/finalize animation handling | **KEEP** → §2.2 |
| | keyboard session control, self-made session dirs | **DROP** → REST lifecycle; paths given by core-api |
| `slide_ocrnew.py` | Tesseract `--oem 1 --psm 6` + normalize | **KEEP** → §2.2 |
| | newest-directory polling watcher, per-file `.txt` outputs | **DROP** — OCR on finalize, output in the event/DB |
| `send_to_llm.py` | `/completion` payload shape, temperature 0.3 | **KEEP** → §3.3 |
| | hardcoded LLM URL, file-based I/O | **DROP** → `llmEndpoint` per request, JSON contract |

---

## 5. Board resource budget (Radxa ROCK 5 ITX+, 24 GB — vs pipeline-manager §4)

| Component | RAM (resident) | CPU | Placement |
|---|---|---|---|
| stt-service (Vosk 0.22) | ≈ 3.5 GB (cap 5 GB) | 0.5–1 core sustained | A76 cores 4–7 (proven pinning) |
| slide-service | ≤ 200 MB steady, 1 GB cap | bursts ≤ 0.5 core on OCR | A55 cores 0–3 |
| question-service | ≤ 150 MB | negligible (HTTP client) | A55 |
| **Total AI on board** | **≈ 4 GB of 24 GB** | fits inside pipeline-manager §4.3's "keep A55 headroom + Vosk on A76" policy | |

The LLM consumes **zero board resources** (LAN server, §3.5). Pipeline
worst case (2 encodes + decodes + kiosk browser) plus this budget leaves
> 15 GB headroom — RAM is not the constraint (pipeline-manager §4.2 agrees);
the shared A76 budget between Vosk and CPU compositing is **bench item B-T3's
scope extended**: re-run the pipeline worst case with STT active
(**new bench item AI-T1**, owner: pipeline engineer).

---

## 6. Failure matrix

| Failure | Detection | Effect | Recovery |
|---|---|---|---|
| LLM unreachable / timeout | §3.4 typed errors | 2a `degraded`, countdown held, alert; STT/slides continue | `GET /probe` loop (Q-06) |
| LLM returns garbage | zero-survivor validation after repair | Q-13 `invalid-payload`, one auto regeneration (Q-14), then visible failed set with retry (J-2) | manual `generateNow` |
| stt-service crash | systemd restart + SSE drop seen by core-api | ≤ one utterance lost; transcript gap; recording untouched (INV-TS-1) | auto-restart, core-api re-`POST /sessions` on `GET /status` mismatch |
| Mic offline | `evt.stt.state{degraded,no-audio}` (machine 5a is already critical) | no segments produced — never fabricated silence text | publisher recovery (HL-07) |
| slide-service crash | systemd restart | ≤ one slide lost; snapshot consumer unaffected (it just writes current.png) | restart + re-`POST /sessions` |
| Snapshot consumer down | slide-service sees a stale `current.png` (mtime) → `evt.slide.state{degraded}` | no captures | core-api restarts the consumer (pipeline-manager `aux` restart class) |
| Tesseract error on a frame | per-slide try/except | slide kept with `ocrText:null` — image evidence survives | next slide unaffected |
| core-api restart | services keep sessions in memory; core-api reconciles via `GET /status` on boot (adopt or stop+restart the session) | bounded duplicate-segment risk handled by core-api idempotent insert (same sessionId+offsets) | BR-pass extension |

---

## 7. Traceability

- **A-02 / ADR-020**: on-device Vosk (§1) + Tesseract (§2), LAN llama.cpp
  (§3), no cloud — no external endpoint appears anywhere in this design.
- **A-14 / INT-11**: batch 3–5 (§3.4 request `count`), countdown vocabulary
  and default 20 live in core-api machine 2a; this doc holds no cadence state.
- **Machine 2b Q-11/Q-12/Q-13/Q-14**: request shape (§3.4), item salvage
  (§3.3), typed error classification (§3.4).
- **Machine 2a Q-05/Q-06**: degradation + probe (§3.6).
- **Domain §8.1/§8.2**: segment/capture payloads mirror the entity fields;
  services persist nothing.
- **INV-G-7**: no stored value without a consumer — the services keep no
  files except the slide PNGs core-api told them to keep.
- **B-63-class**: no shell strings anywhere; the one child process (shm
  reader) is argv-spawned.

---

## 8. Open questions & STOP gate

Defaults taken (cheap to change now):

1. **STT feeds from shm, not ALSA** (§1.1) — confirm with the pipeline
   engineer that a second shmsrc reader on the 4 MB audio ring is in the
   proven envelope (expected yes; publishers are `wait-for-connection=false`
   multi-reader by design). Bench: reader attach/detach under recording.
2. **Vosk large model (0.22) by default**, small model as provisioning
   fallback — accuracy vs 3.5 GB resident. Bench AI-T1 (§5) decides.
3. **GBNF grammar on by default** — requires a llama.cpp build with grammar
   support on the LAN box; if the deployed server predates it, the extractor
   +repair path (§3.3) carries alone. Confirm the LAN server build with IT.
4. **Slide capture stops during pause** (§2.3) — mirrors SM-Q-3's reasoning;
   PM may prefer capture-through-pause. One-line change either way.
5. **Transcript/slide retention** follows the recording (DM-16) — **DM-P1 is
   still an open PM ruling**; the path layout makes either answer cheap.

> **STOP — Phase-3 gate.** Review by the architect and the pipeline engineer
> (the shm-tap decision §1.1 and bench AI-T1 touch their budget), alongside
> [core-api.md](core-api.md) §10 (the consuming module). Focus: the audio
> source decision, the three HTTP contracts (§1.4, §2.3, §3.4), the
> prompt-versioning scheme (§3.2), and the degradation matrix (§6).
