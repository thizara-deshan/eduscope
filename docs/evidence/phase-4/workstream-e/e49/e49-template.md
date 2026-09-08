# E-49 projector overlay acceptance — TEMPLATE

> Filled by `node scripts/bench/e49-projector-acceptance.mjs`. The dated
> `<timestamp>.md` / `<timestamp>.json` siblings are the real evidence; this
> template is the shape only and is never itself a witness.

- Result: PASS | PASS with deferred physical HDMI capture | FAIL — <one line>
- At: <ISO-8601 UTC>
- Pipeline-manager (A): real FastAPI process, GStreamer worker faked (no HDMI/X)
- Question payload parity (B → A `QuestionOverlay`): <pass|fail>
- Options rendered: <2|3|4>
- Join code on card: <code>
- QR decodes to join URL: <pass|fail> (`<joinUrl>`)
- No QR / card before the first publication (QO-1 exclusion): <pass|fail>
- Forbidden privacy fields rejected (leaderboard/participantCount/score/studentId): <count>/4 → 422
- Projector display child restart (new PGID, no rebuild): <pass|fail>
- Physical HDMI #1 slides↔question capture: DEFERRED to Workstream F device bring-up (no HDMI receiver in CI/board-headless)
- A+B+D integration witness: `services/core-api/test/integration/projector-real-stack.test.ts`
- Evidence JSON: `<timestamp>.json`

The evidence contains no question text, QR image, credential, participant PII,
or media frame — only pass/fail flags, counts, PGIDs, and the public join URL.
