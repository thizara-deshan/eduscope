# Wave 1 — Auth & Shell (S-01, S-02, S-03) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the panel's three Wave-1 screens — S-01 Login, S-02 Forced password reset / change password, S-03 Panel shell, chrome & alert host — plus the two pieces of shared infrastructure this cluster ships for every later wave (the on-screen-keyboard host and the header user menu), so that a user can log in on the mock, be forced to reset, and see live chrome with every enumerated failure state reachable from the scenario dev overlay.

**Architecture:** Three screens land into the Wave-0 scaffold, not beside it. `apps/panel/src/routes/panel-shell.tsx` (the single layout route) becomes S-03 and gains the header, the recording chrome, the alert banner host and the keyboard host; `routes/screens.tsx`'s `ScreenPlaceholder` is replaced for `/login` and `/login/reset` only. Auth state stays in the existing `auth/auth-context.tsx`; the existing `auth/require-role.tsx` U-7 gate is **not** reimplemented. All data crosses the `EduscopeClient` boundary via TanStack Query (request/response) and the zustand WS store (push); one new scenario-engine primitive — a transport-level fault — makes S-01's `backend unreachable` state reachable from the overlay for the first time.

**Tech Stack:** React 18.3 · TypeScript strict · react-router 7 · TanStack Query 5 · zustand 5 · react-simple-keyboard 3.8 · CSS custom-property tokens (`us-*` semantic classes, no Tailwind utilities) · Vitest + Testing Library (happy-dom) · Playwright.

---

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from the cited source; where a source says a doc "wins", it wins.

**Binding documents.** [`docs/design/frontend-conventions.md`](../../design/frontend-conventions.md) is binding for every task: *"If a plan, chat, or piece of generated code contradicts this doc, this doc wins."* The two approved screen designs are binding in the same way and **win over the prototype wherever they disagree**: [`docs/design/screens/S-01-design.md`](../../design/screens/S-01-design.md), [`docs/design/screens/S-02-design.md`](../../design/screens/S-02-design.md). Behavioral sources: [`docs/design/screen-inventory.md`](../../design/screen-inventory.md) §0.3, §0.4, §2 (S-01/S-02/S-03), §8; [`docs/design/state-machines.md`](../../design/state-machines.md).

**Contract state.** `contracts/openapi.yaml` is at **v0.2.0** (landed in `8711cbc`). The four amendments and what they oblige the frontend to do are in [`docs/design/contract-amendments.md`](../../design/contract-amendments.md). In force for this plan:

- `Problem.code` includes **`auth.account-disabled`** (A-1). Any `Problem.code` switch must handle it.
- `Problem.meta.reason` is declared, typed `SessionRevokedReason = 'expired' | 'logout' | 'takeover' | 'admin'` (A-2). It is set on `auth.session-revoked` **only, and on every occurrence of it**.
- `ChangePasswordRequest.newPassword` carries `minLength: 8`, `maxLength: 256`, `pattern: '^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)'` (A-3). This is the **legacy-parity** rule (B-42): ≥8 characters + at least one digit, one uppercase, one lowercase.
- `/auth/logout` is **exempt** from the `mustResetPassword` lock, alongside `/auth/change-password` and `/auth/me` (A-4).

**The client boundary (frontend-conventions §1).** *"No component may import `fetch`, `axios`, or `WebSocket` directly. The ONLY network boundary is the `EduscopeClient` interface in `packages/api-client`."* The panel reaches it exactly one way: `useClient()` from `apps/panel/src/client/client-provider.tsx`. Data flows via TanStack Query + the zustand WS store only. WS state is read **only** through `apps/panel/src/store/selectors.ts` — one atomic selector per field, or `useWsShallow` for a multi-field read. Never `useWsStore(s => ({ … }))`.

**Prototype usage (frontend-conventions §2).** `/prototype` is a behavioral and visual spec, not a code source. **MAY port:** layout, hierarchy, spacing, interaction behavior, the `us-*` semantic-class approach, the token custom properties. **MAY NOT port:** any context/mock logic — `COUNTDOWN_SPEED`, `simulateResponses`, `INITIAL_*` seeds, simulated timers and rosters are prototype-only. Where S-01-design.md and `prototype/src/components/LoginPage.tsx` disagree, **the design doc wins**: the role picker is removed and the reserved message slot is added.

**Design tokens (frontend-conventions §6, screen-inventory §8).** Every value comes from `apps/panel/src/styles/tokens.css`, which already carries the whole §8 sheet including `--danger`/`--danger-soft` and `--info`/`--info-soft` (`tokens.css:44-49`, currently marked *pending wireframe approval* — approving S-01 and S-02 closed that item; see Task 4). **No new colour, size, spacing or radius value may be introduced by this plan.**

**Kiosk & touch (frontend-conventions §3, screen-inventory §0.4).** Fixed **1280×800**; the page never scrolls, regions scroll internally. Touch targets ≥ **44 px** (`--tap-min`), list rows ≥ **56 px** (`--tap-row`), 8 px minimum separation between adjacent destructive and non-destructive targets. **No hover-only affordance anywhere.** `aria-label` on every icon-only control. Touch feedback < 100 ms — press states are CSS, never awaited on the network. Overlays and chrome are `position: absolute` inside `.us-panel`, **never** `position: fixed`.

**The on-screen keyboard (frontend-conventions §3, S-01-design §3).** The host ships in this wave and every later panel screen inherits it unchanged: mounted **once** inside `.us-panel`, `position: absolute`, and it publishes its reserved height as the CSS custom property **`--osk-h`** (`0px` closed, `380px` open). Screens size themselves with `calc(var(--panel-h) - var(--osk-h))` and therefore **never re-render when the keyboard opens**. Keyboard state is not threaded through props or context.

**States & scenarios (frontend-conventions §4).** Every enumerated state must be implemented **and reachable via the scenario dev overlay**. The catalog is **extended, never forked**: `happy`, `start-fails`, `pipeline-crash-midway`, `llm-timeout`, `disk-full`, `ws-flap`, `quiz-network-loss`, `auth-failures`. (The catalog is now **eight**; `frontend-conventions.md` §4 and `screen-inventory.md` §11 still enumerate the seven-script Wave-0 list. Both instruct that it be extended, so this is in line with them — the two literal lists are flagged for their owner in `contract-amendments.md`, and this plan does not edit them.)

**Testing floor (frontend-conventions §5).** Per screen: a Testing Library rendering test for **each enumerated state**; Playwright for the primary journey + at least one failure scenario (S-01 gets two, per S-01 §13); every mock response validates against the `contracts/` zod schemas.

**Lint rules already in force (`eslint.config.js`).** `react-hooks/exhaustive-deps: error`. `jsx-a11y/no-autofocus: error` — so **`autoFocus` as a JSX attribute is forbidden**; both screens autofocus their first field via a ref + `.focus()` in an effect. `jsx-a11y/label-has-associated-control`, `control-has-associated-label`, `aria-props`, `aria-role`, `role-has-required-aria-props` all error. The boundary rules (`no-restricted-globals` / `-imports` / `-properties`) apply to every file in `boundaryFiles`.

**Timers.** No value is invented. From `packages/shared/src/constants/timers.ts`:

| Constant | Value | Used by |
|---|---|---|
| `TIMERS['T-CMD-RESOLVE']` | 10 000 ms | S-01's login ceiling, S-02's submit ceiling (U-4: *"no indefinite spinners anywhere"*) |
| `TIMERS['T-WS-STALE']` | 10 000 ms | U-2 — already applied by `store/connection.ts`'s `isStale` |
| `WS_RECONNECT_BACKOFF_MS` | `[500, 1000, 2000, 4000, 8000, 10000]` | S-01's `backend unreachable` auto-retry (see **W1-D-2**) |

