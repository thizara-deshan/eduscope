# Frontend Conventions — binding rules for every frontend plan & execute run

Every plan in `docs/plans/` references this doc. **If a plan, chat, or piece of
generated code contradicts this doc, this doc wins.** If this doc itself needs
to change, that is a gate discussion with the architect — never an in-run
improvisation.

## 1. The client boundary

- No component may import `fetch`, `axios`, or `WebSocket` directly. The ONLY
  network boundary is the `EduscopeClient` interface in `packages/api-client`
  (mock and real adapters implement the same interface). The ESLint boundary
  rule enforcing this must stay green in every run.
- Data flows via TanStack Query + the WS store (zustand) only.
- Commands are **202-async**: the UI reacts to WS state transitions, never
  assumes success. Optimistic UI only where the screen spec explicitly says so.
- Screens read WS state through `apps/panel/src/store/selectors.ts` only: one
  atomic selector per field, or `useWsShallow` for a multi-field read. A bare
  `useWsStore(s => ({ … }))` re-renders on every store notification — zustand v5
  has no automatic shallow equality.
- `audio.levels` and other telemetry never enter React state. Subscribe to the
  transient store imperatively and write a CSS custom property or paint a canvas.

## 2. Prototype usage (screens with coverage = full/partial)

`/prototype` is a **behavioral and visual spec**, not a code source:

- **Reproduce:** layout, hierarchy, spacing, interaction behavior.
- **MAY port:** markup structure, the `us-*` semantic-class approach, and the
  design tokens (`index.css` / `styles/app.css` custom properties). Keep the
  custom-properties approach — do not convert tokens to Tailwind utilities.
- **MAY NOT port:** context/mock logic. `COUNTDOWN_SPEED`, `simulateResponses`,
  `INITIAL_*` seeds and all simulated timers/rosters are prototype-only.
  Wherever the prototype simulates (mic meters, streaming leaderboard
  responses, countdowns), bind to the corresponding WS events from
  `contracts/events.md` instead.

## 3. Kiosk & touch

- Panel app: fixed 1280×800 viewport; everything fits with internal-region
  scrolling only — the page itself never scrolls.
- Touch targets ≥ 44 px; no hover-only affordances anywhere.
- On-screen keyboard (react-simple-keyboard) for text fields on the panel app.
  **The host ships with S-01 in Wave 1 and every later screen inherits it** —
  its contract is [S-01-design.md §3](screens/S-01-design.md): mounted once,
  `position: absolute` inside `.us-panel` (never `fixed`), and it publishes its
  reserved height as the CSS custom property **`--osk-h`** (`0px` closed,
  `380px` open). Screens size themselves with
  `calc(var(--panel-h) - var(--osk-h))` and therefore **never re-render when the
  keyboard opens**. Do not thread keyboard state through props or context.
- aria-labels on all icon-only buttons.

## 4. States & scenarios

- Every state the screen spec enumerates — empty, loading, populated, each
  failure state, offline/reconnecting — must be implemented **and reachable via
  the scenario dev overlay**. Wire new forced transitions into the scenario
  engine when a screen needs them.
- Scenario script catalog (extend it, never fork it): `happy`, `start-fails`,
  `pipeline-crash-midway`, `llm-timeout`, `disk-full`, `ws-flap`,
  `quiz-network-loss`.

## 5. Testing floor (per screen)

- Testing Library: a rendering test for **each enumerated state**.
- Playwright: the primary journey + at least one failure scenario.
- Contract honesty: every mock response validates against the zod schemas from
  `contracts/`.

## 6. Design tokens

- Source of truth: the token sheet in `docs/design/screen-inventory.md`, ported
  from `/prototype`. Screens without prototype coverage use the same token
  system — no new ad-hoc colors, spacing, or type sizes.
