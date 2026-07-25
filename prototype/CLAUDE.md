# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Unistream is a **frontend-only prototype** of a lecturer recording system's tablet UI. It targets a 13-inch touch panel in **landscape at 1280×800**, mounted to a rack device. There is **no backend** — all data, recording, streaming, and AI question generation are mocked. The goal is validating UI/UX (intuitive enough for older, non-technical lecturers), not shipping working capture. Keep changes mock-only unless explicitly asked otherwise.

For hosting/sharing, the app renders inside a **presentation stage** (`Stage` in `App.tsx`): a `.us-panel` capped at **max 1280×800**, flex-centered on a grey backdrop with a "13-inch in-room touch panel · 1280 × 800" caption. On smaller windows the panel **shrinks fluidly** (`width/height: 100%` + max constraints, pure CSS — internals reflow, no scrollbars); it never grows past 1280×800. `.us-panel` is the positioning context for every full-screen overlay — the recording frame, notch, `Drawer`, and `Modal` are all `position: absolute` so they hug the panel, **not** the browser viewport. Never use `position: fixed` for overlays.

The current UI is a **negotiated merge of two designs** (the PM's visual language in `examples/` + the original interaction model): don't "simplify" it back toward either one. Reference screenshots live in `examples/` (`example-1..3.png` for the dashboard, `examples/advance/` for the admin section).

## Commands

Vite 8 requires **Node 20+**, but the default `node` here is v18. Use nvm first:

```bash
nvm use 20        # 20.20.2 is installed via nvm; v18 will crash vite
npm run dev       # dev server at http://localhost:5173
npm run build     # tsc -b (type-check) && vite build
npm run lint      # eslint . — CI-strict, must pass clean
```

There is no test suite. Verify UI changes by driving the running dev server in a headless browser (system Chrome is at `/usr/bin/google-chrome-stable`; `puppeteer-core` is available in `node_modules`) and screenshotting the flows at 1280×800.

## Architecture

Single-page app, no router. `App.tsx` nests two context providers **in this required order** (inner consumers depend on outer state):

```
RecordingProvider → QuestionProvider → AppShell
```

- **`context/RecordingContext.tsx`** — the session's source of truth: status (`idle | recording | paused`), elapsed timer, the three output channels, and the mics (including `setAllMuted` for the Room Controls master switch). The elapsed timer ticks only while `status === 'recording'`.
- **`context/QuestionContext.tsx`** — the AI question assistant state. **Consumes `useRecording()`**, so it must be nested inside `RecordingProvider`. Owns the generation interval, countdown, current batch, sent-to-projector list, and live leaderboard responses.

State transitions that must stay consistent across the two contexts (e.g. resetting the countdown when a fresh recording starts) are handled in `QuestionContext` by **adjusting state during render with a `prevStatus` guard**, not in a `useEffect` — this is deliberate: the eslint config forbids synchronous `setState` inside effects (`react-hooks/set-state-in-effect`). Follow that pattern rather than reintroducing effects. Animated mock signals (mic meters, staggered leaderboard responses) run `setState` inside interval/timeout **callbacks**, which is fine.

### Views & screen flow

`AppShell` switches between views (plain state, no router):

- **Login** (`LoginPage`): simulated sign-in — username/password are decorative, only the **role picker** matters (Lecturer / Administrator). Logout (header) stops any running recording and returns here.
- **Dashboard, idle** (`examples/example-1.png`): `IdleHero` — time-based greeting + signed-in user's name + one dark **Start Recording** pill. The two bottom bars are present but collapsed.
- **Dashboard, recording**: red 4px `us-recframe` border + a top-center `us-recnotch`. Main = slim dark **Eduscope AI Studio** card (`ai/QuestionAssistant.tsx`) + a **430px right column**: `TimerCard`, one **Live Meeting** `ChannelCard`, then the **`ai/InsightsPanel`** dark card filling the rest. There is **no** Live Streaming card and no Local Capture card on the dashboard.
- **Live Meeting layout** is an **inline accordion** inside `ChannelCard` (no drawer — the old `SetupDrawer`/`ChannelSection` are deleted). Toggling the switch ON (or the "Layouts" button) expands "MEETING VIEW LAYOUT" (the meeting's **three** camera presets, active = grey bg + dark border). Because the accordion and the insight tabs share the same vertical space, `AppShell` lifts `meetingLayoutsOpen`: when true the `us-insightswrap` **shrinks to just its tab header** (`us-insightswrap--collapsed`, smooth `max-height`/opacity transitions) rather than disappearing — the tabs stay visible and tappable. Only one is fully open at a time.
- **Bottom bars** (both views): `sources/SourcesPanel` and `room/RoomControlsPanel` (Projector / Audio / Environment groups). Room Controls hosts the **Advanced** button, shown to **all roles**.
- **Advanced view** (`examples/advance/*.png`): `admin/AdminPage` (role-scoped). **Admins** see all System Administration categories; **lecturers** see only their output layouts — **Local Capture Layout** (`admin/pages/LocalCaptureLayout.tsx`, always-on `local` channel preset) and **Streaming Configuration** (`admin/pages/StreamingConfig.tsx`, Live Streaming on/off + preset + keys). Local Capture Layout is reachable by **both** roles (`USER_CATEGORIES` in `AdminPage`).

### The AI question flow (the priority feature)

- The AI Studio card shows a split default view (`ai/CountdownToNext.tsx` exports `GenerateControls`): "Generate questions every [N]" (interval 10/15/20/30, default 15) on one side, "Generate Questions Now" on the other. When a batch exists a green **"A new set is ready"** banner appears with **Review Questions**. Questions themselves live only in **`ai/QuestionsModal.tsx`** (opened by Generate Now or Review) — regenerate, pick a question, **Send to Projector**, or **Add Question** (`ai/AddQuestionDialog.tsx`). The old inline accordion/tabs are gone.
- The right-column **`ai/InsightsPanel`** has two tabs: **Previous Questions** (`ai/SentToProjectorPanel.tsx` — each sent question with timestamp, green correct answer, and clickable Responses/Correct/Incorrect badges → `ai/NamesDialog.tsx`) and **Leaderboard** (`ai/LeaderboardPanel.tsx` — simple ranked medals + `{correct}/{answered} correct` + score `correct*10`; a row opens `ai/StudentDetailDialog.tsx`). Both derive from `sent` + `responsesByQuestion` + `CLASS_ROSTER` (`mock/students.ts`, `getStudent`); no new context state. Right column **starts empty** and fills as questions are sent.
- **`generateNow()` is the key requirement**: the lecturer can pull questions early, which generates immediately *and resets the countdown to the full interval*. Preserve this in any refactor.
- **`COUNTDOWN_SPEED`** (top of `QuestionContext.tsx`) is a prototype-only accelerant so reviewers can watch auto-generation without waiting. Set to `1` for true real-time.
- Batches are 3–5 mock MCQs from `mock/questions.ts`, shown as a single-column accordion (`ai/QuestionCard.tsx`, **all collapsed by default**). Lecturers edit inline, then **Send to Projector** moves the question into the `sent` list where exactly one is "now showing".
- Lecturers can also **write their own questions**: the floating "Add Question" button (bottom-right of the assistant, Generated tab) opens `ai/AddQuestionDialog.tsx` (prompt, 2–4 choices, tap-a-letter correct answer). Saved questions get `custom: true` and a "Yours" chip, and **survive auto-generation batches and session resets** (`QuestionContext` filters on `custom` instead of clearing) — preserve that when touching batch logic. `Modal` portals into `.us-panel`, so dialogs opened from the dark assistant scope still render light and panel-wide.
- The section's on-screen title is **"Eduscope AI central"** (component is still `QuestionAssistant`).
- Sending also triggers the **live mock leaderboard**: `sendToProjector` staggers `simulateResponses()` (`mock/students.ts`) into `responsesByQuestion` via `setTimeout` callbacks. The assistant's three tabs — Generated / Sent / Leaderboard — replace the PM's separate right-side panels; don't reintroduce those.

### Output channels & layout presets

`RecordingContext` holds three `OutputChannel`s (`mock/session.ts`): `local` (`alwaysOn: true`), `meeting`, `streaming`. Each independently picks one layout preset, rendered as mock feeds (presenter silhouette / faux slide) by `outputs/LayoutPreview.tsx`.

**The channels deliberately offer different layout sets** — `CHANNEL_LAYOUTS` in `mock/session.ts` is the single source of truth, with `layoutsFor(channelId)` / `presetName(id)` helpers. Never render the full `LAYOUT_PRESETS` list for a channel:

| Channel | Layouts |
| --- | --- |
| `local` | `fifty-fifty`, `side-by-side`, `cam-1`, `cam-2`, **`separate-files`** (PC and CAM 1 saved as two files) |
| `meeting` | **`cams-fifty-fifty`** (CAM 1 + CAM 2, default), `cam-1`, `cam-2` — camera-only, since online students already get the slides shared from the PC |
| `streaming` | `fifty-fifty`, `side-by-side`, `cam-1`, `cam-2`, **`pc-only`** |

`outputs/LayoutPresetPicker.tsx` takes a `channelId` and scopes itself accordingly; it's used by the two Advanced pages. The meeting's inline accordion (`ChannelCard`) maps the same list through a local `LAYOUT_ICONS` record. Keep layout controls off the main screen apart from that accordion.

There is **one microphone** — the Lecturer Mic (`INITIAL_MICS`, `MicState['id'] === 'lecture'`). The old room mic is gone; the Room Controls audio row toggles this single mic via `setAllMuted`.

### Styling

Two stylesheets, no CSS-in-JS and minimal Tailwind utility usage despite Tailwind v4 being installed:

- **`index.css`** — design tokens as CSS custom properties. **Fixed light scheme** (PM palette): light grey `--bg`, white `--surface` cards, plus `--ink*` tokens for the dark header and dark AI card. There is no dark mode / theme toggle anymore.
- **`styles/app.css`** — all component styles, hand-written semantic classes namespaced `us-*` (BEM-ish). The AI assistant's dark look is achieved by **re-declaring the surface/text token values inside `.us-assistant`** so every nested `us-*` component adapts automatically — style new assistant children with the same tokens and they inherit the dark scope for free.

Use the `cn()` helper (`components/ui/cn.ts`). Icons are from `lucide-react`. Reusable primitives: `components/ui/` (`Toggle`, `Drawer`, `Modal`). The header uses only `public/eduscopeLogoDark.jpeg` (the bar is always dark).

## Conventions

- Keep it mock-only; new "features" mean new mock data/functions (`mock/`), not real integrations.
- Accessibility for the target users is a first-class requirement: large touch targets (≥44px), high contrast, `aria-label`s on icon-only buttons. The eslint rule set is strict (`noUnusedLocals`, `verbatimModuleSyntax`, the effect rule above) — run `npm run lint` before considering a change done.
- Everything must fit the 1280×800 panel with no panel scroll; regions scroll internally (`.us-assistant__body`, admin content). The page around the panel may scroll only as a fallback — the stage's scale-to-fit should normally prevent it.