**Copy is fixed.** Every user-visible string on S-01 and S-02 comes from the copy decks in [S-01 §6](../../design/screens/S-01-design.md#6-copy-deck) and [S-02 §6](../../design/screens/S-02-design.md#6-copy-deck) and is reproduced verbatim in the task that renders it. No plain-language string is improvised. Alert banner text on S-03 is **never hardcoded**: it comes from `SystemAlert.title` / `.detail`, which the contract documents as *"Plain language for a non-technical lecturer"* (this is also what satisfies INV-RP-1 for `storage.warning`, whose text is generated from the real `RetentionPolicy`).

**Commit discipline.** One commit per task, at the end of the task, with the message given in that task's final step.

---

## Decisions this plan takes

These are implementation decisions the two design docs leave open. They are recorded here so a reviewer can reject them individually rather than discovering them in a diff.

| Id | Decision | Why | Cost to reverse |
|---|---|---|---|
| **W1-D-1** | The scenario engine gains **one** new primitive: `replace: 'unreachable'`, a transport-layer fault with no `Problem` body. No `hang` primitive. | `contract-amendments.md` assigns S-01's `backend unreachable` to Wave 1 as *"a scenario-engine change"*. One sentinel on the existing `replace` union is the smallest thing that works; the 10 s ceiling is a client-side timer and is covered by a fake-timer test, not by a scenario that makes a reviewer wait 10 s. | Low — one union member, one engine method |
| **W1-D-2** | S-01's `backend unreachable` auto-retry uses `WS_RECONNECT_BACKOFF_MS` (0.5, 1, 2, 4, 8 s, capped 10 s). | S-01 §5 says *"auto-retry with backoff"* and names no schedule. §9 `T-WS-RECONNECT` is the panel's one **documented** reconnect backoff, so reusing it invents nothing. | Low — one constant |
| **W1-D-3** | Access/refresh tokens are held in a module-level **in-memory** store (`auth/token-store.ts`). No `localStorage`, no `sessionStorage`. | Shared lecture-hall kiosk + PF-17 short-lived tokens. A persisted token outlives the lecturer who typed it — the same argument S-01 §8 makes for `autoComplete="off"`. A reload correctly returns to S-01. | Low |
| **W1-D-4** | S-02 freezes `mode` at mount (`useState(() => …)`) from `useAuth().mustResetPassword`. | S-02 §4 requires the mode be derived from the gate, never a prop or URL. But `success` clears `mustResetPassword` **before** navigating (S02-D-7), so a live derivation would flip `forced`→`voluntary` mid-flight and retarget the navigation. Freezing keeps the derivation and removes the race. | Low |
| **W1-D-5** | The Wave-0 scaffold probe (`ScaffoldShell` in `App.tsx`) moves into the dev-only scenario overlay and grows pause / resume / stop / meeting-channel controls. | S-03's `paused`, `saving`, `saved` and *still-streaming-while-paused* states have no other trigger until S-04 lands in Wave 2 — without this the S-03 gate cannot run. It also removes a stray "Start recording" button from the S-01/S-02 visual review, and the overlay is already `MOCK_ADAPTER`-gated and lazy, so it never ships to a kiosk. | Low — two e2e specs adjust |
| **W1-D-6** | `getProvisioning` in the mock gains an `engine.onCommand('getProvisioning')` hook. | It is S-03's first authenticated read, which makes it the only honest producer of a revoked session in Wave 1 (there is no token-refresh loop yet). A `401 auth.session-revoked` is a read-time refusal; the mock's reads simply never had the hook. | Low — one line |

**Known Wave-1 limitation, flagged not papered over.** S-01's `session expired` state is one state with four copy variants (S-01 §6). Wave 1 has no token-refresh loop, so only two variants have a live producer: `takeover` (via `auth-failures`) and `logout` (via Sign out). `expired` and `admin` are covered by Testing Library tests against the same code path and inherit a producer in Wave 2 with S-06. This is recorded in the S-01 gate rather than hidden.

---

## File Structure

```
packages/api-client/src/
  errors.ts                                   MODIFY  + TransportError
  mock/create-mock-client.ts                  MODIFY  transport-fault wrapper on the REST proxy
  mock/scenario/types.ts                      MODIFY  replace: … | 'unreachable'
  mock/scenario/engine.ts                     MODIFY  + onTransport(); onCommand predicate narrowed
  mock/scenario/scripts/auth-failures.ts      MODIFY  + login unreachable, + getProvisioning revoked
  mock/rest/provisioning.ts                   MODIFY  + engine.onCommand hook
  index.ts                                    MODIFY  export TransportError
packages/api-client/test/mock/
  transport-faults.test.ts                    NEW

apps/panel/src/
  App.tsx                                     MODIFY  drop ScaffoldShell (moves to devtools)
  auth/token-store.ts                         NEW     W1-D-3, in-memory TokenPair
  auth/session.ts                             NEW     LoginLocationState, asProblem, revokedReason
  auth/use-session-revocation.ts              NEW     401 auth.session-revoked -> /login + reason
  auth/auth-message.tsx                       NEW     the 40px message slot        [S-01 + S-02]
  auth/password-field.tsx                     NEW     label + input + optional reveal [S-01 + S-02]
  auth/auth.css                               NEW     .us-authmsg, .us-field, .us-input styles
  keyboard/keyboard-host.tsx                  NEW     mounts once in .us-panel, publishes --osk-h
  keyboard/use-keyboard.ts                    NEW     field registration + open/close + layout
  keyboard/keyboard.css                       NEW     .us-osk (absolute, 380px)
  screens/login/login-screen.tsx              NEW     route element for /login
  screens/login/login-card.tsx                NEW     auth-blind card + geometry
  screens/login/use-login.ts                  NEW     state union, Problem mapping, 10s ceiling
  screens/login/login.css                     NEW     .us-login* (ported from prototype)
  screens/reset/reset-screen.tsx              NEW     route element for /login/reset
  screens/reset/reset-card.tsx                NEW     680px two-column card
  screens/reset/password-policy.ts            NEW     the ONE client mirror of the server rule
  screens/reset/policy-checklist.tsx          NEW     live checkmark/circle per rule
  screens/reset/use-change-password.ts        NEW     mutation + getMe re-read + state union
  screens/reset/reset.css                     NEW     .us-reset*
  shell/panel-header.tsx                      NEW     S-03 header: brand, hall, clock, user menu
  shell/user-menu.tsx                         NEW     the two-row menu (S02-D-8)
  shell/panel-clock.tsx                       NEW     19px clock on --header-h
  shell/recording-chrome.tsx                  NEW     frame + notch + saving/saved/error chrome
  shell/alert-banners.tsx                     NEW     the banner host + acknowledge
  shell/offline-marker.tsx                    NEW     U-2 reconnecting marker
  shell/streaming-while-paused.tsx            NEW     SM-Q-4 persistent privacy indicator
  shell/shell.css                             NEW     .us-header*, .us-recframe, .us-recnotch, banners
  shell/use-provisioning.ts                   NEW     the hall-name query + revocation handling
  routes/panel-shell.tsx                      MODIFY  becomes S-03; hides the header on the 2 auth routes
  routes/router.tsx                           MODIFY  /login and /login/reset get real elements
  devtools/scenario-overlay.tsx               MODIFY  + hidden state mirror + transport strip (W1-D-5)
  devtools/scenario-overlay.css               MODIFY  + .us-devoverlay__transport

apps/panel/src/**/*.test.tsx                  NEW     one per unit; enumerated in each task
apps/panel/e2e/
  s01-login.spec.ts                           NEW
  s02-reset.spec.ts                           NEW
  s03-shell.spec.ts                           NEW
  panel-smoke.spec.ts                         MODIFY  open the overlay before driving transport
docs/plans/screens/
  wave-1-auth-shell-gate.md                   NEW     the gate record (written by Tasks 17-19)
```

---

## Task 1: Scenario engine — transport faults, and the auth-failures extension

The one piece of scenario-engine work this cluster owes. `contract-amendments.md` closes with: *"S-01's `backend unreachable` is still not scenario-reachable … the scenario engine has no transport-level primitive … It stays **Wave 1 work**."* This task is that work. Mechanical, so it is specified as full code.

**Files:**
- Modify: `packages/api-client/src/errors.ts`
- Modify: `packages/api-client/src/index.ts`
- Modify: `packages/api-client/src/mock/scenario/types.ts:20-30`
- Modify: `packages/api-client/src/mock/scenario/engine.ts:5-13, 47-57`
- Modify: `packages/api-client/src/mock/create-mock-client.ts:60-64, 91, 144-153`
- Modify: `packages/api-client/src/mock/rest/provisioning.ts:8-11`
- Modify: `packages/api-client/src/mock/scenario/scripts/auth-failures.ts`
- Test: `packages/api-client/test/mock/transport-faults.test.ts`

**Interfaces:**
- Consumes: `ScenarioEngine` (`scenario/engine.ts`), `ForcedTransition` (`scenario/types.ts`), the REST `Proxy` in `create-mock-client.ts:144`.
- Produces: `class TransportError extends Error { readonly operation: string }`, exported from `@eduscope/api-client`; `ScenarioEngine.onTransport(operationId: string): { delayMs: number } | null`; the `'unreachable'` member of `ForcedTransition['replace']`. Task 6 (`use-login`) and Task 10 (`use-change-password`) branch on `TransportError`.

- [ ] **Step 1: Write the failing test**

`packages/api-client/test/mock/transport-faults.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createMockClient } from '../../src/mock/create-mock-client.js';
import { TransportError, ProblemError } from '../../src/errors.js';

describe('scenario transport faults (W1-D-1)', () => {
  it('fails the first login at the transport layer, then lets it through', async () => {
    const client = createMockClient('auth-failures');
    await expect(
      client.login({ username: 'a.perera', password: 'correct-horse', client: 'panel' }),
    ).rejects.toBeInstanceOf(TransportError);

    const ok = await client.login({
      username: 'a.perera', password: 'correct-horse', client: 'panel',
    });
    expect(ok.user.username).toBe('a.perera');
    client.dispose();
  });

  it('carries no Problem body — a transport failure is not a refusal', async () => {
    const client = createMockClient('auth-failures');
    const error = await client
      .login({ username: 'a.perera', password: 'correct-horse', client: 'panel' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TransportError);
    expect((error as { problem?: unknown }).problem).toBeUndefined();
    expect((error as TransportError).operation).toBe('login');
    client.dispose();
  });

  it('does not let onCommand consume an unreachable rule\'s nth', async () => {
    // The regression: match() consumes an occurrence the moment its predicate
    // passes. Before the predicate carried `replace`, onCommand (called INSIDE
    // login) burned the transport rule's only occurrence and the fault never
    // fired at all.
    const client = createMockClient('auth-failures');
    await expect(
      client.login({ username: 'a.perera', password: 'correct-horse', client: 'panel' }),
    ).rejects.toBeInstanceOf(TransportError);
    client.dispose();
  });

  it('refuses getProvisioning once with a takeover reason, then serves it', async () => {
    const client = createMockClient('auth-failures');
    const error = await client.getProvisioning().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProblemError);
    expect((error as ProblemError).problem).toMatchObject({
      status: 401, code: 'auth.session-revoked', meta: { reason: 'takeover' },
    });
    await expect(client.getProvisioning()).resolves.toHaveProperty('hallDisplayName');
    client.dispose();
  });

  it('keeps operation identity stable across property reads', () => {
    const client = createMockClient('happy');
    expect(client.login).toBe(client.login);
    client.dispose();
  });

  it('rebuilds the counters on switchScenario', async () => {
    const client = createMockClient('auth-failures');
    await client.login({ username: 'a.perera', password: 'correct-horse', client: 'panel' })
      .catch(() => undefined);
    client.switchScenario('auth-failures');
    await expect(
      client.login({ username: 'a.perera', password: 'correct-horse', client: 'panel' }),
    ).rejects.toBeInstanceOf(TransportError);
    client.dispose();
  });

  it('leaves happy with no transport faults at all', async () => {
    const client = createMockClient('happy');
    await expect(
      client.login({ username: 'a.perera', password: 'correct-horse', client: 'panel' }),
    ).resolves.toBeTruthy();
    client.dispose();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @eduscope/api-client test transport-faults`
Expected: FAIL — `TransportError` is not exported from `../../src/errors.js`.

- [ ] **Step 3: Add `TransportError`**

Append to `packages/api-client/src/errors.ts`:

```ts
/**
 * A request that never reached an application layer: no status, no
 * `application/problem+json` body, nothing to name in a refusal message.
 *
 * This is the distinction S-01's `backend unreachable` turns on — "the device is
 * up and core-api is not" (screen-inventory §2 S-01) is NOT a refusal, and
 * rendering it as one would tell a lecturer their credentials were wrong.
 */
export class TransportError extends Error {
  readonly operation: string;
  constructor(operation: string) {
    super(`${operation}: the device API is unreachable`);
    this.name = 'TransportError';
    this.operation = operation;
  }
}
```

Export it from `packages/api-client/src/index.ts` beside `ProblemError`.

- [ ] **Step 4: Widen `ForcedTransition.replace`**

In `packages/api-client/src/mock/scenario/types.ts`, replace the `replace` field and its comment:

```ts
  /**
   * Run this transition instead, refuse the command with a `Problem`, or fail
   * the request at the TRANSPORT layer with no body at all (W1-D-1). Only
   * `'unreachable'` reaches `onTransport`; only `'refuse'` reaches `onCommand`.
   */
  readonly replace: TransitionId | 'refuse' | 'unreachable';
```

`delayMs` is already declared on this interface and is reused as *"fail after this long"* — no new field.

- [ ] **Step 5: Add `onTransport` and narrow `onCommand`**

In `packages/api-client/src/mock/scenario/engine.ts`, add to the `ScenarioEngine` interface:

```ts
  /**
   * Transport-layer fault, checked by the REST proxy BEFORE the operation runs.
   * Separate from `onCommand` because a transport failure has no Problem body
   * (see errors.ts TransportError). Returns how long to fail after, or null.
   */
  onTransport(operationId: string): { delayMs: number } | null;
```

and replace the `onCommand` implementation, adding `onTransport` beside it:

```ts
    onCommand(operationId) {
      // `f.replace === 'refuse'` is part of the PREDICATE, not a post-filter:
      // match() consumes an `nth` the moment its predicate passes, so a rule
      // filtered afterwards would still have burned its own occurrence here and
      // never fired in onTransport. No existing script pairs a command trigger
      // with a TransitionId replacement, so narrowing this changes no behaviour.
      const hit = match(
        (f) => 'command' in f.on && f.on.command === operationId && f.replace === 'refuse',
      );
      if (!hit) return null;
      return (
        hit.rule.refusal ?? {
          status: 409,
          code: 'conflict',
          title: `Refused by scenario "${script.name}"`,
        }
      );
    },

    onTransport(operationId) {
      const hit = match(
        (f) => 'command' in f.on && f.on.command === operationId && f.replace === 'unreachable',
      );
      return hit ? { delayMs: hit.rule.delayMs ?? 0 } : null;
    },
```

- [ ] **Step 6: Apply the fault in the REST proxy**

In `packages/api-client/src/mock/create-mock-client.ts`:

1. Import `TransportError` from `../errors.js`, and `ScenarioEngine` as a type from `./scenario/engine.js`.
2. Hoist the engine and add a wrapper cache beside `let rest!: …` (around line 63):

```ts
  let engine!: ScenarioEngine;
  // Cached so `client.login === client.login`. A fresh closure per property
  // access would break every dependency array that captures one operation.
  let wrapped = new Map<string, (...args: never[]) => Promise<unknown>>();
```

3. Inside `build()`, replace `const engine = createScenarioEngine(script);` with `engine = createScenarioEngine(script);` and add `wrapped = new Map();` immediately after it, so a `switchScenario` discards wrappers bound to the previous engine.

4. Replace the proxy's `get` trap:

```ts
    get(target, prop: string, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver);
      const op = rest[prop as keyof typeof rest];
      if (typeof op !== 'function') return undefined;
      const cached = wrapped.get(prop);
      if (cached) return cached;
      /**
       * The transport check sits HERE, not in each of the 77 operations: a
       * transport failure is by definition the request not arriving, so it
       * cannot be the responsibility of the code that would have handled it.
       */
      const fn = (...args: never[]): Promise<unknown> => {
        const fault = engine.onTransport(prop);
        if (!fault) return op(...args);
        return new Promise((_resolve, reject) => {
          setTimeout(() => reject(new TransportError(prop)), fault.delayMs);
        });
      };
      wrapped.set(prop, fn);
      return fn;
    },
```

- [ ] **Step 7: Give `getProvisioning` the refusal hook (W1-D-6)**

In `packages/api-client/src/mock/rest/provisioning.ts`, take `engine` from the context and guard the read:

```ts
export function createProvisioningOperations({ world, engine, seed }: RestContext) {
  return {
    getProvisioning: async (): Promise<DeviceProvisioning> => {
      // Reads refuse too. `auth.session-revoked` is a read-time refusal — the
      // session died between one request and the next — and this is S-03's
      // first authenticated read, so it is where a revoked session surfaces
      // (W1-D-6). Without the hook, `auth-failures` cannot reach S-01's
      // `session expired` at all in Wave 1.
      const refusal = engine.onCommand('getProvisioning');
      if (refusal) throw new ProblemError(refusal);
      return validated(zDeviceProvisioning, seed.provisioning);
    },
```

Import `ProblemError` from `'../../errors.js'`.

- [ ] **Step 8: Extend the `auth-failures` script**

In `packages/api-client/src/mock/scenario/scripts/auth-failures.ts`, **append** to `forced` (do not reorder or remove the two existing rules) and update the docblock's "NOT covered" paragraph, which this task closes:

```ts
    {
      // S-01 `backend unreachable` (S-01 §5): a transport failure, not a
      // Problem. The delay does two jobs — it holds `submitting` on screen long
      // enough to review the pending affordance, and it makes the recovery
      // (auto-retry succeeds on attempt 2) the demo rather than a dead end.
      on: { command: 'login' },
      nth: 1,
      replace: 'unreachable',
      delayMs: 1_200,
    },
    {
      // S-01 `session expired`, takeover wording (CG-11 / R-21). getProvisioning
      // is S-03's first authenticated read, so refusing it once is the shortest
      // honest path from "an administrator took the recorder" to the login
      // screen wording it. `nth: 1` so the next sign-in is not thrown out again.
      on: { command: 'getProvisioning' },
      nth: 1,
      replace: 'refuse',
      refusal: {
        status: 401,
        code: 'auth.session-revoked',
        title: 'Session revoked',
        meta: { reason: 'takeover' },
      },
    },
```

- [ ] **Step 9: Run the tests**

Run: `pnpm --filter @eduscope/api-client test`
Expected: PASS — including the pre-existing `auth-v0-2.test.ts` and `gate-contract-coverage.test.ts`, which must not regress.

- [ ] **Step 10: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: exit 0, no output.

- [ ] **Step 11: Commit**

```bash
git add packages/api-client && git commit -m "feat(mock): add a transport-fault scenario primitive for S-01 backend-unreachable"
```

---

## Task 2: Panel auth session plumbing — token store, Problem helpers, revocation

Shared by all three screens. Mechanical wiring, so it is specified as full code.

**Files:**
- Create: `apps/panel/src/auth/token-store.ts`
- Create: `apps/panel/src/auth/session.ts`
- Create: `apps/panel/src/auth/use-session-revocation.ts`
- Test: `apps/panel/src/auth/session.test.ts`

**Interfaces:**
- Consumes: `ProblemError`/`TransportError` shapes from Task 1; `useAuth()` from `auth/auth-context.tsx`; `require-role.tsx:22`'s existing `state={{ from: location.pathname }}`.
- Produces: `setTokens/getTokens/clearTokens`; `interface LoginLocationState { from?: string; reason?: SessionRevokedReason }`; `asProblem(e: unknown): Problem | null`; `isTransportFailure(e: unknown): boolean`; `revokedReason(e: unknown): SessionRevokedReason | null`; `useSessionRevocation(error: unknown): void`. Consumed by Tasks 6, 7, 10, 11, 13.

- [ ] **Step 1: Write the failing test**

`apps/panel/src/auth/session.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ProblemError, TransportError } from '@eduscope/api-client';
import { asProblem, isTransportFailure, revokedReason } from './session.js';
import { clearTokens, getTokens, setTokens } from './token-store.js';

const revoked = (reason?: string) =>
  new ProblemError({
    status: 401, code: 'auth.session-revoked', title: 'Session revoked',
    ...(reason ? { meta: { reason } } : {}),
  } as never);

describe('session helpers', () => {
  it('reads the Problem off a ProblemError and nothing else off anything else', () => {
    expect(asProblem(revoked('takeover'))?.code).toBe('auth.session-revoked');
    expect(asProblem(new TransportError('login'))).toBeNull();
    expect(asProblem(new TypeError('boom'))).toBeNull();
    expect(asProblem(undefined)).toBeNull();
  });

  it('treats every non-Problem rejection as a transport failure', () => {
    expect(isTransportFailure(new TransportError('login'))).toBe(true);
    expect(isTransportFailure(new TypeError('Failed to fetch'))).toBe(true);
    expect(isTransportFailure(revoked('expired'))).toBe(false);
  });

  it('names the revocation reason, defaulting to expired', () => {
    expect(revokedReason(revoked('takeover'))).toBe('takeover');
    expect(revokedReason(revoked('admin'))).toBe('admin');
    expect(revokedReason(revoked())).toBe('expired');
    expect(revokedReason(new TransportError('getMe'))).toBeNull();
  });

  it('holds tokens in memory and gives them back', () => {
    setTokens({ accessToken: 'a', refreshToken: 'r', expiresInSec: 900 });
    expect(getTokens()?.accessToken).toBe('a');
    clearTokens();
    expect(getTokens()).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @eduscope/panel test src/auth/session.test.ts`
Expected: FAIL — cannot resolve `./session.js`.

- [ ] **Step 3: Write `token-store.ts`**

```ts
import type { TokenPair } from '@eduscope/shared';

/**
 * In memory ONLY, deliberately (W1-D-3). The panel is a shared lecture-hall
 * kiosk and PF-17 issues short-lived tokens: a token in localStorage outlives
 * the lecturer who typed it, which is the same argument S-01 §8 makes for
 * `autoComplete="off"`. A reload returning to S-01 is correct behaviour on a
 * device the next person walks up to.
 *
 * Nothing READS these in Wave 1 — the mock ignores bearer tokens and
 * `createRealClient` is a Phase-4 stub. They are captured rather than dropped
 * because a silent drop is what makes a later "why is every request
 * unauthenticated" bug expensive to find.
 */
let tokens: TokenPair | null = null;

export const setTokens = (next: TokenPair | null): void => {
  tokens = next;
};
export const getTokens = (): TokenPair | null => tokens;
export const clearTokens = (): void => {
  tokens = null;
};
```

- [ ] **Step 4: Write `session.ts`**

```ts
import type { Problem, SessionRevokedReason } from '@eduscope/shared';

/**
 * What a navigation TO /login may carry. `from` is already produced by
 * `require-role.tsx:22`; `reason` is produced by a sign-out and by
 * `useSessionRevocation`, and words S-01's message slot (S-01 §6).
 */
export interface LoginLocationState {
  readonly from?: string;
  readonly reason?: SessionRevokedReason;
}

/** The boundary throws ProblemError; components only ever see `unknown`. */
export function asProblem(error: unknown): Problem | null {
  const problem = (error as { problem?: Problem } | null | undefined)?.problem;
  return problem && typeof problem.code === 'string' ? problem : null;
}

/**
 * Anything the boundary rejects with that is NOT a Problem never reached the
 * application layer: `TransportError` from the mock, a `TypeError` from fetch in
 * the real adapter. Both are S-01's `backend unreachable`, never a refusal —
 * U-5's "named reason in plain language" only applies to things with a name.
 */
export const isTransportFailure = (error: unknown): boolean => asProblem(error) === null;

/**
 * CG-11: the contract sets `meta.reason` on `auth.session-revoked` only, and on
 * every occurrence of it. The `?? 'expired'` is a belt-and-braces default for a
 * non-conforming server, not an expected path.
 */
export function revokedReason(error: unknown): SessionRevokedReason | null {
  const problem = asProblem(error);
  if (!problem || problem.code !== 'auth.session-revoked') return null;
  const reason = (problem.meta as { reason?: SessionRevokedReason } | undefined)?.reason;
  return reason ?? 'expired';
}
```

- [ ] **Step 5: Write `use-session-revocation.ts`**

```ts
import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from './auth-context.js';
import { revokedReason } from './session.js';
import { clearTokens } from './token-store.js';

/**
 * A revoked session is not an error card — it is a return to S-01 carrying the
 * word that explains it (S-01 §5 `session expired`, R-21 for `takeover`). Pass
 * any query/mutation error; a non-revocation error is ignored so a caller can
 * hand over `query.error` unconditionally.
 */
export function useSessionRevocation(error: unknown): void {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const reason = revokedReason(error);

  useEffect(() => {
    if (!reason) return;
    clearTokens();
    setUser(null);
    navigate('/login', { replace: true, state: { reason } });
  }, [reason, setUser, navigate]);
}
```

- [ ] **Step 6: Run the test**

Run: `pnpm --filter @eduscope/panel test src/auth/session.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 7: Commit**

```bash
git add apps/panel/src/auth && git commit -m "feat(panel): add auth session plumbing — token store, Problem helpers, revocation"
```

---

## Task 3: The on-screen-keyboard host (shared infrastructure)

**This is not S-01-local code.** S-01-design §3 and frontend-conventions §3 both state that the host ships with S-01 and **every later panel screen with a text field inherits it unchanged**. Build it as infrastructure, mounted once by the layout route.

**Files:**
- Create: `apps/panel/src/keyboard/use-keyboard.ts`
- Create: `apps/panel/src/keyboard/keyboard-host.tsx`
- Create: `apps/panel/src/keyboard/keyboard.css`
- Modify: `apps/panel/src/routes/panel-shell.tsx`
- Test: `apps/panel/src/keyboard/keyboard-host.test.tsx`

**Interfaces:**
- Consumes: `react-simple-keyboard` (already a dependency); `.us-panel` from `App.tsx`'s `Stage`.
- Produces:
  ```ts
  export type OskLayout = 'default' | 'numeric';
  export interface OskFieldBinding {
    onFocus(): void;
    onBlur(): void;
    readonly 'data-osk': OskLayout;
  }
  /** Binds one controlled text input to the single host. */
  export function useOskField(args: {
    value: string;
    onChange(next: string): void;
    layout?: OskLayout;   // default 'default'
  }): OskFieldBinding;
  export function KeyboardHost(): JSX.Element;
  export const OSK_OPEN_PX = 380;
  ```
  Task 4's `PasswordField` and Task 5/9's text inputs consume `useOskField`. Every later wave consumes the same two exports.

**Contract this task must satisfy** (S-01-design §3, verbatim obligations):

1. `position: absolute` inside `.us-panel`, **never** `position: fixed`.
2. Publishes `--osk-h` on the `.us-panel` element: `0px` closed, `380px` open.
3. Open/closed is React state **local to the host** — it changes a few times per screen, so it does not need the transient-store treatment `audio.levels` gets.
4. **No screen re-renders when the keyboard opens.** The property is written imperatively (`element.style.setProperty`) onto the nearest `.us-panel` ancestor from an effect in the host, exactly the technique frontend-conventions §1 mandates for telemetry. No context, no props, no store subscription in any screen.
5. Layout `default` for text, `numeric` for numeric fields.
6. Opens on focus; closes on blur or on an explicit ✕ key ≥ 44 px.
7. The host container calls `preventDefault()` on `mousedown`/`pointerdown` so tapping a key does not blur the field that is being typed into. Without this, rule 6 closes the keyboard on the first keypress.

**Implementation notes (no full code — the review of this is visual and behavioural at the gate):**

- `use-keyboard.ts` holds a module-level zustand store `{ open, layout, target: { value, onChange } | null }` plus the two exported hooks. `useOskField` registers itself as the target on focus and keeps the store's target in sync with its latest `value`/`onChange` while it is the active target (a stale closure here writes the previous keystroke's value back). It subscribes to **nothing**, so a field never re-renders because the keyboard opened.
- `keyboard-host.tsx` subscribes to the store, renders `react-simple-keyboard` when `open`, and maps `onKeyPress` to `target.onChange`. Handle `{bksp}`, `{space}`, `{shift}`, `{enter}` (submits by dispatching a `requestSubmit()` on the focused field's form) and a `{close}` key rendered as ✕ at ≥44 px.
- The `--osk-h` effect resolves `.us-panel` once via `ref.current?.closest('.us-panel')` and writes `0px`/`380px`; it clears the property on unmount.
- `keyboard.css`: `.us-osk { position: absolute; left: 0; right: 0; bottom: 0; height: 380px; z-index: 800; }` — tokens only, no new values. `380px` is the reserve the inventory names for S-01 and is exported as `OSK_OPEN_PX` so the geometry tests and the CSS cannot drift.
- Mount in `routes/panel-shell.tsx` as a sibling of `<Outlet/>`, **inside** `OverlayProvider`, so it is inside `.us-panel` and present on every route.

**Tests** (`keyboard-host.test.tsx`):

1. Closed by default and `--osk-h` reads `0px` on `.us-panel`.
2. Focusing a bound field opens the host and `--osk-h` reads `380px`.
3. The ✕ key closes it and restores `0px`; the ✕ button is ≥44 px and has an `aria-label`.
4. A key press calls the active field's `onChange` with the appended character; `{bksp}` removes one.
5. A `layout: 'numeric'` field opens the numeric layout.
6. Switching focus between two bound fields retargets without closing.
7. **Re-render isolation:** a screen component that renders a bound field commits exactly once across an open→close cycle (count commits in a `useEffect`, the same technique `App.tsx` uses for `window.__renderCount`).
8. `pointerdown` on the host is default-prevented.

**Verification:**

Run: `pnpm --filter @eduscope/panel test src/keyboard`
Expected: PASS, 8 tests.
Run: `pnpm lint`
Expected: exit 0 — in particular no `jsx-a11y/control-has-associated-label` on the ✕ key.

- [ ] **Step 1:** Write `keyboard-host.test.tsx` with the eight tests above.
- [ ] **Step 2:** Run it; expect FAIL (module not found).
- [ ] **Step 3:** Write `use-keyboard.ts`.
- [ ] **Step 4:** Write `keyboard.css`.
- [ ] **Step 5:** Write `keyboard-host.tsx`.
- [ ] **Step 6:** Mount `<KeyboardHost/>` in `routes/panel-shell.tsx`.
- [ ] **Step 7:** Run `pnpm --filter @eduscope/panel test src/keyboard` — expect PASS.
- [ ] **Step 8:** Run `pnpm --filter @eduscope/panel test && pnpm typecheck && pnpm lint` — expect no regression in `router.test.tsx` or `App.test.tsx`.
- [ ] **Step 9: Commit**

```bash
git add apps/panel/src/keyboard apps/panel/src/routes/panel-shell.tsx && git commit -m "feat(panel): add the on-screen-keyboard host publishing --osk-h"
```

---

## Task 4: Shared auth atoms — `AuthMessage` and `PasswordField`

Both are shared by S-01 and S-02 (S-01 §4's component table marks them `[shared with S-02]`). Building them once, before either screen, is what keeps them shared.

**Files:**
- Create: `apps/panel/src/auth/auth-message.tsx`
- Create: `apps/panel/src/auth/password-field.tsx`
- Create: `apps/panel/src/auth/auth.css`
- Modify: `apps/panel/src/styles/tokens.css:44-45` (comment only — see step 1)
- Test: `apps/panel/src/auth/auth-message.test.tsx`, `apps/panel/src/auth/password-field.test.tsx`

**Interfaces:**
- Consumes: `useOskField` (Task 3).
- Produces:
  ```ts
  export type AuthMessageValue =
    | { kind: 'error'; text: string }
    | { kind: 'warning'; text: string }
    | { kind: 'info'; text: string }
    | null;
  export function AuthMessage(props: { value: AuthMessageValue }): JSX.Element;

  export function PasswordField(props: {
    label: string;
    value: string;
    onChange(next: string): void;
    /** S02-D-4: true on S-02's New password ONLY. Never on S-01. */
    reveal?: boolean;
    disabled?: boolean;
    inputRef?: React.Ref<HTMLInputElement>;
    describedById?: string;
  }): JSX.Element;
  ```
  Consumed by Tasks 5, 6, 9, 11.

**Component contract:**

`AuthMessage` (S-01 §4, §2.1, S01-D-4):
- **Fixed 40 px, rendered unconditionally**, from first paint, empty and unannounced. It never mounts on demand — *"a slot that mounts on demand would move a 56 px submit button up by 40 px at the exact moment a lecturer is reaching for it."*
- `aria-live="polite"`. Never the sole carrier of a state.
- Three visual treatments, tokens only: error = `--danger` on `--danger-soft`, `--radius-md`, `--fs-xs`; warning = `--warning`, `--radius-md`, `--fs-xs`; info = `--info` on `--info-soft`, `--radius-md`, `--fs-xs`.

`PasswordField` (S-01 §4, S-02 §8, S02-D-4):
- 48 px input, `--surface-2`, `1px --border`, `--radius-md`, `--fs-base`. Label `--fs-2xs` / 700 / uppercase / `--tracking-wide` / `--text-muted`.
- `type="password"`, **`autoComplete="off"`** (S01-D-6), `name` chosen not to trigger a browser save prompt.
- Bound to the keyboard via `useOskField` (layout `default`).
- `reveal` renders an explicit ≥44 px button with `aria-label` + `aria-pressed`, **never** hover-triggered; defaults to hidden; auto-hides **on blur and after 10 s**. When `reveal` is absent there is no toggle in the DOM at all.

- [ ] **Step 1: Promote the two pending tokens**

In `apps/panel/src/styles/tokens.css`, replace the comment on lines 44-45 — the values do not change, only their status:

```css
  /* §8.2 additions — "we are recording" must not read as "this destroys data".
     Approved with the S-01 and S-02 wireframes (2026-08-04); S-01 §7 and
     S-02 §7 are the first consumers. */
```

- [ ] **Step 2: Write the failing tests**

`auth-message.test.tsx`:
1. Renders the slot with no value: the node exists, has no text, and its computed height is `40px` (this is S01-D-4; happy-dom resolves custom properties, and the height is a literal `40px` on the class).
2. `aria-live="polite"` is present with and without a value.
3. Each of the three kinds renders its own class and its text.
4. The slot's identity is stable across `null → error → null` (assert the same element node, i.e. it never unmounts).

`password-field.test.tsx`:
1. `type="password"` and `autoComplete="off"`.
2. Without `reveal`: no toggle button exists.
3. With `reveal`: an ≥44 px button with `aria-label` and `aria-pressed="false"`; pressing it flips `type` to `text` and `aria-pressed` to `true`.
4. Reveal auto-hides after 10 s (fake timers) and on blur.
5. Focus opens the on-screen keyboard (`--osk-h` becomes `380px`).
6. `disabled` disables the input and the reveal button.

- [ ] **Step 3:** Run both; expect FAIL.
- [ ] **Step 4:** Write `auth.css`, `auth-message.tsx`, `password-field.tsx`.
- [ ] **Step 5:** Run `pnpm --filter @eduscope/panel test src/auth` — expect PASS.
- [ ] **Step 6: Commit**

```bash
git add apps/panel/src/auth apps/panel/src/styles/tokens.css && git commit -m "feat(panel): add the shared auth message slot and password field"
```

---

## Task 5: S-01 — the login card (presentation only)

`login-card.tsx` is *"deliberately auth-blind: it is the only piece with layout maths in it, and keeping credentials out of it means the geometry in §2 can be tested without a client"* (S-01 §4).

**Files:**
- Create: `apps/panel/src/screens/login/login-card.tsx`
- Create: `apps/panel/src/screens/login/login.css`
- Test: `apps/panel/src/screens/login/login-card.test.tsx`

**Interfaces:**
- Consumes: `--osk-h` (Task 3), `AuthMessage` (Task 4).
- Produces:
  ```ts
  export function LoginCard(props: {
    message: AuthMessageValue;
    fields: ReactNode;
    action: ReactNode;
  }): JSX.Element;
  ```

**Route: partial prototype coverage — read both sources.** Port from `prototype/src/components/LoginPage.tsx` and `.us-login*` in `prototype/src/styles/app.css:218-328`: the dark band + logo, the 420 px card, the title/subtitle, the field label treatment, the submit. **Do not port** the role picker (`us-login__rolelabel`, `us-login__roles`, `us-login__role`, `.us-login__role--active`) — S01-D-1 removes it and *nothing replaces it*. Do not port the `lucide-react` icons unless that dependency already exists in `apps/panel` (it does not; render the submit label alone).

**Geometry this card is responsible for** (S-01 §2, the numbers the whole layout turns on):

| Element | px |
|---|---|
| body padding (22 top + 26 bottom) | 48 |
| title `--fs-3xl` / 800 / `--tracking-tight` | 29 |
| subtitle `--fs-sm`, `--text-muted` | 18 |
| 2 × field (label 17 + gap 6 + input 48) + gap `--sp-5` | 154 |
| message slot — reserved unconditionally | 40 |
| submit | 56 |
| 4 × flex gap `--sp-5` | 48 |
| **total (OSK open)** | **393** |

- Card width **420 px**. Outer container centres the card in `calc(var(--panel-h) - var(--osk-h))` — the formula S-01 §3 specifies verbatim; at the fixed kiosk viewport `--panel-h` is the panel's height by construction.
- The dark logo band is 82 px and **collapses to 0** when `--osk-h > 0` (S01-D-2), via a CSS transition on height keyed off the custom property. It is decorative, carries no information, and therefore survives the `prefers-reduced-motion` block already in `tokens.css:135`.
- With `--osk-h: 380px` the available height is 420 px, the card is 393 px, top edge at 13, bottom at 406, submit bottom at ≈380.

**Token usage** — every value from S-01 §7; introduce none: backdrop `--bg`; card `--surface`, `1px --border`, `--radius-panel`, `--shadow-lg`; band `--ink`; submit `--ink`/`#fff`, 56 px, `--radius-lg`, `--fs-md`/700, `--shadow-md`; focus ring 3 px `--accent` on `:focus-visible` (already global in `tokens.css:120`).

**Tests** (`login-card.test.tsx`):

1. Renders the title **"Welcome back"** and the subtitle **"Sign in to your recording panel"**.
2. Renders the `fields` and `action` slots in that order, with the message slot between them.
3. The message slot is present when `message` is `null` (S01-D-4).
4. There is **no** role picker: no element with an accessible name matching `/lecturer|administrator/i`.
5. With `--osk-h: 0px` the band has a non-zero computed height; with `380px` it computes to `0px`.
6. The card's computed width is `420px`.

> **Geometry beyond computed styles is a Playwright assertion, not a Testing Library one.** happy-dom has no layout engine, so `getBoundingClientRect()` returns zeros; the *"submit bottom edge ≤ 404 px"* assertion S-01 §13 requires lives in `e2e/s01-login.spec.ts` (Task 17).

- [ ] **Step 1:** Write `login-card.test.tsx` with the six tests.
- [ ] **Step 2:** Run it; expect FAIL.
- [ ] **Step 3:** Write `login.css` (ported per the rules above).
- [ ] **Step 4:** Write `login-card.tsx`.
- [ ] **Step 5:** Run `pnpm --filter @eduscope/panel test src/screens/login` — expect PASS.
- [ ] **Step 6: Commit**

```bash
git add apps/panel/src/screens/login && git commit -m "feat(S-01): add the auth-blind login card"
```

---

## Task 6: S-01 — `use-login` (the state union, Problem mapping, the 10 s ceiling)

**Files:**
- Create: `apps/panel/src/screens/login/use-login.ts`
- Test: `apps/panel/src/screens/login/use-login.test.ts`

**Interfaces:**
- Consumes: `useClient()`; `useAuth().setUser`; `setTokens` (Task 2); `asProblem`/`isTransportFailure` (Task 2); `TIMERS['T-CMD-RESOLVE']`, `WS_RECONNECT_BACKOFF_MS`.
- Produces:
  ```ts
  export type LoginState =
    | { phase: 'empty' }
    | { phase: 'submitting' }
    | { phase: 'rejected' }
    | { phase: 'disabled' }
    | { phase: 'unreachable'; attempt: number }
    | { phase: 'must-reset' }
    | { phase: 'success'; user: User };
  export interface UseLogin {
    readonly state: LoginState;
    readonly message: AuthMessageValue;
    readonly canSubmit: boolean;
    submit(credentials: { username: string; password: string }): void;
  }
  export function useLogin(): UseLogin;
  ```
  Task 7 consumes this.

**Behaviour, one row per S-01 §5:**

| State | Entered by | This hook does |
|---|---|---|
| `empty` | mount | `canSubmit` false while either field is blank |
| `submitting` | `submit()` | starts the **10 s ceiling** (`T-CMD-RESOLVE`) alongside the request |
| `rejected` | `401 auth.invalid-credentials` | message = error, **one message, no field enumeration** (U-5) |
| `disabled` | `401 auth.account-disabled` | message = **warning**, not error (A-1's frontend obligation) |
| `must-reset` | `200` ∧ `mustResetPassword` | writes the user + tokens, then reports `must-reset`; navigation is Task 7's job |
| `unreachable` | `isTransportFailure(err)` **or** the 10 s ceiling elapsing | message = info; schedules an auto-retry at `WS_RECONNECT_BACKOFF_MS[min(attempt, 5)]`; `canSubmit` stays false between attempts |
| `success` | `200` ∧ ¬`mustResetPassword` | `setTokens(res.tokens)`, `setUser(res.user)` |

Copy, verbatim from S-01 §6:

| Phase | Text |
|---|---|
| `rejected` | `That username and password do not match. Try again.` |
| `disabled` | `This account is not active — ask your administrator.` |
| `unreachable` | `The recording panel is starting up. Trying again…` |

- The request goes through `client.login({ username, password, client: 'panel' })` — `client: 'panel'` is **C-3**: always sent, never a user-visible choice.
- Every scheduled timer is cleared on unmount and on a new `submit()`. A retry that fires after the screen has navigated away is a bug.
- The mutation goes through TanStack Query's `useMutation` (request/response is Query's half of the boundary). `mutations: { retry: 0 }` is already set in `query/query-client.ts`, so the backoff above is this hook's own and does not compound with Query's.

**Tests** (`use-login.test.ts`, `renderHook` + a stub `EduscopeClient` injected through `ClientProvider`'s context, fake timers):

1. `canSubmit` is false with either field blank, true with both filled.
2. `submitting` while the promise is pending; `canSubmit` false.
3. `401 auth.invalid-credentials` → `rejected` + exact copy.
4. `401 auth.account-disabled` → `disabled` + exact copy + `kind: 'warning'`.
5. `TransportError` → `unreachable` + exact copy + `kind: 'info'`.
6. A pending promise + advancing **10 000 ms** → `unreachable` (U-4: no indefinite spinner).
7. `unreachable` auto-retries at 500 ms, then 1 000 ms, then 2 000 ms; a success on retry 2 lands in `success`.
8. `200` ∧ `mustResetPassword: true` → `must-reset`, and `setUser` was called with the response user.
9. `200` ∧ `mustResetPassword: false` → `success`, `setTokens` called with `res.tokens`.
10. Unmounting mid-flight fires no timer callbacks afterwards.

- [ ] **Step 1:** Write `use-login.test.ts` with the ten tests.
- [ ] **Step 2:** Run it; expect FAIL.
- [ ] **Step 3:** Write `use-login.ts`.
- [ ] **Step 4:** Run `pnpm --filter @eduscope/panel test src/screens/login/use-login` — expect PASS.
- [ ] **Step 5:** Run `pnpm lint` — expect exit 0 (watch `react-hooks/exhaustive-deps` on the retry effect).
- [ ] **Step 6: Commit**

```bash
git add apps/panel/src/screens/login && git commit -m "feat(S-01): add use-login with the Problem mapping and the 10s ceiling"
```

---

## Task 7: S-01 — the login screen and its route

**Files:**
- Create: `apps/panel/src/screens/login/login-screen.tsx`
- Modify: `apps/panel/src/routes/router.tsx:17-19, 36-47`
- Test: `apps/panel/src/screens/login/login-screen.test.tsx`

**Interfaces:**
- Consumes: `useLogin` (Task 6), `LoginCard` (Task 5), `PasswordField`/`AuthMessage` (Task 4), `LoginLocationState` (Task 2), `useOskField` (Task 3).
- Produces: `export function LoginScreen(): JSX.Element`, wired at `/login` (`gate: 'public'`).

**Responsibilities** (S-01 §4: *"Holds `username`/`password`, calls `use-login`, navigates on success. No layout."*):

- Owns the two field values. Username is a plain text input bound with `useOskField`; password is `PasswordField` with **`reveal` absent** (S02-D-4: no visibility toggle on this screen).
- **Autofocus username on mount via a ref + `.focus()` in an effect** — `jsx-a11y/no-autofocus` is an error and the `autoFocus` attribute is forbidden. This is what makes the keyboard open before first paint, so the card renders in its 393 px geometry immediately and the band collapse is never seen on arrival (S-01 §3).
- On `rejected`: keep the username, **clear the password, return focus to password** (S-01 §5).
- On `must-reset`: `<Navigate to="/login/reset" replace/>`. This is the *normal* path for every imported user (AD-6, INV-UI-2).
- On `success`: `navigate(state.from ?? '/', { replace: true })`, reading `from` off `useLocation().state as LoginLocationState`.
- **`session expired`**: on mount, read `state.reason`. Render the message from the S-01 §6 deck, `kind: 'info'`, and clear it as soon as the user edits a field. `reason: 'logout'` renders **no message** — the user meant to.

  | reason | Copy |
  |---|---|
  | `expired` | `Your session ended after a period of inactivity. Sign in again.` |
  | `takeover` | `An administrator took over this recording. Sign in again to continue.` |
  | `admin` | `An administrator ended your session. Sign in again.` |
  | `logout` | *(no message)* |

- Precedence: a live `useLogin` message always wins over the arrival `reason`.
- Both inputs carry `autoComplete="off"` (S01-D-6) and are locked while `submitting` (U-4).
- Submit label is **`Log In`**.

Router change: replace the `/login` placeholder with `<LoginScreen/>`. Keep `gate: 'public'` and keep the route inside the single `PanelShell` layout route — S-01 §12 requires the *header* be absent there, not the layout.

**Tests** (`login-screen.test.tsx`, `createMemoryRouter` + `AuthProvider` + a stub client — one per enumerated state):

1. `empty` — both fields blank, submit disabled, the message slot present and empty.
2. `submitting` — pending affordance on submit; both fields disabled.
3. `rejected` — copy shown; username kept; **password cleared**; focus on the password input.
4. `disabled account` — warning copy; treatment is warning, not error.
5. `must-reset` — the router is at `/login/reset`.
6. `backend unreachable` — info copy; submit stays disabled between attempts.
7. `session expired` ×4 — mounted at `/login` with each `state.reason`; assert the three copy strings and that `logout` renders **no** message.
8. `success` — `setUser` called; router lands on `state.from` when present, `/` when absent.
9. Username is focused on mount and the keyboard is open (`--osk-h` is `380px`).
10. Both inputs are `autoComplete="off"`.
11. The arrival reason clears on the first keystroke.

- [ ] **Step 1:** Write `login-screen.test.tsx` with the eleven tests.
- [ ] **Step 2:** Run it; expect FAIL.
- [ ] **Step 3:** Write `login-screen.tsx`.
- [ ] **Step 4:** Wire `/login` in `router.tsx`.
- [ ] **Step 5:** Run `pnpm --filter @eduscope/panel test src/screens/login src/routes` — expect PASS, `router.test.tsx` unregressed.
- [ ] **Step 6: Commit**

```bash
git add apps/panel/src/screens/login apps/panel/src/routes/router.tsx && git commit -m "feat(S-01): wire the login screen at /login"
```

---

## Task 8: S-02 — `password-policy.ts` and the policy checklist

*"`password-policy.ts` being the single source is the point of the whole right-hand column: a checklist that can drift from the server is worse than no checklist, because it promises acceptance it cannot deliver."* (S-02 §4.) Mechanical and load-bearing, so full code.

**Files:**
- Create: `apps/panel/src/screens/reset/password-policy.ts`
- Create: `apps/panel/src/screens/reset/policy-checklist.tsx`
- Test: `apps/panel/src/screens/reset/password-policy.test.ts` (the mirror test), `apps/panel/src/screens/reset/policy-checklist.test.tsx`

**Interfaces:**
- Consumes: `zChangePasswordRequest` from `@eduscope/shared` (generated **from the amended contract**, so the mirror test compares against the contract itself and not a hand-copied regex).
- Produces:
  ```ts
  export interface PasswordRule {
    readonly id: 'length' | 'digit' | 'upper' | 'lower' | 'match';
    readonly label: string;
    test(value: string, confirm: string): boolean;
  }
  export const PASSWORD_RULES: readonly PasswordRule[];
  export const PASSWORD_MAX_LENGTH: 256;
  export function meetsPolicy(newPassword: string, confirm: string): boolean;
  export function PolicyChecklist(props: { value: string; confirm: string }): JSX.Element;
  ```

- [ ] **Step 1: Write the failing mirror test**

`password-policy.test.ts`. This is the test S-02 §13 calls *"the one defect this screen cannot tolerate"*, and `contract-amendments.md` A-3 names it as the gate on that row:

```ts
import { describe, expect, it } from 'vitest';
import { zChangePasswordRequest } from '@eduscope/shared';
import { PASSWORD_MAX_LENGTH, PASSWORD_RULES, meetsPolicy } from './password-policy.js';

/** The corpus deliberately includes one case per lookahead plus both bounds. */
const CORPUS = [
  'Passw0rdd',        // compliant
  'Aa1aaaaa',         // compliant, exactly 8
  'Aa1aaaa',          // 7 — too short
  'password1',        // no uppercase
  'PASSWORD1',        // no lowercase
  'Passworddd',       // no digit
  '',                 // empty
  'temp-pass-1',      // the seeded temp credential: no uppercase
  `Aa1${'a'.repeat(254)}`, // 257 — over maxLength
];

describe('password-policy mirrors the contract (CG-12 / A-3)', () => {
  it.each(CORPUS)('agrees with zChangePasswordRequest on %j', (candidate) => {
    // `confirm` is matched so the client-only `match confirm` rule never
    // decides the comparison — the server has no such rule.
    const client = meetsPolicy(candidate, candidate);
    const server = zChangePasswordRequest.safeParse({
      currentPassword: 'whatever', newPassword: candidate,
    }).success;
    expect(client, `client and server disagree on ${JSON.stringify(candidate)}`).toBe(server);
  });

  it('renders five rules, in the order S-02 §6 lists them', () => {
    expect(PASSWORD_RULES.map((r) => r.id)).toEqual(['length', 'digit', 'upper', 'lower', 'match']);
    expect(PASSWORD_RULES.map((r) => r.label)).toEqual([
      'be 8+ characters', 'include a number', 'include a capital letter',
      'include a small letter', 'match confirm',
    ]);
  });

  it('fails match-confirm without failing the server rule', () => {
    expect(meetsPolicy('Passw0rdd', 'Passw0rdX')).toBe(false);
    expect(PASSWORD_RULES.find((r) => r.id === 'match')!.test('Passw0rdd', 'Passw0rdd')).toBe(true);
  });

  it('states the contract ceiling once', () => {
    expect(PASSWORD_MAX_LENGTH).toBe(256);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @eduscope/panel test src/screens/reset/password-policy`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `password-policy.ts`**

```ts
/**
 * The ONE client mirror of `ChangePasswordRequest.newPassword` as amended by
 * contract v0.2 (CG-12 / S02-D-1): minLength 8, maxLength 256, and
 * `^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)`. Legacy parity with B-42 — these users
 * already meet this rule today.
 *
 * The checklist renders whatever this exports, so changing the policy is a
 * one-constant edit and never a relayout (S-02 §4). `password-policy.test.ts`
 * asserts this file and the generated schema accept and reject the same set; if
 * they ever disagree the checklist is lying, which is the one defect S-02
 * cannot tolerate.
 */
export interface PasswordRule {
  readonly id: 'length' | 'digit' | 'upper' | 'lower' | 'match';
  readonly label: string;
  test(value: string, confirm: string): boolean;
}

export const PASSWORD_RULES: readonly PasswordRule[] = [
  { id: 'length', label: 'be 8+ characters', test: (v) => v.length >= 8 },
  { id: 'digit', label: 'include a number', test: (v) => /\d/.test(v) },
  { id: 'upper', label: 'include a capital letter', test: (v) => /[A-Z]/.test(v) },
  { id: 'lower', label: 'include a small letter', test: (v) => /[a-z]/.test(v) },
  { id: 'match', label: 'match confirm', test: (v, c) => v.length > 0 && v === c },
];

/**
 * The contract's `maxLength`. NOT a checklist row — a rule the user cannot
 * plausibly hit does not earn 24 px beside four they can — but it is part of
 * the mirror, so `meetsPolicy` enforces it and the New/Confirm inputs cap input
 * at this length.
 */
export const PASSWORD_MAX_LENGTH = 256;

export const meetsPolicy = (newPassword: string, confirm: string): boolean =>
  newPassword.length <= PASSWORD_MAX_LENGTH &&
  PASSWORD_RULES.every((rule) => rule.test(newPassword, confirm));
```

- [ ] **Step 4: Run the mirror test**

Run: `pnpm --filter @eduscope/panel test src/screens/reset/password-policy`
Expected: PASS, 12 assertions.

- [ ] **Step 5: Write `policy-checklist.test.tsx`**

1. Renders one row per `PASSWORD_RULES` entry, with its label.
2. A met rule shows the ✓ glyph and `--success`; an unmet rule shows ○ and `--text-faint` — **state is never carried by colour alone** (S-02 §8), so assert the glyph, not just the class.
3. The list is `aria-live="polite"`.
4. Typing a compliant password flips all five rows to met.
5. Heading reads **`PASSWORD MUST`**.

- [ ] **Step 6:** Write `policy-checklist.tsx` (rows are `--fs-sm`, 24 px each; heading `--fs-2xs`/700/uppercase/`--tracking-caps`/`--text-faint` per S-02 §7).
- [ ] **Step 7:** Run `pnpm --filter @eduscope/panel test src/screens/reset` — expect PASS.
- [ ] **Step 8: Commit**

```bash
git add apps/panel/src/screens/reset && git commit -m "feat(S-02): add the password policy mirror and live checklist"
```

---

## Task 9: S-02 — the reset card (presentation only)

**Files:**
- Create: `apps/panel/src/screens/reset/reset-card.tsx`
- Create: `apps/panel/src/screens/reset/reset.css`
- Test: `apps/panel/src/screens/reset/reset-card.test.tsx`

**Interfaces:**
- Consumes: `--osk-h`, `--modal-w`.
- Produces:
  ```ts
  export function ResetCard(props: {
    mode: 'forced' | 'voluntary';
    headerAction: ReactNode;   // Sign out (forced) | Cancel (voluntary)
    fields: ReactNode;
    reason: ReactNode;         // rendered only when mode === 'forced'
    checklist: ReactNode;
    message: ReactNode;
    action: ReactNode;
  }): JSX.Element;
  ```

**Route B — no prototype exists.** Every value comes from S-02 §2 and §7 and from the §8 token sheet; nothing is improvised.

**Layout** (S-02 §2, §2.1, §2.2, S02-D-5, S02-D-6):

- Card width **680 px = `--modal-w`** (reused, not a new number), `--sp-10` padding, `--surface`, `1px --border`, `--radius-panel`, `--shadow-lg`.
- Header row: title **`Set a new password`** (`--fs-2xl`/800) + the header action, ≥44 px, ≥8 px clear of every other target; `1px --border` rule beneath.
- Two columns, gap `--sp-9` (20 px), **top-aligned**: left **380 px** (three password fields + the message slot), right **236 px** (reason block → checklist → submit).
- The submit sits at the bottom of the **right** column, directly under the checklist, so the eye travels *requirements → action* without crossing columns.
- Height budget: padding 48 + header 44 + gap 16 + body `max(237, 287)` = **395 px**; top edge at 12, bottom at 407, 13 px clear of the keyboard.
- `voluntary` omits the reason block and the card shortens to **345 px**.

**Tests** (`reset-card.test.tsx`):

1. Card computed width is `680px`.
2. `forced` renders the reason block; `voluntary` does not.
3. All seven slots render, in the documented column assignment (assert the submit is inside the right column's element, not the left).
4. Title reads `Set a new password`.
5. The header action slot's element is ≥44 px.

- [ ] **Step 1:** Write `reset-card.test.tsx`.
- [ ] **Step 2:** Run it; expect FAIL.
- [ ] **Step 3:** Write `reset.css` and `reset-card.tsx`.
- [ ] **Step 4:** Run `pnpm --filter @eduscope/panel test src/screens/reset` — expect PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/panel/src/screens/reset && git commit -m "feat(S-02): add the two-column reset card"
```

---

## Task 10: S-02 — `use-change-password` (mutation, the `getMe` re-read, sign out)

**Files:**
- Create: `apps/panel/src/screens/reset/use-change-password.ts`
- Test: `apps/panel/src/screens/reset/use-change-password.test.ts`

**Interfaces:**
- Consumes: `useClient()`, `useAuth()`, `meetsPolicy` (Task 8), `asProblem`/`isTransportFailure`, `clearTokens`.
- Produces:
  ```ts
  export type ResetState =
    | { phase: 'validating' }
    | { phase: 'mismatch' }
    | { phase: 'submitting' }
    | { phase: 'rejected-current' }
    | { phase: 'rejected-policy' }
    | { phase: 'unreachable' }
    | { phase: 'success' };
  export interface UseChangePassword {
    readonly state: ResetState;
    readonly message: AuthMessageValue;
    readonly canSubmit: boolean;
    submit(values: { currentPassword: string; newPassword: string; confirm: string }): void;
    signOut(): void;
  }
  export function useChangePassword(mode: 'forced' | 'voluntary'): UseChangePassword;
  ```

**Behaviour, one row per S-02 §5:**

- `validating` / `mismatch` are derived from the field values via `meetsPolicy`; `canSubmit` is false until **every** rule is met.
- **C-1:** `currentPassword` is always sent — there is no exemption for the forced path (S02-D-2). Three fields on both paths.
- **C-2 / S02-D-7:** on `204`, **always re-read `getMe`** before reporting `success`, and write the result into `AuthProvider`. `204` has no body, and a stale `mustResetPassword` sends the user straight back here via `require-role.tsx:25`. If the re-read still reports `mustResetPassword: true`, **do not** report `success` — stay put and surface the message, because navigating would start an infinite redirect loop.
- `401 auth.invalid-credentials` → `rejected-current`; the screen clears and refocuses **Current password**.
- `422 validation.invalid` → `rejected-policy`. Kept implemented even though a correct mirror makes it unreachable in practice — *"a checklist that has silently drifted is exactly the failure this state exists to make visible."*
- Transport failure or the 10 s `T-CMD-RESOLVE` ceiling → `unreachable`, same info treatment as S-01 (U-2 on this screen means retrying the POST; there is no socket while `mustResetPassword` is true).
- `signOut()` → `client.logout()` → `clearTokens()` → `setUser(null)`. `/auth/logout` is exempt from the reset lock (A-4), so this genuinely revokes rather than leaving a live session on an abandoned kiosk. Navigation is Task 11's job; `signOut` resolves and the screen navigates to `/login` with `state: { reason: 'logout' }` — which renders **no** message, because the user meant to.

Copy, verbatim from S-02 §6:

| Phase | Text |
|---|---|
| `mismatch` | `The two new passwords do not match.` |
| `rejected-current` | `Your current password is not correct.` |
| `rejected-policy` | `That password does not meet the requirements above.` |

**Tests** (`use-change-password.test.ts`, stub client, fake timers):

1. `canSubmit` false until all five rules pass.
2. Confirm ≠ New → `mismatch` + exact copy.
3. `submitting` while pending.
4. `204` → `getMe` **is called**, `setUser` receives the re-read user, phase `success`.
5. `204` + a `getMe` that still says `mustResetPassword: true` → **not** `success`, no navigation reported (the infinite-loop regression S-02 §13 names).
6. `401 auth.invalid-credentials` → `rejected-current` + exact copy.
7. `422 validation.invalid` → `rejected-policy` + exact copy.
8. `TransportError` → `unreachable`; a pending promise + 10 000 ms → `unreachable`.
9. `signOut()` calls `client.logout()`, then `clearTokens` and `setUser(null)`, in that order.
10. The request body always carries `currentPassword`, in both modes.

- [ ] **Step 1:** Write `use-change-password.test.ts` with the ten tests.
- [ ] **Step 2:** Run it; expect FAIL.
- [ ] **Step 3:** Write `use-change-password.ts`.
- [ ] **Step 4:** Run `pnpm --filter @eduscope/panel test src/screens/reset/use-change-password` — expect PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/panel/src/screens/reset && git commit -m "feat(S-02): add use-change-password with the mandatory getMe re-read"
```

---

## Task 11: S-02 — the reset screen and its route

**Files:**
- Create: `apps/panel/src/screens/reset/reset-screen.tsx`
- Modify: `apps/panel/src/routes/router.tsx:19`
- Test: `apps/panel/src/screens/reset/reset-screen.test.tsx`

**Interfaces:**
- Consumes: `useChangePassword` (Task 10), `ResetCard` (Task 9), `PolicyChecklist` (Task 8), `PasswordField`/`AuthMessage` (Task 4), `LoginLocationState` (Task 2).
- Produces: `export function ResetScreen(): JSX.Element`, wired at `/login/reset` (authenticated, no role).

**Responsibilities:**

- **Mode**: `const [mode] = useState(() => (mustResetPassword ? 'forced' : 'voluntary'))` — derived from `useAuth()`, never from a prop or the URL (S-02 §4), and **frozen at mount** (W1-D-4) so clearing the flag on success cannot retarget the navigation mid-flight.
- Three `PasswordField`s: Current password, New password (**`reveal` enabled — the only place in the product it is**, S02-D-4), Confirm new password. All three `autoComplete="off"`; New and Confirm capped at `PASSWORD_MAX_LENGTH`.
- **Current password is autofocused on mount** via ref + effect (not the `autoFocus` attribute), so the keyboard is open before first paint and the card renders in its final geometry with no shift.
- The forced/voluntary difference is exactly three elements (S-02 §2.3): header action **Sign out** vs **Cancel**; reason block shown vs omitted; success → `/` vs `state.from`.
- Reason copy, verbatim: `Your account was created by an administrator. Choose a password only you know.`
- Submit label **`Set password`**. There is **no skip, no dismiss, and no route to the dashboard** in `forced`.
- `Cancel` (voluntary only) navigates back to `state.from ?? '/'` without calling anything.
- `Sign out` (forced only) calls `signOut()` then navigates to `/login` with `state: { reason: 'logout' }`.
- On `rejected-current`, clear the Current password field and return focus to it.

Router change: replace the `/login/reset` placeholder with `<ResetScreen/>`. Leave the gate as-is — the route must stay authenticated, and `require-role.tsx:25` already exempts this exact pathname from the U-7 bounce.

**Tests** (`reset-screen.test.tsx` — one per enumerated state of S-02 §5, plus both modes):

1. `forced` (user with `mustResetPassword: true`) — Sign out present, reason text present, **no Cancel**.
2. `voluntary` — Cancel present, no reason text, no Sign out.
3. `validating` — checklist rows flip as the New field is typed; submit disabled until all five are met.
4. `mismatch` — the match-confirm row is unmet and the message names it in words.
5. `submitting` — pending affordance; all three fields disabled.
6. `rejected (current)` — copy shown, Current password cleared and refocused.
7. `rejected (policy)` — copy shown; the checklist is still rendered.
8. `success` forced → router at `/`; `success` voluntary → router at `state.from`.
9. Sign out → `logout()` called, router at `/login`, and `location.state.reason === 'logout'`.
10. **Mode freeze** — flipping `mustResetPassword` to false while `submitting` still navigates to `/` (W1-D-4).
11. The reveal button exists on New password and on **neither** other field.
12. All three inputs are `autoComplete="off"`; Current password is focused on mount.

- [ ] **Step 1:** Write `reset-screen.test.tsx` with the twelve tests.
- [ ] **Step 2:** Run it; expect FAIL.
- [ ] **Step 3:** Write `reset-screen.tsx`.
- [ ] **Step 4:** Wire `/login/reset` in `router.tsx`.
- [ ] **Step 5:** Run `pnpm --filter @eduscope/panel test && pnpm typecheck && pnpm lint` — expect PASS / exit 0.
- [ ] **Step 6: Commit**

```bash
git add apps/panel/src/screens/reset apps/panel/src/routes/router.tsx && git commit -m "feat(S-02): wire the forced/voluntary reset screen at /login/reset"
```

---

## Task 12: Move the scaffold probe into the dev overlay, and give it transport controls

W1-D-5. Machine 1a has no UI trigger until S-04 lands in Wave 2, so without this the S-03 chrome states cannot be demonstrated — and the Wave-0 probe button currently floats over the login card, which would ruin the S-01 and S-02 visual reviews.

**Files:**
- Modify: `apps/panel/src/App.tsx:45-86, 93-109` (delete `ScaffoldShell` and its `declare global`; keep `Stage`)
- Modify: `apps/panel/src/devtools/scenario-overlay.tsx`
- Modify: `apps/panel/src/devtools/scenario-overlay.css`
- Modify: `apps/panel/e2e/panel-smoke.spec.ts`
- Test: `apps/panel/src/devtools/scenario-overlay.test.tsx` (extend the existing file)

**Interfaces:**
- Consumes: `useClient()`, `useRecordingState()`.
- Produces: inside the overlay component — an always-rendered, visually hidden `<div data-recording-state={state} />` (the seam `gate-boot.spec.ts` and `panel-smoke.spec.ts` already assert on), the `window.__renderCount` commit counter (moved verbatim, still in a `useEffect`), and, **inside the open dialog only**, a transport strip:

  | Control | Calls | Reaches |
  |---|---|---|
  | `dev-start` | `startRecording()` | 1a `starting` → `recording` |
  | `dev-pause` | `pauseRecording()` | 1a `paused` |
  | `dev-resume` | `resumeRecording()` | 1a `recording` |
  | `dev-stop` | `stopRecording()` | 1a `stopping` → `finalizing` → `completed` |
  | `dev-meeting-on` / `dev-meeting-off` | `enableChannel('meeting')` / `disableChannel('meeting')` | the second half of SM-Q-4's still-streaming-while-paused condition |

  Keep `data-testid="e2e-start-recording"` on the start control so the existing smoke assertion keeps its meaning. Every button ≥44 px; refusals are caught and ignored (this is a dev tool — S-04 renders refusals for real).

**Why this stays honest:** the overlay is already gated on `MOCK_ADAPTER` and `lazy()`-loaded (`App.tsx:23-29`), so none of it reaches a kiosk build; and frontend-conventions §4 puts state-reachability in the scenario overlay by design.

**Steps:**

- [ ] **Step 1:** Extend `scenario-overlay.test.tsx`: the hidden mirror renders `data-recording-state` when closed; the transport buttons appear only when the dialog is open; each button calls its client method exactly once; every button is ≥44 px.
- [ ] **Step 2:** Run it; expect FAIL.
- [ ] **Step 3:** Move the probe: delete `ScaffoldShell` from `App.tsx` (and its `window.__renderCount` global declaration, which moves with it), remove `<ScaffoldShell/>` from the tree, and add the mirror + counter + strip to `scenario-overlay.tsx`.
- [ ] **Step 4:** Add `.us-devoverlay__transport` to `scenario-overlay.css` (flex row, `--sp-3` gap, `min-height: var(--tap-min)`) and a visually-hidden rule for the mirror (`position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%);` — hidden, not `display:none`, so it stays queryable).
- [ ] **Step 5:** Update `panel-smoke.spec.ts`: both tests that click `e2e-start-recording` now call the file's existing `openScenarioOverlay(page)` helper first.
- [ ] **Step 6:** Run `pnpm --filter @eduscope/panel test src/devtools src/App.test.tsx` — expect PASS.
- [ ] **Step 7:** Run `pnpm --filter @eduscope/panel e2e` — expect **6 passed** (`gate-boot` 3 + `panel-smoke` 3), i.e. GATE 1a/1b/1e still green.
- [ ] **Step 8: Commit**

```bash
git add apps/panel/src apps/panel/e2e && git commit -m "refactor(panel): move the scaffold probe into the dev overlay and add transport controls"
```

---

## Task 13: S-03 — the shell layout, header, clock and user menu

**Files:**
- Create: `apps/panel/src/shell/panel-header.tsx`
- Create: `apps/panel/src/shell/panel-clock.tsx`
- Create: `apps/panel/src/shell/user-menu.tsx`
- Create: `apps/panel/src/shell/use-provisioning.ts`
- Create: `apps/panel/src/shell/shell.css`
- Modify: `apps/panel/src/routes/panel-shell.tsx`
- Test: `apps/panel/src/shell/panel-header.test.tsx`, `apps/panel/src/shell/user-menu.test.tsx`, `apps/panel/src/routes/panel-shell.test.tsx`

**Interfaces:**
- Consumes: `useClient()`, `useAuth()`, `useSessionRevocation` (Task 2), `clearTokens`, `useTicker` (the existing `hooks/use-ticker.ts`).
- Produces: `PanelHeader`, `UserMenu`, `PanelClock`, `useProvisioning(): { hallDisplayName: string | null }`. Tasks 14–16 mount beside them.

**Route A — partial prototype coverage.** Port from `prototype/src/components/Header.tsx` and `.us-header*` / `.us-clock*` / `.us-logout` in `prototype/src/styles/app.css:141-215`, and check the result against `prototype/examples/example-1.png` (dark 62 px bar, brand mark at left, centred clock, action at right). Rationalise every literal to a token: `62px → --header-h`, `18px → --sp-8`, `14px → --sp-6`, `19px → --fs-xl`, `13.5px → --fs-sm`, `999px → --radius-pill`.

**What is new here** (not in the prototype):

1. **Hall name.** `use-provisioning.ts` runs `getProvisioning` through TanStack Query, keyed `['provisioning']`, and passes its `error` to `useSessionRevocation` — which is what turns `auth-failures`' refusal into S-01's takeover wording. Renders `hallDisplayName` beside the brand; renders nothing (not a placeholder) while loading, per U-1's "never layout shift".
2. **The user name becomes a `▾` menu** (S02-D-8, and requirement 2 of screen-inventory S-03's gate-added block). Two rows, each ≥ **56 px** (`--tap-row`):
   - **Change password** → `navigate('/login/reset', { state: { from: location.pathname } })` — this is the only door to S-02's `voluntary` mode.
   - **Sign out** → `client.logout()`, `clearTokens()`, `setUser(null)`, `navigate('/login', { state: { reason: 'logout' } })`.
   The menu is a real popup (`aria-haspopup="menu"`, `aria-expanded`, `role="menu"` / `role="menuitem"`), opens on tap — never hover — and closes on Escape, on outside tap, and on selection. It renders **absolutely inside `.us-panel`**, never `fixed`.
3. **No header on `/login` and `/login/reset`** (requirement 1 of the same block; S-01 §12, S-02 §12). `panel-shell.tsx` reads `useLocation().pathname` and renders no header on exactly those two paths. Both routes stay inside the layout route — *"A header with an empty hall slot is worse than no header"*, and by C-1/C-3 there is nothing to put in it.

The clock stays the prototype's shape (`--fs-xl` time + `--fs-sm` date, `font-variant-numeric: tabular-nums`) and is read at arm's length, so ≥19 px is a floor, not a preference. Drive it from the existing `hooks/use-ticker.ts` rather than a new interval.

**Tests:**

1. No header renders at `/login`; none at `/login/reset`; one renders at `/`, `/library`, `/advanced`.
2. The hall name from `getProvisioning` appears once the query resolves; nothing renders in its place before.
3. A `401 auth.session-revoked` with `meta.reason: 'takeover'` from `getProvisioning` clears the user and lands the router on `/login` with `state.reason === 'takeover'`.
4. The header shows the signed-in user's `displayName` and a `▾` affordance with `aria-haspopup="menu"`.
5. The menu opens on tap with exactly two `menuitem`s, each ≥56 px; it does **not** open on hover.
6. Change password navigates to `/login/reset` carrying `state.from` equal to the current pathname.
7. Sign out calls `logout()`, clears the user, and lands on `/login` with `reason: 'logout'`.
8. Escape and an outside tap both close the menu.
9. The clock renders time and date, and the time's computed `font-size` is ≥19 px.
10. The header's computed height is `62px`.

- [ ] **Step 1:** Write the three test files with the ten tests above.
- [ ] **Step 2:** Run them; expect FAIL.
- [ ] **Step 3:** Write `shell.css` (header/clock/menu sections only; chrome and banners come in Tasks 14–15).
- [ ] **Step 4:** Write `use-provisioning.ts`, `panel-clock.tsx`, `user-menu.tsx`, `panel-header.tsx`.
- [ ] **Step 5:** Wire the header into `routes/panel-shell.tsx` behind the two-path check.
- [ ] **Step 6:** Run `pnpm --filter @eduscope/panel test src/shell src/routes` — expect PASS, `router.test.tsx` unregressed.
- [ ] **Step 7:** Run `pnpm lint` — expect exit 0 (`jsx-a11y/role-has-required-aria-props` on the menu).
- [ ] **Step 8: Commit**

```bash
git add apps/panel/src/shell apps/panel/src/routes/panel-shell.tsx && git commit -m "feat(S-03): add the panel header, clock and user menu"
```

---

## Task 14: S-03 — the recording chrome (idle / recording / paused / saving / saved / error)

**Files:**
- Create: `apps/panel/src/shell/recording-chrome.tsx`
- Modify: `apps/panel/src/shell/shell.css`
- Modify: `apps/panel/src/routes/panel-shell.tsx`
- Test: `apps/panel/src/shell/recording-chrome.test.tsx`

**Interfaces:**
- Consumes: `useRecordingState()` / `useRecordingSession()` from `store/selectors.ts` (atomic selectors only — never a bare object-returning selector).
- Produces: `export function RecordingChrome(): JSX.Element | null`.

**Route A — partial coverage.** Port `.us-recframe`, `.us-recframe--paused`, `.us-recnotch`, `.us-recnotch--paused`, `.us-recnotch__dot` and the `pulse-rec` keyframes from `prototype/src/styles/app.css:330-377`. `--recframe-w` (4 px) and `--radius-panel` (20 px) already exist; the prototype's literal `4px`/`20px`/`12px` become those tokens. The frame must keep `--radius-panel` — *"they must match or the frame will not hug the corners"*. `position: absolute` inside `.us-panel`, `pointer-events: none`, **never** `fixed`.

**States** (screen-inventory §2 S-03, machine 1a):

| Machine 1a state | Chrome | Source |
|---|---|---|
| `idle` | no frame, no notch | prototype |
| `recording` | 4 px `--record` frame + notch **`● RECORDING`** | prototype |
| `paused` | 4 px `--warning` frame + notch **`PAUSED`**, dot animation off | prototype |
| `stopping`, `finalizing` | **new**: neutral `--border-strong` frame + notch **`SAVING…`**, distinguished by sub-caption (`Closing the recording` / `Finishing the file`) | INT-5's ≤10 s window must be visible |
| `completed` | **new**: transient **`Saved`** confirmation, auto-dismissed | J-1 |
| `error` | **new**: an error card naming the cause in plain language, from `RecordingStatePayload.errorMessage` (falling back to `errorCode`), never a raw code | LP-4, G-1, U-5 |

- The notch keeps its `--tracking-caps-lg` uppercase treatment across all three captions so it reads as one component in three states.
- **No information may be carried by motion alone** — `tokens.css:135` reduces every duration to 0.001 ms under `prefers-reduced-motion`, so the pulsing dot is decorative and the word `RECORDING` is the signal.
- U-2 interaction: the frame is **retained** while the connection is stale. That behaviour is `store/connection.ts`'s `isStale` keeping the recording slice, and Task 16 asserts it end-to-end; this component simply must not clear on `stale`.

**Tests** (one per row above, plus):

7. `completed` renders `Saved` and clears itself on a timer (fake timers).
8. `error` renders `errorMessage` when present and a plain-language fallback when it is null — and never renders the bare `errorCode` string.
9. The frame element is `position: absolute` and its `border-radius` equals the panel's.
10. With `stale: true` and `recording`, the frame is still present.

- [ ] **Step 1:** Write `recording-chrome.test.tsx` with the ten tests.
- [ ] **Step 2:** Run it; expect FAIL.
- [ ] **Step 3:** Add the chrome section to `shell.css`.
- [ ] **Step 4:** Write `recording-chrome.tsx`.
- [ ] **Step 5:** Mount it in `panel-shell.tsx` (on every route, including the two auth routes — the frame is the device's state, not the screen's).
- [ ] **Step 6:** Run `pnpm --filter @eduscope/panel test src/shell` — expect PASS.
- [ ] **Step 7: Commit**

```bash
git add apps/panel/src/shell apps/panel/src/routes/panel-shell.tsx && git commit -m "feat(S-03): add the recording/paused/saving/saved/error chrome"
```

---

## Task 15: S-03 — the alert banner host, acknowledge, and the paused-while-streaming indicator

**Files:**
- Create: `apps/panel/src/shell/alert-banners.tsx`
- Create: `apps/panel/src/shell/streaming-while-paused.tsx`
- Modify: `apps/panel/src/shell/shell.css`
- Modify: `apps/panel/src/routes/panel-shell.tsx`
- Test: `apps/panel/src/shell/alert-banners.test.tsx`, `apps/panel/src/shell/streaming-while-paused.test.tsx`

**Interfaces:**
- Consumes: `useWsShallow(s => s.alerts)` — the store already applies INV-SA-1's bounding (`ws-store.ts:97-104` deletes an alert the moment `clearedAt` is set); `client.listAlerts()` for the cold render (U-1); `client.acknowledgeAlert(id)`; `useRecordingState()` and `useChannelStatus('meeting')` / `('streaming')`.
- Produces: `AlertBanners`, `StreamingWhilePaused`.

**Entirely new — the prototype has no alert host at all.**

**Copy is data, not code.** The shell renders `SystemAlert.title` and `.detail` exactly as the server sends them. This is not laziness: the contract documents `title` as *"Plain language for a non-technical lecturer"*, and it is the **only** way `storage.warning` can satisfy INV-RP-1 (*"text generated from `RetentionPolicy`, never hardcoded"* — B-53 warned at 70 % about an 80 % policy). The frontend maps `severity` → treatment and nothing else:

| `severity` | Treatment |
|---|---|
| `info` | `--info` on `--info-soft` |
| `warning` | `--warning` |
| `error`, `critical` | `--danger` on `--danger-soft` |

**Layout rule (screen-inventory §2 S-03 touch notes).** *"Banners must not push the layout (the dashboard has no vertical slack at 800 px) — they overlay the header band or dock above the bottom bars with a fixed 56 px lane."* Implement the fixed **56 px** lane (`--tap-row`), absolutely positioned inside `.us-panel` directly under the header; the `<Outlet/>`'s box does not change when a banner appears. More than one active alert: stack within the lane by severity, most severe first, with a count affordance rather than growth.

- Dismiss/acknowledge target ≥44 px with an `aria-label`; acknowledge calls `acknowledgeAlert(id)` and is **"hide for now", not "fix"** — a still-true condition re-raises every `T-ALERT-REEVALUATE` (30 s) per INV-SA-1, and the UI must not imply otherwise.
- Cold render: `listAlerts()` through TanStack Query keyed `['alerts']`, merged with the store; the WS snapshot on subscribe already replays `system.alert`, so the merge must be by `id` and must not double-render.

**`streaming-while-paused.tsx`** (SM-Q-4): a **persistent, non-dismissible** indicator whenever `recording.state === 'paused'` ∧ any `channel.state === 'on'`. *"A lecturer who taps Pause may believe everything stopped; this is the privacy guard."* Not a banner and not dismissible — it lives in the lane but has no acknowledge target.

**Tests** (`alert-banners.test.tsx`):

1. One banner per uncleared alert, rendering `title` and `detail` **verbatim** from the payload (assert against a fixture whose title contains a policy percentage, proving nothing is hardcoded).
2. Each severity maps to its treatment; `critical` renders as `error` does.
3. An alert whose `clearedAt` is set does not render.
4. Acknowledge calls `acknowledgeAlert` with the alert id, once.
5. The lane's computed height is `56px` with one banner and with three.
6. The lane is `position: absolute` (never `fixed`) and the outlet's height is unchanged with and without banners.
7. Cold render from `listAlerts` shows a banner before any WS event arrives (U-1).
8. An alert present in both the query and the store renders once.

(`streaming-while-paused.test.tsx`):

9. `paused` + meeting `on` → the indicator renders and has no dismiss control.
10. `paused` + all channels `off` → absent. `recording` + meeting `on` → absent.

- [ ] **Step 1:** Write both test files.
- [ ] **Step 2:** Run them; expect FAIL.
- [ ] **Step 3:** Add the banner-lane section to `shell.css`.
- [ ] **Step 4:** Write `alert-banners.tsx` and `streaming-while-paused.tsx`.
- [ ] **Step 5:** Mount both in `panel-shell.tsx` — **not** on `/login` or `/login/reset`, where `listAlerts` is bearer-authenticated and unavailable (C-1) or 403 (C-3).
- [ ] **Step 6:** Run `pnpm --filter @eduscope/panel test src/shell` — expect PASS.
- [ ] **Step 7: Commit**

```bash
git add apps/panel/src/shell apps/panel/src/routes/panel-shell.tsx && git commit -m "feat(S-03): add the alert banner host and the paused-while-streaming guard"
```

---

## Task 16: S-03 — the offline marker (U-2)

**Files:**
- Create: `apps/panel/src/shell/offline-marker.tsx`
- Modify: `apps/panel/src/shell/shell.css`
- Modify: `apps/panel/src/routes/panel-shell.tsx`
- Test: `apps/panel/src/shell/offline-marker.test.tsx`

**Interfaces:**
- Consumes: `useIsStale()`, `useConnectionPhase()` from `store/selectors.ts`.
- Produces: `export function OfflineMarker(): JSX.Element | null`; and the `.us-shell--stale` class hook that dims live regions.

**Behaviour (U-2, state-machines §5.5).** After `T-WS-STALE` (10 s) disconnected — a threshold `store/connection.ts:isStale` already applies, so this component only reads it:

- A "reconnecting" marker appears in the shell header band, ≥44 px if it carries any control (it carries none — it is a status, not an action).
- Live regions dim, via a class on the shell root that later waves' live regions opt into. Dimming is CSS only.
- **The red/amber recording frame is KEPT** — *"the device is still recording and hiding it would be the more dangerous lie."*
- Commands are rejected client-side with a clear message and are **never** queued for replay. There is no outbound queue in the store by design (`ws-store.ts:48-55`); this task adds no queue and asserts none exists.

**Tests:**

1. `phase: 'open'` → no marker.
2. `phase: 'reconnecting'`, not yet stale → no marker (U-2 fires at `T-WS-STALE`, not at the first drop).
3. `stale: true` → marker present, with accessible text naming reconnection.
4. `stale: true` + `recording` → the recording frame is still rendered (cross-check with Task 14's component in one tree).
5. `stale: true` → the shell root carries the dimming class; it is removed on recovery.

- [ ] **Step 1:** Write `offline-marker.test.tsx`.
- [ ] **Step 2:** Run it; expect FAIL.
- [ ] **Step 3:** Write `offline-marker.tsx` + the `shell.css` rules.
- [ ] **Step 4:** Mount it in `panel-shell.tsx`.
- [ ] **Step 5:** Run `pnpm --filter @eduscope/panel test && pnpm typecheck && pnpm lint` — expect PASS / exit 0.
- [ ] **Step 6: Commit**

```bash
git add apps/panel/src/shell apps/panel/src/routes/panel-shell.tsx && git commit -m "feat(S-03): add the U-2 offline marker, keeping the recording frame"
```

---

# The gates

The three tasks below are the deliverable's acceptance. **They are executable, not narrative:** every line is a command to run or a checklist row to demonstrate on a real 1280×800 browser, and each records its result in `docs/plans/screens/wave-1-auth-shell-gate.md` in the format `docs/plans/frontend-scaffold-gate.md` uses. A gate that cannot be demonstrated is a failed gate — not a note in the commit message.

**Common preconditions for all three gates:**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

```bash
pnpm --filter @eduscope/panel preview
```

Open `http://127.0.0.1:4173` at exactly **1280×800**. Reach the scenario overlay with a 2 s long-press on the top-left 44 px hotspot.

---

## Task 17: GATE S-01 — Login

- [ ] **Step 1: Write the Playwright spec**

`apps/panel/e2e/s01-login.spec.ts`:

- **Primary journey** — `happy`: `/login` → type `a.perera` / `correct-horse` → submit → the router is at `/`, the S-04 placeholder renders (`[data-testid="screen"][data-screen="S-04"]`), and the header shows the hall name.
- **Failure 1 — `rejected`**: `a.perera` / `wrong` → the exact copy *"That username and password do not match. Try again."*, the username field still holds `a.perera`, the password field is empty, and the router is still `/login`.
- **Failure 2 — `must-reset`**: `n.silva` / `temp-pass-1` → the router is at `/login/reset`. S-01 §13 requires this second scenario because *"`must-reset` is the normal path for every imported user."*
- **Geometry (the one number the whole layout turns on)**: with the keyboard open, `boundingBox().y + height` of the submit button is **≤ 404**, and `getComputedStyle(panel).getPropertyValue('--osk-h')` is `380px`.
- **No page scroll**: `document.documentElement.scrollHeight <= window.innerHeight`.
- **No header on `/login`** (S-01 §12).

Run: `pnpm --filter @eduscope/panel e2e s01-login`
Expected: PASS, 6 tests.

- [ ] **Step 2: Testing Library — one test per enumerated state**

Run: `pnpm --filter @eduscope/panel test src/screens/login src/auth src/keyboard`

Expected: PASS. Confirm the suite contains a rendering test for **every** row of S-01 §5 plus success — `empty`, `submitting`, `rejected`, `disabled account`, `must-reset`, `backend unreachable`, `session expired` (×4 reasons), `success`. A missing row fails this gate even if the suite is green.

- [ ] **Step 3: Boundary lint still green**

```bash
pnpm lint && pnpm test tools/eslint-rules/gate-boundary.test.ts
```

Expected: exit 0, and the boundary gate test passes — no new file imports `fetch`, `axios` or `WebSocket`, and the rule still fails a build that does.

- [ ] **Step 4: Scenario demo checklist — every enumerated state, in the browser**

| # | State | How to reach it from the overlay | What to see |
|---|---|---|---|
| 1 | `empty` | `happy`, load `/login` | Both fields blank, submit disabled, the message slot present and empty |
| 2 | `submitting` | `auth-failures`, submit any credentials | Pending affordance on submit for ~1.2 s, both fields locked |
| 3 | `backend unreachable` | same attempt, when it fails | *"The recording panel is starting up. Trying again…"* in info treatment, then an automatic retry that succeeds |
| 4 | `rejected` | `happy`, `a.perera` / `wrong` | The one plain-language message; username kept, password cleared, focus in password |
| 5 | `disabled account` | `happy`, `r.fonseka` / `Correct-horse-9` | *"This account is not active — ask your administrator."* in **warning**, not error |
| 6 | `must-reset` | `happy`, `n.silva` / `temp-pass-1` | Lands on S-02 with no flash of the dashboard |
| 7 | `session expired` (takeover) | `auth-failures`, sign in successfully; the shell's first `getProvisioning` is refused | Back at `/login` showing *"An administrator took over this recording. Sign in again to continue."* |
| 8 | `session expired` (logout) | Sign in, header ▾ → Sign out | Back at `/login` with **no message** |
| 9 | `success` | `happy`, `a.perera` / `correct-horse` | Dashboard placeholder + populated header |

> `session expired` reasons `expired` and `admin` have no live producer in Wave 1 — there is no token-refresh loop yet. They are covered by step 2's Testing Library tests against the same code path and inherit a producer with S-06 in Wave 2. Record this in the gate file rather than marking the row demonstrated.

- [ ] **Step 5: Visual review against the prototype and the tokens, 1280×800**

Compare `/login` side by side with `prototype/src/components/LoginPage.tsx` running in the prototype, and confirm:

- [ ] Card 420 px, dark band with the logo, title **Welcome back**, subtitle **Sign in to your recording panel** — the prototype's card, reproduced.
- [ ] **No role picker anywhere** (S01-D-1) and nothing filling the space it left.
- [ ] The message slot occupies 40 px from first paint, before any message exists (S01-D-4) — the submit button must not move when a message appears.
- [ ] With the keyboard open the band has collapsed to 0 and the card is in its 393 px geometry; because Username is focused on mount, **the collapse is never seen on arrival**.
- [ ] Submit 56 px, inputs 48 px, keyboard ✕ ≥44 px.
- [ ] Every colour, size, radius and spacing traces to `tokens.css` — no literal hex, no off-scale px in `login.css` beyond the geometry constants S-01 §2 states.
- [ ] Focus ring is the 3 px `--accent` `:focus-visible` ring.
- [ ] Re-run with `prefers-reduced-motion: reduce` (Chrome DevTools → Rendering): the band collapse still ends in the correct geometry and no information is lost.

- [ ] **Step 6: Record and commit**

Write the S-01 section of `docs/plans/screens/wave-1-auth-shell-gate.md` — one row per step above with the command, the result and the evidence.

```bash
git add apps/panel/e2e/s01-login.spec.ts docs/plans/screens/wave-1-auth-shell-gate.md && git commit -m "test(S-01): add the login e2e journeys and record the screen gate"
```

---

## Task 18: GATE S-02 — Forced password reset

- [ ] **Step 1: Write the Playwright spec**

`apps/panel/e2e/s02-reset.spec.ts`:

- **Primary journey** — `happy`: sign in as `n.silva` / `temp-pass-1` → forced reset → type `temp-pass-1` + a compliant new password twice → submit → the router is at `/`. This is the journey S-02 §13 specifies.
- **Failure — `rejected (current)`**: wrong current password → *"Your current password is not correct."*, the Current password field cleared and refocused, still at `/login/reset`.
- **Geometry**: with the keyboard open, the submit button's bottom edge ≤ **404** in **both** modes — `forced` (5 rules + reason) and `voluntary`.
- **No header on `/login/reset`** (S-02 §12).
- **No escape**: from `forced`, there is no control that reaches `/` — assert no link or button navigates there, and that a programmatic `/` bounces straight back via `require-role.tsx:25`.

Run: `pnpm --filter @eduscope/panel e2e s02-reset`
Expected: PASS, 6 tests.

- [ ] **Step 2: Testing Library — one test per enumerated state**

Run: `pnpm --filter @eduscope/panel test src/screens/reset`

Expected: PASS, covering every row of S-02 §5 plus both modes: `forced`, `voluntary`, `validating`, `mismatch`, `submitting`, `rejected (current)`, `rejected (policy)`, `success`. Plus the two S-02 §13 tests that are not states:

- [ ] the **policy mirror** test (`password-policy.test.ts`) — client and `zChangePasswordRequest` accept and reject the same corpus;
- [ ] the **`getMe` re-read** test — a `204` followed by a stale `mustResetPassword` does **not** navigate.

- [ ] **Step 3: Boundary lint still green**

```bash
pnpm lint && pnpm test tools/eslint-rules/gate-boundary.test.ts
```

Expected: exit 0.

- [ ] **Step 4: Scenario demo checklist — every enumerated state, in the browser**

| # | State | How to reach it | What to see |
|---|---|---|---|
| 1 | `forced` | `happy`, sign in as `n.silva` | **Sign out** in the header row, the reason sentence in the right column, **no Cancel** |
| 2 | `voluntary` | Sign in as `a.perera`, header ▾ → Change password | **Cancel**, no reason text, no Sign out |
| 3 | `validating` | Type into New password | Rules flip ✓ live; submit stays disabled until all five are met |
| 4 | `mismatch` | Type a different Confirm | `match confirm` goes ○ and the slot reads *"The two new passwords do not match."* |
| 5 | `submitting` | Submit a valid form | Pending on submit, all three fields locked |
| 6 | `rejected (current)` | Wrong current password | *"Your current password is not correct."* beside Current password, which is cleared and refocused |
| 7 | `rejected (policy)` | `auth-failures`, submit a **compliant** password | *"That password does not meet the requirements above."* — the case a correct client mirror can never produce. Submit again: `nth: 1`, so the retry succeeds and the demo recovers |
| 8 | `success` | Complete the reset as `n.silva` | Lands on the dashboard, and does **not** bounce back here (the `getMe` re-read) |
| 9 | Sign out | Tap Sign out from `forced` | Back at `/login` with **no message**, and the session genuinely revoked (A-4) |

- [ ] **Step 5: Visual review against the tokens, 1280×800**

There is no prototype for this screen — review against S-02 §2's wireframe and §7's token table:

- [ ] Card **680 px** and that width is `--modal-w`, not a new constant.
- [ ] Two columns, 380 / 236, gap `--sp-9`, top-aligned; the submit sits at the bottom of the **right** column under the checklist.
- [ ] `voluntary` omits the reason block and the card shortens; nothing else moves.
- [ ] Rule rows carry a **✓/○ glyph as well as colour** — set the browser to a greyscale filter and confirm every row's state is still readable (S-02 §8).
- [ ] The reveal button is on **New password only**, ≥44 px, `aria-pressed` flips, and it auto-hides on blur and after 10 s.
- [ ] Sign out is ≥44 px with ≥8 px separation from every other target.
- [ ] Inputs 48 px, submit 56 px; the page does not scroll in either mode.
- [ ] Every value traces to `tokens.css`.

- [ ] **Step 6: Record and commit**

```bash
git add apps/panel/e2e/s02-reset.spec.ts docs/plans/screens/wave-1-auth-shell-gate.md && git commit -m "test(S-02): add the reset e2e journeys and record the screen gate"
```

---

## Task 19: GATE S-03 — Panel shell, chrome & alert host

- [ ] **Step 1: Write the Playwright spec**

`apps/panel/e2e/s03-shell.spec.ts`:

- **Primary journey** — `happy`: sign in → header shows hall name, clock and the user's name → open the dev overlay → **Start** → red frame + `● RECORDING` notch → **Pause** → amber frame + `PAUSED` → **Resume** → **Stop** → `SAVING…` → `Saved` → idle chrome, no frame.
- **Failure — `start-fails`**: Start → the chrome reaches `error` with a plain-language cause **and the red frame never appears** (B-12: a failed start must never read as recording — assert with a MutationObserver, the technique `panel-smoke.spec.ts` already uses).
- **`ws-flap`**: after `T-WS-STALE` the reconnecting marker appears **and the recording frame is retained**.
- **`disk-full`**: a `storage.critical` banner renders and its text contains the policy figure from the payload, proving nothing is hardcoded.
- **Layout invariance**: the `<Outlet/>`'s bounding box is byte-identical with zero banners and with one — banners must not push the layout.
- **No header** at `/login` and `/login/reset`; header present at `/`.

Run: `pnpm --filter @eduscope/panel e2e s03-shell`
Expected: PASS, 6 tests.

- [ ] **Step 2: Testing Library — one test per enumerated state**

Run: `pnpm --filter @eduscope/panel test src/shell src/routes src/devtools`

Expected: PASS, covering every state screen-inventory §2 S-03 enumerates: `idle chrome`, `recording chrome`, `paused chrome`, `saving chrome` (both `stopping` and `finalizing`), `saved`, `error`, `panel offline` (U-2, frame retained), the banner host (per-severity, cold render, acknowledge, cleared), and `still streaming while paused`. Plus the two gate-added requirements: no header on the two auth routes, and the two-row user menu.

- [ ] **Step 3: Boundary lint still green, and the Wave-0 gates unregressed**

```bash
pnpm lint && pnpm test tools/eslint-rules/gate-boundary.test.ts && pnpm gate
```

Expected: exit 0; `pnpm gate` still reports **5 passed** (panel 1a/1b/1e + quiz 1c/1d) — Task 12 moved the probe, so this is where that move is proved harmless.

- [ ] **Step 4: Scenario demo checklist — every enumerated state, in the browser**

| # | State | How to reach it | What to see |
|---|---|---|---|
| 1 | `idle chrome` | `happy`, signed in | Header only, no frame, no notch |
| 2 | `recording chrome` | Overlay → **Start** | 4 px `--record` frame + `● RECORDING` notch |
| 3 | `paused chrome` | → **Pause** | Amber frame + `PAUSED`, dot animation stopped |
| 4 | `saving chrome` | → **Stop** | Neutral frame + `SAVING…`; the sub-caption changes between `stopping` and `finalizing` (~0.9 s then ~1.4 s) |
| 5 | `saved` | let it finish | Transient **Saved** confirmation, then idle chrome |
| 6 | `error` | `start-fails`, → **Start** | Error card with a plain-language cause; the red frame never appeared |
| 7 | `panel offline` (U-2) | `ws-flap`, wait 10 s after a drop | Reconnecting marker, live regions dimmed, **frame retained** |
| 8 | Banner · info | `happy` on load | The seeded `firmware.update-available` banner, in `--info` |
| 9 | Banner · warning + error | `disk-full`, → **Start** | `storage.critical` refusal and its banner; text carries the real policy figure |
| 10 | Banner · error from a machine | `pipeline-crash-midway`, → **Start**, wait | `recording.pipeline-lost`, and the lecture survives into a new segment |
| 11 | Acknowledge | Tap a banner's acknowledge | The banner hides; it may legitimately re-raise after `T-ALERT-REEVALUATE` (30 s) — that is INV-SA-1, not a bug |
| 12 | Still streaming while paused | Overlay → **Meeting on**, → **Start**, → **Pause** | The persistent, **non-dismissible** privacy indicator |
| 13 | User menu | Header ▾ | Two ≥56 px rows: Change password → S-02 `voluntary`; Sign out → `/login` |
| 14 | No header | Navigate to `/login` and `/login/reset` | No header on either |

- [ ] **Step 5: Visual review against the prototype and the tokens, 1280×800**

Compare the header and frame against `prototype/src/components/Header.tsx`, `.us-recframe`/`.us-recnotch`, and `prototype/examples/example-1.png`:

- [ ] Header 62 px (`--header-h`), dark `--ink`, brand at left, clock centred, user at right — the prototype's bar, with **Logout replaced by the `▾` menu**.
- [ ] Clock time ≥19 px with tabular numerals; readable at arm's length.
- [ ] Frame `--radius-panel` (20 px) so it hugs the panel corners; `position: absolute`, never `fixed`.
- [ ] The notch reads identically in all three captions — one component, three states.
- [ ] The banner lane is a fixed 56 px and overlays rather than pushes; three simultaneous banners still occupy 56 px.
- [ ] Every dismiss/acknowledge target ≥44 px with an `aria-label`.
- [ ] Under `prefers-reduced-motion: reduce`, the recording state is still unambiguous with the pulse frozen.
- [ ] Every value traces to `tokens.css`; the `us-*` semantic-class approach is intact and no token became a Tailwind utility.

- [ ] **Step 6: Wave exit condition**

screen-inventory §11 Wave 1: *"A user can log in, be forced to reset, and see live chrome."* Demonstrate the whole thing in one unbroken run on `happy`: `/login` → sign in as `n.silva` → forced reset → dashboard → Start → recording chrome → Stop → Saved → header ▾ → Sign out → `/login`.

- [ ] **Step 7: Record and commit**

Complete `docs/plans/screens/wave-1-auth-shell-gate.md` with the S-03 section and the wave exit condition.

```bash
git add apps/panel/e2e/s03-shell.spec.ts docs/plans/screens/wave-1-auth-shell-gate.md && git commit -m "test(S-03): add the shell e2e journeys and record the Wave 1 gate"
```

---

## Appendix A — State → scenario-script map (the whole cluster, one table)

Every enumerated state, and the exact script that demonstrates it. **NEW** marks work this plan adds to the scenario engine or catalog; everything else is already reachable.

| Screen | State | Script | Trigger |
|---|---|---|---|
| S-01 | `empty` | any | load `/login` |
| S-01 | `submitting` | `auth-failures` | submit (held 1.2 s by the **NEW** `login` unreachable rule's `delayMs`) |
| S-01 | `rejected` | any | `a.perera` / wrong password |
| S-01 | `disabled account` | any | `r.fonseka` / `Correct-horse-9` (seeded, CG-10) |
| S-01 | `must-reset` | any | `n.silva` / `temp-pass-1` (seeded) |
| S-01 | `backend unreachable` | `auth-failures` | **NEW** `{ on: { command: 'login' }, nth: 1, replace: 'unreachable', delayMs: 1200 }` |
| S-01 | `session expired` · takeover | `auth-failures` | **NEW** `{ on: { command: 'getProvisioning' }, nth: 1, replace: 'refuse', meta.reason: 'takeover' }` |
| S-01 | `session expired` · logout | any | header ▾ → Sign out, or S-02's Sign out |
| S-01 | `session expired` · expired / admin | — | **no Wave-1 producer** (no refresh loop); unit-tested, inherits one with S-06 |
| S-01 | `success` | any | `a.perera` / `correct-horse` |
| S-02 | `forced` | any | sign in as `n.silva` |
| S-02 | `voluntary` | any | header ▾ → Change password |
| S-02 | `validating` / `mismatch` | any | type |
| S-02 | `submitting` | any | submit |
| S-02 | `rejected (current)` | any | wrong current password |
| S-02 | `rejected (policy)` | `auth-failures` | existing `changePassword` `nth: 1` → `422` |
| S-02 | `success` | any | complete the reset |
| S-03 | `idle chrome` | `happy` | load |
| S-03 | `recording chrome` | `happy` | **NEW** overlay transport → Start |
| S-03 | `paused chrome` | `happy` | **NEW** overlay transport → Pause |
| S-03 | `saving chrome` | `happy` | **NEW** overlay transport → Stop (`stopping` 0.9 s, `finalizing` 1.4 s) |
| S-03 | `saved` | `happy` | the same stop, on `completed` |
| S-03 | `error chrome` | `start-fails` | Start (R-05 → R-06) |
| S-03 | `panel offline` | `ws-flap` | wait 10 s after a drop |
| S-03 | banner · info | any | seeded `firmware.update-available` |
| S-03 | banner · warning / error | `disk-full` | seeded `storagePressure: critical` + Start |
| S-03 | banner · machine-raised error | `pipeline-crash-midway` | Start, wait for R-16 |
| S-03 | still streaming while paused | `happy` | **NEW** overlay → Meeting on, Start, Pause |

---

## Appendix B — What this cluster hands to later waves

| Artefact | Inherited by |
|---|---|
| `keyboard/` — the host and `useOskField`, `--osk-h` | Every later panel screen with a text field (S-15, S-20, S-26–S-36) |
| `auth/password-field.tsx`, `auth/auth-message.tsx` | S-32/S-33 user management |
| `auth/session.ts` + `use-session-revocation.ts` | S-06 (W-2), which must read the same `meta.reason` vocabulary so takeover reads identically on both sides of R-21 |
| `shell/` — header, user menu, chrome, banner host | Every dashboard screen (Wave 2+); the banner host is where every `system.alert` in screen-inventory S-03's table lands |
| `screens/reset/password-policy.ts` | S-33 (user import) inherits the same rule (A-3) |
| The `'unreachable'` scenario primitive | Any later screen needing a transport failure rather than a refusal |
| The dev transport strip | Retired when S-04's real Start pill lands in Wave 2 |
