# Eduscope Frontend Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase-2 frontend scaffold — a pnpm workspace whose two apps boot against a fully in-memory mock of the frozen `contracts/`, with a scenario engine that drives the documented state machines through happy and failure paths, so that every screen in prompt 09 can be built without touching `fetch`.

**Architecture:** Three layers, strictly stacked. `packages/shared` owns the zod mirror of `contracts/openapi.yaml` + `contracts/events.md` and nothing else. `packages/api-client` owns the *only* network boundary: one `EduscopeClient` interface, a real adapter that is an honest stub, and a mock adapter that is a discrete-event simulation of `docs/design/state-machines.md`. `apps/panel` (Vite kiosk SPA) and `apps/quiz` (Next.js mobile web) consume that interface through TanStack Query (request/response) and a zustand store (WS-fed state) — never directly.

**Tech Stack:** pnpm workspaces · Vite · React 18 · TypeScript strict · Tailwind CSS 4 · react-router 7 · TanStack Query 5 · zustand 5 · react-hook-form + zod · Vitest + Testing Library · Playwright · Next.js 14 App Router (`apps/quiz` only).

---

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from the cited source; where a source says a doc "wins", it wins.

**Binding documents.** `docs/design/frontend-conventions.md` is binding for every task in this plan. *"If a plan, chat, or piece of generated code contradicts this doc, this doc wins."* Contract sources are frozen at v0.1.0: `contracts/openapi.yaml`, `contracts/events.md`. Behavioral sources: `docs/design/state-machines.md`, `docs/design/screen-inventory.md`.

**The client boundary (frontend-conventions §1).** *"No component may import `fetch`, `axios`, or `WebSocket` directly. The ONLY network boundary is the `EduscopeClient` interface in `packages/api-client`."* Data flows via TanStack Query + the zustand WS store only. Commands are **202-async**: the UI reacts to WS state transitions, never assumes success.

**Contract honesty (frontend-conventions §5).** *"every mock response validates against the zod schemas from `contracts/`."*

**Scenario catalog (frontend-conventions §4).** Exactly these seven names, **extended, never forked**: `happy`, `start-fails`, `pipeline-crash-midway`, `llm-timeout`, `disk-full`, `ws-flap`, `quiz-network-loss`.

**Design tokens (frontend-conventions §6).** Source of truth is the token sheet in `docs/design/screen-inventory.md` §8, ported from `/prototype`. *"Keep the custom-properties approach — do not convert tokens to Tailwind utilities."* No new ad-hoc colors, spacing, or type sizes. `/prototype` context/mock logic **may not** be ported: `COUNTDOWN_SPEED`, `simulateResponses`, `INITIAL_*` seeds, `useMicLevels` and all simulated timers/rosters are prototype-only.

**Kiosk constraints (frontend-conventions §3, screen-inventory §0.4).** `apps/panel` is a fixed **1280×800** viewport; the page itself never scrolls, regions scroll internally. Touch targets ≥ **44 px**. No hover-only affordances. `aria-label` on every icon-only control. Overlays are `position: absolute` inside `.us-panel` — **never** `position: fixed`.

**Quiz app constraints (screen-inventory §6).** Portrait 360–430 px; answer targets ≥ **64 px** tall and full-width; nothing in the bottom 24 px; no hover at all; text ≥ **16 px** so iOS does not zoom on focus.

**Routing (screen-inventory SI-D-1 / SI-D-2).** The panel has a router. Overlays (modals, dialogs, lightboxes, confirms) are **UI-local state, not URLs**. Deep-linking is explicitly not a goal.

**Ids and instants (openapi.yaml Conventions).** Ids are **ULIDs** matching `^[0-9A-HJKMNP-TV-Z]{26}$`. Instants are **ISO-8601 with an explicit offset, stored UTC**. Pagination is cursor-based: `?cursor=&limit=` → `{ items, nextCursor }`.

**Version floors.** Node ≥ **22.11** (`.nvmrc`, `engines.node`). pnpm ≥ **9.12**. TypeScript ≥ **5.6** with `strict: true`. React **18.3.x** across the whole workspace — this is why `apps/quiz` pins Next.js **14.2.x** (Next 15's App Router requires React 19). Vite ≥ **7**, Vitest ≥ **3**, Tailwind CSS **4.x**, react-router **7.x**, TanStack Query **5.x**, zustand **5.x**, Playwright ≥ **1.48**.

**Scope rule.** No screen implementation beyond skeletons. Screens are prompt 09. A route file in this plan renders a named placeholder and its role gate — nothing else.

**Timers (state-machines §9).** Used by the mock and the store; no value is invented:

| Id | Value | Id | Value |
|---|---|---|---|
| `T-START-CONFIRM` | 5 s | `T-CMD-RESOLVE` | 10 s |
| `T-RESUME-CONFIRM` | 3 s | `T-WS-STALE` | 10 s |
| `T-PAUSE-EOS` | 5 s | `T-WS-RECONNECT` | 0.5, 1, 2, 4, 8 s capped 10 s, unlimited |
| `T-STOP-EOS` | 8 s | `T-COUNTDOWN-RESYNC` | 15 s |
| `T-CHANNEL-START` | 6 s | `T-LLM-REQUEST` | 45 s |
| `T-SOURCE-DEGRADE` | 2 s | `T-LLM-RETRY` | 10 s, 30 s |
| `T-SOURCE-OFFLINE` | 10 s | `T-LLM-PROBE` | 60 s |
| `T-SOURCE-DEBOUNCE` | 3 s | `T-PUBLISH-ACK` | 5 s, 1 retry at 2 s |
| `T-HEALTH-STALE` | 6 s | `T-QUIZ-CREATE` | 8 s, 2 retries |
| `T-STORAGE-PROBE-REC` | 10 s | `T-QUIZ-HEARTBEAT` | 5 s |
| `T-STORAGE-PROBE-IDLE` | 60 s | `T-QUIZ-SYNC-STALE` | 15 s |
| `T-CONSUMER-RESTART` | 1 s, 3 s, 8 s (max 3 / 120 s) | `T-QUIZ-SYNC-FAIL` | 60 s |
| `T-ALERT-REEVALUATE` | 30 s | `T-BOOT-RECOVERY` | 20 s |

**Known contract gaps this scaffold must not paper over.**

- **CG-1** (screen-inventory §10, events.md C-6): the student-facing REST surface (join, register, answer) **does not exist**. `apps/quiz`'s REST client interface is therefore provisional and is marked as such in code. Only `StudentServerEvent` payloads are contract-backed.
- **quiz-sync operations are excluded from `EduscopeClient` by design.** `openapi.yaml` tag `quiz-sync` says these paths are *"HOSTED BY THE QUIZ SERVICE … the device is the client"* — they are core-api → quiz-service, server-to-server, and no browser ever calls them. The four excluded operationIds are `quizSyncCreateSession`, `quizSyncCloseSession`, `quizSyncPublish`, `quizSyncClosePublication`. The coverage test in Task 5 asserts *exactly* this exclusion set, so the omission is enforced rather than assumed.

**Commit discipline.** One commit per task, at the end of the task, using the message given in that task's final step.

---

## File Structure

```
pnpm-workspace.yaml                     # workspace globs
package.json                            # root scripts: typecheck / lint / test / e2e
tsconfig.base.json                      # strict TS base every package extends
eslint.config.js                        # flat config incl. the client-boundary rule
.nvmrc                                  # 22.11.0
.github/workflows/ci.yml                # typecheck, lint, unit, Playwright smoke

packages/shared/
  package.json
  tsconfig.json
  codegen.config.ts                     # openapi.yaml -> generated zod
  src/
    index.ts                            # public barrel — the only import path consumers use
    schemas/rest.ts                     # re-export + name-adapter over generated output
    schemas/events.ts                   # HAND-AUTHORED from contracts/events.md
    schemas/generated/                  # codegen output, committed
    constants/timers.ts                 # state-machines §9
    constants/operations.ts             # the 77 panel-facing operationIds
  test/
    rest-coverage.test.ts               # every openapi schema has a zod export
    events-coverage.test.ts             # every events.md §2 event is in the union

packages/api-client/
  package.json
  tsconfig.json
  src/
    index.ts
    client.ts                           # EduscopeClient interface — the boundary
    stream.ts                           # EventStream / Unsubscribe / ConnectionStatus
    errors.ts                           # NotImplementedError, ProblemError
    real/create-real-client.ts          # STUB — every method throws NotImplementedError
    mock/
      create-mock-client.ts             # assembles world + rest + events
      world.ts                          # MockWorld: clock, entities, machine states, emitter
      clock.ts                          # virtual clock (test) / wall clock (browser)
      machines/types.ts                 # MachineDef, Transition, Effect
      machines/recording.ts             # 1a R-01..R-22, BR-1..BR-9
      machines/channel.ts               # 1c CH-01..CH-10
      machines/ai.ts                    # 2a Q-01..Q-10, 2b Q-11..Q-17, 2d Q-30..Q-36
      machines/quiz.ts                  # 4a Z-01..Z-06, 4d Z-30..Z-33
      machines/health.ts                # 5a HL-01..HL-09, 5b HL-10..HL-14
      commands.ts                       # operationId -> CommandPlan
      scenario/engine.ts                # forced-transition resolution
      scenario/registry.ts              # catalog + extendScenario()
      scenario/scripts/*.ts             # the seven named scripts
      rest/*.ts                         # the 77 mock operation implementations, by tag
      events/emitter.ts                 # envelope, seq, on-subscribe snapshot
      events/telemetry.ts               # throttled audio.levels, JPEG preview frames
      seed/*.ts                         # zod-validated seed fixtures
    quiz/quiz-app-client.ts             # PROVISIONAL — blocked on CG-1
  test/
    real-stub.test.ts
    operation-coverage.test.ts          # 100 % of contract operations
    event-coverage.test.ts              # 100 % of contract events
    contract-honesty.test.ts            # every mock response parses its zod schema
    scenario/*.test.ts

apps/panel/
  package.json  vite.config.ts  tsconfig.json  index.html
  src/
    main.tsx  App.tsx
    styles/tokens.css                   # ported from /prototype per conventions §6
    styles/app.css                      # shell-only; screens are prompt 09
    client/client-provider.tsx          # the single createMockClient/createRealClient call
    auth/auth-context.tsx  auth/require-role.tsx
    routes/router.tsx  routes/**/*.tsx  # skeletons only
    store/ws-store.ts                   # zustand, fed by client.events$
    store/connection.ts                 # U-2 stale / U-3 resync rules
    query/query-client.ts
    devtools/scenario-overlay.tsx       # long-press gated
  e2e/panel-smoke.spec.ts
  playwright.config.ts

apps/quiz/
  package.json  next.config.mjs  tsconfig.json  postcss.config.mjs
  app/
    layout.tsx  globals.css
    j/[joinCode]/page.tsx
    j/[joinCode]/register/page.tsx
    s/[quizSessionId]/page.tsx
  src/
    identity/identity-provider.ts       # SSO seam (A-16)
    identity/self-registration.ts
    client/quiz-client-provider.tsx

tools/eslint-rules/no-direct-network.js # the boundary rule
tools/eslint-rules/no-direct-network.test.ts
```

---

## Task 1: Workspace foundation

**Files:**
- Create: `pnpm-workspace.yaml`, `package.json`, `tsconfig.base.json`, `.nvmrc`, `.npmrc`, `vitest.workspace.ts`, `eslint.config.js`
- Modify: `.gitignore`
- Test: `tools/workspace.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the workspace globs `packages/*` and `apps/*`; root scripts `typecheck`, `lint`, `test`, `e2e`; the `tsconfig.base.json` every package extends (`strict: true`, `noUncheckedIndexedAccess: true`, `verbatimModuleSyntax: true`, `moduleResolution: "bundler"`); `vitest.workspace.ts` giving the app projects a `jsdom` environment and the React plugin; the **base** `eslint.config.js` (Task 17 adds the boundary block to it).

> **Why the lint and test configs land here and not later.** `pnpm lint` and `pnpm test` are declared as root scripts in this task, so they must work from this task. A root `vitest run` with no workspace file picks up `apps/**/*.test.tsx` under the default Node environment with no JSX transform, and every app suite fails — which would also make CI's `test` job (Task 20) and Gate 4 meaningless.

- [ ] **Step 1: Write the failing test**

Create `tools/workspace.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('workspace foundation', () => {
  it('declares both workspace globs', () => {
    const ws = read('pnpm-workspace.yaml');
    expect(ws).toContain('packages/*');
    expect(ws).toContain('apps/*');
  });

  it('pins the Node floor in .nvmrc and engines', () => {
    expect(read('.nvmrc').trim()).toBe('22.11.0');
    const pkg = JSON.parse(read('package.json')) as { engines?: { node?: string } };
    expect(pkg.engines?.node).toBe('>=22.11');
  });

  it('turns on the strictness the plan depends on', () => {
    const base = JSON.parse(read('tsconfig.base.json')) as {
      compilerOptions: Record<string, unknown>;
    };
    expect(base.compilerOptions.strict).toBe(true);
    expect(base.compilerOptions.noUncheckedIndexedAccess).toBe(true);
    expect(base.compilerOptions.verbatimModuleSyntax).toBe(true);
  });

  it('exposes the five root scripts CI runs', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    for (const s of ['typecheck', 'lint', 'test', 'build', 'e2e']) {
      expect(pkg.scripts[s], `missing root script: ${s}`).toBeTruthy();
    }
  });

  it('gives the app test projects a DOM environment', () => {
    const ws = read('vitest.workspace.ts');
    expect(ws).toContain('jsdom');
    expect(ws).toContain('apps/panel');
    expect(ws).toContain('apps/quiz');
  });

  it('lints from task 1 — the root script must not be dead for 16 tasks', () => {
    const config = read('eslint.config.js');
    // The a11y and hooks guardrails are cheapest to add before any screen exists.
    expect(config).toContain('react-hooks');
    expect(config).toContain('jsx-a11y');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tools/workspace.test.ts`
Expected: FAIL — `ENOENT: no such file or directory, open '.../pnpm-workspace.yaml'`

- [ ] **Step 3: Write the workspace files**

`.nvmrc`:

```
22.11.0
```

`.npmrc`:

```
engine-strict=true
auto-install-peers=true
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - 'packages/*'
  - 'apps/*'
```

`package.json`:

```json
{
  "name": "eduscope",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@9.12.3",
  "engines": { "node": ">=22.11" },
  "scripts": {
    "typecheck": "pnpm -r --parallel typecheck",
    "lint": "eslint .",
    "test": "vitest run",
    "build": "pnpm -r --filter \"./apps/*\" build",
    "e2e": "pnpm --filter @eduscope/panel e2e",
    "dev:panel": "pnpm --filter @eduscope/panel dev",
    "dev:quiz": "pnpm --filter @eduscope/quiz dev"
  },
  "devDependencies": {
    "@eslint/js": "^9.14.0",
    "@types/node": "^22.9.0",
    "@vitejs/plugin-react": "^4.3.3",
    "eslint": "^9.14.0",
    "eslint-plugin-jsx-a11y": "^6.10.2",
    "eslint-plugin-react-hooks": "^5.0.0",
    "globals": "^15.12.0",
    "jsdom": "^25.0.1",
    "typescript": "^5.6.3",
    "typescript-eslint": "^8.14.0",
    "vitest": "^3.0.0"
  }
}
```

`vitest.workspace.ts`:

```ts
import { defineWorkspace } from 'vitest/config';

/**
 * Without this, a root `vitest run` executes the app suites (.test.tsx) under
 * the default Node environment with no JSX transform and they all fail — which
 * would make CI's `test` job and Gate 4 meaningless.
 *
 * The two globs delegate to each package's own vitest config, so
 * `pnpm --filter @eduscope/panel test` (used throughout this plan) and a root
 * `pnpm test` run byte-identical settings. Only the root-level `tools/` suite,
 * which belongs to no package, is configured inline.
 */
export default defineWorkspace([
  'packages/*',
  'apps/*',
  {
    test: {
      name: 'tools',
      environment: 'node',
      include: ['tools/**/*.test.ts'],
    },
  },
]);
```

Each package therefore needs a vitest config. `packages/shared/vitest.config.ts` and `packages/api-client/vitest.config.ts` are both:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
```

`eslint.config.js` — the **base**. Task 17 appends the client-boundary block to this same file:

```js
import js from '@eslint/js';
import globals from 'globals';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**', '**/build/**', '**/.next/**', '**/node_modules/**',
      '**/coverage/**', '**/playwright-report/**', '**/test-results/**',
      'packages/shared/src/schemas/generated/**', // codegen output
      'prototype/**', 'legacy-Codebase/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    files: ['apps/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // The scaffold's central risk is re-render discipline (Task 15).
      'react-hooks/exhaustive-deps': 'error',
      // frontend-conventions §3: aria-label on every icon-only control. The
      // panel is a touch kiosk with no keyboard and no screen reader to fall
      // back on, so this is enforced from before the first screen exists.
      'jsx-a11y/alt-text': 'error',
      'jsx-a11y/anchor-has-content': 'error',
      'jsx-a11y/aria-props': 'error',
      'jsx-a11y/aria-role': 'error',
      'jsx-a11y/control-has-associated-label': 'error',
      'jsx-a11y/label-has-associated-control': 'error',
      'jsx-a11y/no-autofocus': 'error',
      'jsx-a11y/role-has-required-aria-props': 'error',
    },
  },
);
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "moduleDetection": "force",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

Append to `.gitignore`:

```
.turbo/
coverage/
playwright-report/
test-results/
*.tsbuildinfo
```

- [ ] **Step 4: Install and run the test to verify it passes**

Run: `pnpm install`
Expected: `Done in …` with no `ERR_PNPM_UNSUPPORTED_ENGINE`.

Run: `pnpm test tools/workspace.test.ts`
Expected: PASS — `Test Files 1 passed`, `Tests 6 passed`.

Run: `pnpm lint`
Expected: exit 0 with no output. This is the assertion that matters — the root script must not be dead until Task 17.

- [ ] **Step 5: Commit**

```bash
git add pnpm-workspace.yaml package.json tsconfig.base.json vitest.workspace.ts eslint.config.js .nvmrc .npmrc .gitignore tools/workspace.test.ts pnpm-lock.yaml
git commit -m "chore: pnpm workspace foundation with strict TS, lint and test configs"
```

---

## Task 2: packages/shared — zod mirror of openapi.yaml

**Files:**
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/codegen.config.ts`, `packages/shared/src/schemas/rest.ts`
- Create (generated, committed): `packages/shared/src/schemas/generated/zod.gen.ts`, `packages/shared/src/schemas/generated/types.gen.ts`
- Test: `packages/shared/test/rest-coverage.test.ts`

**Interfaces:**
- Consumes: Task 1's `tsconfig.base.json`.
- Produces: package `@eduscope/shared`. From `./src/schemas/rest.ts`: a zod schema exported as `z<SchemaName>` for **every** key under `components.schemas` in `contracts/openapi.yaml` (e.g. `zUser`, `zProblem`, `zCommandAccepted`, `zRecordingStateSnapshot`), and the inferred type under the bare contract name (`User`, `Problem`, `CommandAccepted`, …). Also `zPage<T>(item)` for the cursor envelope.

> **Why codegen, and where the seam is.** `contracts/openapi.yaml` is machine-readable and has ~120 schemas; hand-transcribing them would drift. The generator is `@hey-api/openapi-ts` with its zod plugin. Its *output naming* is the one thing this task cannot verify in advance — that is exactly what Step 1's test pins down. If the generator emits different identifiers, **fix it in one place**: the name-adapter block in `src/schemas/rest.ts`. Do not edit files under `generated/` by hand.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/test/rest-coverage.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as rest from '../src/schemas/rest.js';

const spec = readFileSync(
  resolve(__dirname, '../../../contracts/openapi.yaml'),
  'utf8',
);

/** Names under `components.schemas` — 4-space indent, directly after the block header. */
function contractSchemaNames(): string[] {
  const lines = spec.split('\n');
  const start = lines.findIndex((l) => l.trimEnd() === '  schemas:');
  expect(start, 'components.schemas block not found').toBeGreaterThan(-1);
  const names: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^ {0,3}\S/.test(line)) break; // dedented out of components
    const m = /^ {4}([A-Za-z][A-Za-z0-9]*):\s*$/.exec(line);
    if (m?.[1]) names.push(m[1]);
  }
  return names;
}

describe('rest schema coverage', () => {
  const names = contractSchemaNames();

  it('finds the contract schemas', () => {
    expect(names.length).toBeGreaterThan(100);
    expect(names).toContain('RecordingStateSnapshot');
    expect(names).toContain('Problem');
  });

  it('exports a zod schema for every contract schema', () => {
    const missing = names.filter((n) => !(`z${n}` in rest));
    expect(missing, `no zod export for: ${missing.join(', ')}`).toEqual([]);
  });

  it('parses a valid RecordingStateSnapshot including its nullable fields', () => {
    const idle = {
      state: 'idle',
      startReason: null,
      sessionId: null,
      title: null,
      ownerUserId: null,
      ownerDisplayName: null,
      startedAt: null,
      recordedDurationMs: null,
      segmentIndex: null,
      segmentCount: null,
      pauseCount: null,
      takeoverBy: null,
      errorCode: null,
      errorMessage: null,
    };
    expect(rest.zRecordingStateSnapshot.parse(idle)).toMatchObject({ state: 'idle' });
  });

  it('rejects a non-ULID id', () => {
    expect(() => rest.zUlid.parse('not-a-ulid')).toThrow();
    expect(rest.zUlid.parse('01JBQ8ZK3T7WBM5N2Q4XPRVC9D')).toBeTruthy();
  });

  it('exposes the cursor-pagination envelope', () => {
    const page = rest.zPage(rest.zUlid);
    expect(page.parse({ items: [], nextCursor: null })).toEqual({
      items: [],
      nextCursor: null,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @eduscope/shared test`
Expected: FAIL — `Failed to resolve import "../src/schemas/rest.js"`

- [ ] **Step 3: Create the package and generate the schemas**

`packages/shared/package.json`:

```json
{
  "name": "@eduscope/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts", "./schemas": "./src/schemas/rest.ts" },
  "scripts": {
    "codegen": "openapi-ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": { "zod": "^3.23.8" },
  "devDependencies": {
    "@hey-api/openapi-ts": "^0.64.0",
    "typescript": "^5.6.3",
    "vitest": "^3.0.0"
  }
}
```

`packages/shared/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": ".", "noEmit": true },
  "include": ["src", "test", "codegen.config.ts"]
}
```

`packages/shared/codegen.config.ts`:

```ts
import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: '../../contracts/openapi.yaml',
  // No `format:` option — that would pull in prettier, which this workspace does
  // not use. `generated/` is ESLint-ignored and never hand-read; the coverage
  // test, not its formatting, is what makes it trustworthy.
  output: { path: 'src/schemas/generated' },
  plugins: [
    { name: '@hey-api/typescript', exportInlineEnums: true },
    { name: 'zod', exportFromIndex: false },
  ],
});
```

Run: `pnpm --filter @eduscope/shared codegen`
Expected: writes `src/schemas/generated/types.gen.ts` and `src/schemas/generated/zod.gen.ts`.

- [ ] **Step 4: Write the re-export + name adapter**

`packages/shared/src/schemas/rest.ts`:

```ts
/**
 * The zod mirror of contracts/openapi.yaml, promised by that file's Conventions
 * block ("The zod mirror of every schema lives in packages/shared/src/schemas/").
 *
 * `generated/` is codegen output — never edit it. If the generator's identifiers
 * do not match the contract names, adapt them HERE and only here; the coverage
 * test in test/rest-coverage.test.ts is the gate.
 */
import { z } from 'zod';

export * from './generated/zod.gen.js';
export type * from './generated/types.gen.js';

/** Cursor pagination envelope (openapi.yaml Conventions: `{ items, nextCursor }`). */
export const zPage = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

export type Page<T> = { items: T[]; nextCursor: string | null };
```

If `pnpm --filter @eduscope/shared test` reports missing `z<Name>` exports, append explicit aliases below the barrel — for example:

```ts
// ── name adapter: generator identifier -> contract name ────────────────────
import * as gen from './generated/zod.gen.js';
export const zUlid = gen.zUlid ?? z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @eduscope/shared test`
Expected: PASS — `Tests 5 passed`. The third assertion's failure message names every uncovered schema, so a partial generator run is visible immediately.

- [ ] **Step 6: Commit**

```bash
git add packages/shared package.json pnpm-lock.yaml
git commit -m "feat(shared): zod mirror of openapi.yaml with schema coverage test"
```

---

## Task 3: packages/shared — WS event schemas

**Files:**
- Create: `packages/shared/src/schemas/events.ts`
- Test: `packages/shared/test/events-coverage.test.ts`

**Interfaces:**
- Consumes: `zPage`, `zUlid`, `zInstant`, and the entity schemas from Task 2's `./rest.js`.
- Produces: `zEventEnvelope`, `zPanelServerEvent` (discriminated union on `event`), `PANEL_EVENT_NAMES` (the 22 names), the per-event payload schemas (`zRecordingStatePayload`, `zAudioLevelsPayload`, …), `zPreviewClientMessage`, `zPreviewServerMessage`, `zQuizSyncClientMessage`, `zQuizSyncServerMessage`, `zStudentServerEvent`, and the inferred types `PanelServerEvent`, `EventEnvelope<T>`, `PreviewClientMessage`, `PreviewServerMessage`, `StudentServerEvent`.

> `contracts/events.md` is prose, not a machine-readable spec — these schemas are hand-authored from its §2/§3/§4 tables, which is why the coverage test parses the markdown headings rather than trusting the author.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/test/events-coverage.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PANEL_EVENT_NAMES,
  zEventEnvelope,
  zPanelServerEvent,
  zPreviewClientMessage,
  zPreviewServerMessage,
} from '../src/schemas/events.js';

const catalog = readFileSync(
  resolve(__dirname, '../../../contracts/events.md'),
  'utf8',
);

/** §2 headings look like: `### 2.7 `audio.control` *(v0 addition)*` */
function contractEventNames(): string[] {
  return [...catalog.matchAll(/^### 2\.\d+ `([a-z.]+)`/gm)].map((m) => m[1]!);
}

describe('event catalog coverage', () => {
  const names = contractEventNames();

  it('reads 22 events out of contracts/events.md §2', () => {
    expect(names).toHaveLength(22);
    expect(names).toContain('recording.state');
    expect(names).toContain('firmware.state');
  });

  it('declares exactly the contract event names', () => {
    expect([...PANEL_EVENT_NAMES].sort()).toEqual([...names].sort());
  });

  it('has a union member for every event name', () => {
    const members = new Set(
      zPanelServerEvent.options.map((o) => o.shape.event.value as string),
    );
    const missing = names.filter((n) => !members.has(n));
    expect(missing, `no union member for: ${missing.join(', ')}`).toEqual([]);
  });

  it('validates an envelope with seq and an ISO instant', () => {
    const parsed = zEventEnvelope.parse({
      event: 'audio.levels',
      at: '2026-07-30T09:00:00+00:00',
      seq: 41,
      payload: { roleId: 'mic-lecturer', rms: 0.42 },
    });
    expect(parsed.seq).toBe(41);
  });

  it('rejects an rms outside 0–1 (events.md §2.6)', () => {
    expect(() =>
      zPanelServerEvent.parse({
        event: 'audio.levels',
        payload: { roleId: 'mic-lecturer', rms: 1.7 },
      }),
    ).toThrow();
  });

  it('models the preview socket in both directions (events.md §3)', () => {
    expect(
      zPreviewClientMessage.parse({
        type: 'offer',
        negotiationId: '01JBQ8ZK3T7WBM5N2Q4XPRVC9D',
        roleId: 'lecturer-cam',
        sdp: 'v=0',
      }).type,
    ).toBe('offer');
    expect(
      zPreviewServerMessage.parse({
        type: 'error',
        negotiationId: '01JBQ8ZK3T7WBM5N2Q4XPRVC9D',
        code: 'source-offline',
        message: 'No signal',
      }).type,
    ).toBe('error');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @eduscope/shared test events-coverage`
Expected: FAIL — `Failed to resolve import "../src/schemas/events.js"`

- [ ] **Step 3: Write the event schemas**

Create `packages/shared/src/schemas/events.ts`:

```ts
/**
 * Hand-authored mirror of contracts/events.md v0.1.0 — §2 panel/admin events,
 * §3 WebRTC preview signaling, §4 device<->quiz-server sync. Both the Phase-2
 * mock adapter and the Phase-4 backend validate against these.
 */
import { z } from 'zod';
import {
  zAiCountdownState,
  zCaptureCardState,
  zChannelId,
  zChannelRuntimeState,
  zExportJobState,
  zFirmwareUpdate,
  zInstant,
  zLayoutPresetId,
  zLogEntry,
  zMergeState,
  zPublicationCloseReason,
  zProjectorState,
  zQuestionSetState,
  zQuestionState,
  zQuizSessionProjectionState,
  zQuizSyncState,
  zRecordingWireState,
  zRetentionPolicy,
  zSegmentEndReason,
  zSegmentState,
  zSmartStatus,
  zSourceHealthState,
  zSourceRoleId,
  zStoragePressure,
  zSystemAlert,
  zUlid,
  zUploadFilePartState,
  zUploadJobState,
  zUsbVolume,
} from './rest.js';

// ── §2 payloads ────────────────────────────────────────────────────────────

/** §2.1 — startedAt/recordedDurationMs drive a LOCAL tick; no per-second events. */
export const zRecordingStatePayload = z.object({
  state: zRecordingWireState,
  startReason: z.enum(['initial', 'resume', 'recovery']).nullable(),
  sessionId: zUlid.nullable(),
  title: z.string().nullable(),
  ownerUserId: zUlid.nullable(),
  ownerDisplayName: z.string().nullable(),
  startedAt: zInstant.nullable(),
  recordedDurationMs: z.number().int().nullable(),
  segmentIndex: z.number().int().nullable(),
  segmentCount: z.number().int().nullable(),
  pauseCount: z.number().int().nullable(),
  takeoverBy: zUlid.nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  adopted: z.boolean().optional(),
});

/** §2.2 */
export const zRecordingSegmentPayload = z.object({
  sessionId: zUlid,
  recordingId: zUlid,
  segmentId: zUlid,
  index: z.number().int(),
  state: zSegmentState,
  endReason: zSegmentEndReason.nullable(),
  durationMs: z.number().int().nullable(),
});

/** §2.3 */
export const zRecordingArtifactPayload = z.object({
  recordingId: zUlid,
  sessionId: zUlid,
  state: z.enum(['capturing', 'finalizing', 'merging', 'ready', 'failed', 'deleted']),
  mergeState: zMergeState,
  durationMs: z.number().int().nullable(),
  totalBytes: z.number().int().nullable(),
  deleteReason: z.string().nullable(),
});

/** §2.4 */
export const zChannelStatePayload = z.object({
  channelId: zChannelId,
  state: zChannelRuntimeState,
  presetId: zLayoutPresetId,
  ratioA: z.number().int().nullable(),
  ratioB: z.number().int().nullable(),
  reason: z.string().nullable(),
});

/** §2.5 */
export const zSourcesStatusPayload = z.object({
  roleId: zSourceRoleId,
  state: zSourceHealthState,
  detail: z.string().nullable(),
  since: zInstant,
  inputId: zUlid.nullable(),
});

/** §2.6 — throttled to <= 10 Hz, panel connections only. Telemetry, never rows. */
export const zAudioLevelsPayload = z.object({
  roleId: zSourceRoleId,
  rms: z.number().min(0).max(1),
});

/** §2.7 — appliedState is the truth the UI shows (INV-AC-1). */
export const zAudioControlPayload = z.object({
  roleId: zSourceRoleId,
  gain: z.number().int().min(0).max(100),
  muted: z.boolean(),
  appliedState: z.enum(['applied', 'pending', 'failed']),
  lastError: z.string().nullable(),
});

/** §2.8 — carries the full policy so warning text quotes real values (INV-RP-1). */
export const zStorageStatusPayload = z.object({
  pressure: zStoragePressure,
  freeBytes: z.number().int(),
  totalBytes: z.number().int(),
  policy: zRetentionPolicy,
});

/** §2.9 */
export const zDeviceHealthPayload = z.object({
  captureCardState: zCaptureCardState,
  publisherStates: z.array(z.object({ id: z.string(), state: z.string() })),
  ntpSynced: z.boolean(),
  clockOffsetMs: z.number().int().nullable(),
  diskHealth: zSmartStatus,
  lastBootAt: zInstant,
});

/** §2.12 — nextAt is absolute; the panel ticks locally (INV-G-7). */
export const zAiCountdownPayload = z.object({
  state: zAiCountdownState,
  remainingMs: z.number().int().nullable(),
  nextAt: zInstant.nullable(),
  intervalMinutes: z.union([z.literal(10), z.literal(15), z.literal(20), z.literal(30)]),
});

/** §2.13 — supersedes ai.batch_ready; state `ready` IS batch-ready. */
export const zAiSetPayload = z.object({
  setId: zUlid,
  sessionId: zUlid,
  state: zQuestionSetState,
  trigger: z.enum(['countdown', 'manual']),
  count: z.number().int().nullable(),
  error: z.enum(['timeout', 'unreachable', 'invalid-payload']).nullable(),
  attempt: z.number().int(),
});

/** §2.14 — setId null = lecturer-authored ("Yours" chip). */
export const zAiQuestionPayload = z.object({
  questionId: zUlid,
  setId: zUlid.nullable(),
  state: zQuestionState,
  provenance: z.enum(['generated', 'lecturer-authored']),
  edited: z.boolean(),
});

/** §2.15 */
export const zQuizSessionPayload = z.object({
  state: zQuizSessionProjectionState,
  quizSessionId: zUlid.nullable(),
  joinUrl: z.string().nullable(),
  joinCode: z.string().nullable(),
  joinedCount: z.number().int(),
});

/** §2.16 — exactly one publication may carry isShowing (INV-QPUB-1). */
export const zQuizPublicationPayload = z.object({
  publicationId: zUlid,
  questionId: zUlid,
  state: z.enum(['publishing', 'open', 'closed', 'failed']),
  isShowing: z.boolean(),
  projectorState: zProjectorState,
  syncState: zQuizSyncState,
  closeReason: zPublicationCloseReason.nullable(),
});

/** §2.17 — `stale` marks projections that must not be shown as current (INV-AP-2). */
export const zQuizResponsesPayload = z.object({
  publicationId: zUlid,
  deltas: z.array(
    z.object({
      studentIdNumber: z.string(),
      displayName: z.string(),
      selectedOptionId: zUlid,
      isCorrect: z.boolean(),
      responseTimeMs: z.number().int(),
      submittedAt: zInstant,
    }),
  ),
  syncedAt: zInstant,
  stale: z.boolean(),
});

/** §2.18 */
export const zUploadJobPayload = z.object({
  jobId: zUlid,
  recordingId: zUlid,
  state: zUploadJobState,
  attempt: z.number().int(),
  nextAttemptAt: zInstant.nullable(),
  progressPct: z.number().int().min(0).max(100),
  lastError: z.string().nullable(),
  blockedBy: z.string().nullable(),
});

/** §2.19 */
export const zUploadPartPayload = z.object({
  partId: zUlid,
  jobId: zUlid,
  streamKey: z.string(),
  state: zUploadFilePartState,
  bytesSent: z.number().int(),
  bytesTotal: z.number().int(),
});

/** §2.20 — real transfer bytes, never free-space arithmetic (INV-EX-1). */
export const zExportJobPayload = z.object({
  jobId: zUlid,
  state: zExportJobState,
  bytesCopied: z.number().int(),
  bytesTotal: z.number().int(),
  error: z.string().nullable(),
});

/** §2.21 — system and recordings volumes are never listed (INV-EX-2). */
export const zUsbVolumesPayload = z.object({ volumes: z.array(zUsbVolume) });

// ── §2 union ───────────────────────────────────────────────────────────────

export const zPanelServerEvent = z.discriminatedUnion('event', [
  z.object({ event: z.literal('recording.state'), payload: zRecordingStatePayload }),
  z.object({ event: z.literal('recording.segment'), payload: zRecordingSegmentPayload }),
  z.object({ event: z.literal('recording.artifact'), payload: zRecordingArtifactPayload }),
  z.object({ event: z.literal('channel.state'), payload: zChannelStatePayload }),
  z.object({ event: z.literal('sources.status'), payload: zSourcesStatusPayload }),
  z.object({ event: z.literal('audio.levels'), payload: zAudioLevelsPayload }),
  z.object({ event: z.literal('audio.control'), payload: zAudioControlPayload }),
  z.object({ event: z.literal('storage.status'), payload: zStorageStatusPayload }),
  z.object({ event: z.literal('device.health'), payload: zDeviceHealthPayload }),
  z.object({ event: z.literal('system.alert'), payload: zSystemAlert }),
  z.object({ event: z.literal('log.entry'), payload: zLogEntry }),
  z.object({ event: z.literal('ai.countdown'), payload: zAiCountdownPayload }),
  z.object({ event: z.literal('ai.set'), payload: zAiSetPayload }),
  z.object({ event: z.literal('ai.question'), payload: zAiQuestionPayload }),
  z.object({ event: z.literal('quiz.session'), payload: zQuizSessionPayload }),
  z.object({ event: z.literal('quiz.publication'), payload: zQuizPublicationPayload }),
  z.object({ event: z.literal('quiz.responses'), payload: zQuizResponsesPayload }),
  z.object({ event: z.literal('upload.job'), payload: zUploadJobPayload }),
  z.object({ event: z.literal('upload.part'), payload: zUploadPartPayload }),
  z.object({ event: z.literal('export.job'), payload: zExportJobPayload }),
  z.object({ event: z.literal('usb.volumes'), payload: zUsbVolumesPayload }),
  z.object({ event: z.literal('firmware.state'), payload: zFirmwareUpdate }),
]);

export type PanelServerEvent = z.infer<typeof zPanelServerEvent>;
export type PanelEventName = PanelServerEvent['event'];

/** The closed catalog. Anything not here does not exist (state-machines SM-R-3). */
export const PANEL_EVENT_NAMES = [
  'recording.state',
  'recording.segment',
  'recording.artifact',
  'channel.state',
  'sources.status',
  'audio.levels',
  'audio.control',
  'storage.status',
  'device.health',
  'system.alert',
  'log.entry',
  'ai.countdown',
  'ai.set',
  'ai.question',
  'quiz.session',
  'quiz.publication',
  'quiz.responses',
  'upload.job',
  'upload.part',
  'export.job',
  'usb.volumes',
  'firmware.state',
] as const satisfies readonly PanelEventName[];

/** §1 envelope: `seq` is per-connection and monotonic; a gap forces a full resync. */
export const zEventEnvelope = zPanelServerEvent.and(
  z.object({ at: zInstant, seq: z.number().int().nonnegative() }),
);
export type EventEnvelope = z.infer<typeof zEventEnvelope>;

// ── §3 WebRTC preview signaling (separate socket, no seq) ───────────────────

export const zPreviewClientMessage = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('offer'),
    negotiationId: zUlid,
    roleId: zSourceRoleId,
    sdp: z.string(),
  }),
  z.object({
    type: z.literal('ice'),
    negotiationId: zUlid,
    candidate: z.string(),
    sdpMid: z.string().nullable(),
    sdpMLineIndex: z.number().int().nullable(),
  }),
  z.object({ type: z.literal('close'), negotiationId: zUlid }),
]);

export const zPreviewServerMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('answer'), negotiationId: zUlid, sdp: z.string() }),
  z.object({
    type: z.literal('ice'),
    negotiationId: zUlid,
    candidate: z.string(),
    sdpMid: z.string().nullable(),
    sdpMLineIndex: z.number().int().nullable(),
  }),
  z.object({
    type: z.literal('error'),
    negotiationId: zUlid,
    code: z.enum(['source-offline', 'source-unbound', 'busy', 'internal']),
    message: z.string(),
  }),
]);

export type PreviewClientMessage = z.infer<typeof zPreviewClientMessage>;
export type PreviewServerMessage = z.infer<typeof zPreviewServerMessage>;

// ── §4 device <-> quiz-server sync stream ──────────────────────────────────

export const zQuizSyncClientMessage = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('sync.hello'),
    deviceId: zUlid,
    quizSessionId: zUlid,
    answerWatermark: z.number().int(),
  }),
  z.object({ type: z.literal('sync.heartbeat'), at: zInstant }),
]);

export const zQuizSyncServerMessage = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('sync.answers'),
    quizSessionId: zUlid,
    answers: z.array(
      z.object({
        seq: z.number().int(),
        answerId: zUlid,
        publicationId: zUlid,
        studentIdNumber: z.string(),
        studentDisplayName: z.string(),
        selectedOptionId: zUlid,
        isCorrect: z.boolean(),
        responseTimeMs: z.number().int(),
        submittedAt: zInstant,
      }),
    ),
  }),
  z.object({
    type: z.literal('sync.participants'),
    quizSessionId: zUlid,
    joinedCount: z.number().int(),
    onlineCount: z.number().int(),
  }),
  z.object({ type: z.literal('sync.heartbeat'), at: zInstant }),
]);

// ── §4 note: student-facing events, shared with apps/quiz ──────────────────

export const zStudentServerEvent = z.discriminatedUnion('event', [
  z.object({
    event: z.literal('quiz.question'),
    payload: z.object({
      publicationId: zUlid,
      state: z.enum(['open', 'closed', 'none']),
      prompt: z.string(),
      options: z.array(
        z.object({ id: zUlid, label: z.string(), text: z.string() }),
      ),
      ownAnswer: zUlid.nullable(),
    }),
  }),
  z.object({
    event: z.literal('quiz.result'),
    payload: z.object({
      publicationId: zUlid,
      isCorrect: z.boolean().nullable(),
      correctOptionId: zUlid,
      pointsAwarded: z.number().int(),
      runningScore: z.number().int(),
      ownRank: z.number().int().nullable(),
    }),
  }),
  z.object({
    event: z.literal('quiz.participant'),
    payload: z.object({ connectionState: z.enum(['online', 'offline']) }),
  }),
  z.object({
    event: z.literal('quiz.session'),
    payload: z.object({
      state: z.enum(['open', 'closed']),
      finalScore: z.number().int().nullable(),
      finalRank: z.number().int().nullable(),
      answeredCount: z.number().int().nullable(),
    }),
  }),
]);

export type StudentServerEvent = z.infer<typeof zStudentServerEvent>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @eduscope/shared test events-coverage`
Expected: PASS — `Tests 6 passed`.

If the third assertion fails naming an event, the union is missing a member; if the first fails with a count other than 22, `contracts/events.md` changed and this file must be re-derived from it.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/schemas/events.ts packages/shared/test/events-coverage.test.ts
git commit -m "feat(shared): hand-authored zod mirror of the WS event catalog"
```

---

## Task 4: packages/shared — timers, operation ids, public barrel

**Files:**
- Create: `packages/shared/src/constants/timers.ts`, `packages/shared/src/constants/operations.ts`, `packages/shared/src/index.ts`
- Test: `packages/shared/test/constants.test.ts`

**Interfaces:**
- Consumes: Task 2 + Task 3 exports.
- Produces: `TIMERS` (frozen record of the §9 catalog in **milliseconds**), `WS_RECONNECT_BACKOFF_MS`, `PANEL_OPERATION_IDS` (77 ids), `SERVER_SIDE_ONLY_OPERATION_IDS` (the 4 quiz-sync ids), and type `PanelOperationId`. `packages/shared/src/index.ts` is the only import path consumers use.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/test/constants.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PANEL_OPERATION_IDS,
  SERVER_SIDE_ONLY_OPERATION_IDS,
  TIMERS,
  WS_RECONNECT_BACKOFF_MS,
} from '../src/index.js';

const spec = readFileSync(
  resolve(__dirname, '../../../contracts/openapi.yaml'),
  'utf8',
);

const contractOperationIds = () =>
  [...spec.matchAll(/^\s+operationId:\s*(\w+)\s*$/gm)].map((m) => m[1]!);

describe('constants', () => {
  it('carries the state-machines §9 timer values in milliseconds', () => {
    expect(TIMERS['T-START-CONFIRM']).toBe(5_000);
    expect(TIMERS['T-STOP-EOS']).toBe(8_000);
    expect(TIMERS['T-CMD-RESOLVE']).toBe(10_000);
    expect(TIMERS['T-WS-STALE']).toBe(10_000);
    expect(TIMERS['T-COUNTDOWN-RESYNC']).toBe(15_000);
    expect(TIMERS['T-LLM-REQUEST']).toBe(45_000);
    expect(TIMERS['T-QUIZ-SYNC-FAIL']).toBe(60_000);
  });

  it('uses the §9 reconnect ladder capped at 10 s', () => {
    expect(WS_RECONNECT_BACKOFF_MS).toEqual([500, 1_000, 2_000, 4_000, 8_000, 10_000]);
  });

  it('partitions every contract operation into panel-facing or server-side', () => {
    const all = contractOperationIds();
    expect(all.length).toBe(81);
    const declared = [...PANEL_OPERATION_IDS, ...SERVER_SIDE_ONLY_OPERATION_IDS];
    expect([...declared].sort()).toEqual([...all].sort());
  });

  it('excludes exactly the four quiz-sync operations', () => {
    expect([...SERVER_SIDE_ONLY_OPERATION_IDS].sort()).toEqual([
      'quizSyncClosePublication',
      'quizSyncCloseSession',
      'quizSyncCreateSession',
      'quizSyncPublish',
    ]);
    expect(PANEL_OPERATION_IDS).toHaveLength(77);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @eduscope/shared test constants`
Expected: FAIL — `Failed to resolve import "../src/index.js"`

- [ ] **Step 3: Write the constants and the barrel**

`packages/shared/src/constants/timers.ts`:

```ts
/** state-machines.md §9 — milliseconds. No value here is invented. */
export const TIMERS = {
  'T-START-CONFIRM': 5_000,
  'T-RESUME-CONFIRM': 3_000,
  'T-PAUSE-EOS': 5_000,
  'T-STOP-EOS': 8_000,
  'T-SESSION-HEARTBEAT': 5_000,
  'T-RECOVERY-WINDOW': 600_000,
  'T-BOOT-RECOVERY': 20_000,
  'T-CHANNEL-START': 6_000,
  'T-STORAGE-PROBE-REC': 10_000,
  'T-STORAGE-PROBE-IDLE': 60_000,
  'T-HEALTH-STALE': 6_000,
  'T-SOURCE-DEGRADE': 2_000,
  'T-SOURCE-OFFLINE': 10_000,
  'T-SOURCE-DEBOUNCE': 3_000,
  'T-CAPTURE-PROBE': 30_000,
  'T-CAPTURE-RECOVER': 25_000,
  'T-LLM-REQUEST': 45_000,
  'T-LLM-PROBE': 60_000,
  'T-COUNTDOWN-RESYNC': 15_000,
  'T-PUBLISH-ACK': 5_000,
  'T-QUIZ-CREATE': 8_000,
  'T-QUIZ-PROBE': 30_000,
  'T-QUIZ-HEARTBEAT': 5_000,
  'T-QUIZ-SYNC-STALE': 15_000,
  'T-QUIZ-SYNC-FAIL': 60_000,
  'T-WS-STALE': 10_000,
  'T-CMD-RESOLVE': 10_000,
  'T-UPLOAD-STALL': 60_000,
  'T-ALERT-REEVALUATE': 30_000,
} as const;

export type TimerId = keyof typeof TIMERS;

/** §9 T-CONSUMER-RESTART — 1 s, 3 s, 8 s, max 3 attempts / 120 s. */
export const CONSUMER_RESTART_BACKOFF_MS = [1_000, 3_000, 8_000] as const;

/** §9 T-LLM-RETRY — 2 automatic retries. */
export const LLM_RETRY_BACKOFF_MS = [10_000, 30_000] as const;

/** §9 T-WS-RECONNECT — 0.5, 1, 2, 4, 8 s, capped 10 s, unlimited attempts. */
export const WS_RECONNECT_BACKOFF_MS = [500, 1_000, 2_000, 4_000, 8_000, 10_000] as const;
```

`packages/shared/src/constants/operations.ts`:

```ts
/**
 * Every operationId in contracts/openapi.yaml, partitioned.
 *
 * The `quiz-sync` tag is hosted BY the quiz service with core-api as the client
 * ("the device is the client because the public quiz zone cannot dial into the
 * campus LAN"), so no browser ever calls it and EduscopeClient must not carry it.
 * The partition is asserted against the spec in test/constants.test.ts.
 */
export const PANEL_OPERATION_IDS = [
  // auth (5)
  'login', 'refreshToken', 'logout', 'getMe', 'changePassword',
  // recording (6)
  'getRecordingState', 'startRecording', 'pauseRecording', 'resumeRecording',
  'stopRecording', 'takeoverRecording',
  // channels (5)
  'listChannels', 'updateChannelConfig', 'enableChannel', 'disableChannel',
  'listLayoutPresets',
  // sources (8)
  'listSourceRoles', 'getSourcesStatus', 'listPhysicalInputs', 'updatePhysicalInput',
  'listSourceBindings', 'updateSourceBinding', 'listAudioControls', 'updateAudioControl',
  // recordings + exports (8)
  'listRecordings', 'getRecording', 'deleteRecording', 'getRecordingMedia',
  'listExportTargets', 'createExport', 'getExport', 'cancelExport',
  // uploads (3)
  'listUploadJobs', 'getUploadJob', 'requeueUploadJob',
  // provisioning (2)
  'getProvisioning', 'getDeviceHealth',
  // device (3)
  'listAlerts', 'acknowledgeAlert', 'powerOffDevice',
  // storage (3)
  'getStorageOverview', 'registerStorageVolume', 'formatStorageVolume',
  // settings (8)
  'listNetworkConfigs', 'updateNetworkConfig', 'getEncoderSettings',
  'updateEncoderSettings', 'listStreamTargets', 'createStreamTarget',
  'updateStreamTarget', 'deleteStreamTarget',
  // firmware (3)
  'getFirmwareState', 'checkFirmware', 'applyFirmware',
  // users (5)
  'listUsers', 'createUser', 'updateUser', 'deleteUser', 'importUsers',
  // ai (13)
  'getAiCountdown', 'setAiInterval', 'generateNow', 'listQuestionSets',
  'getQuestionSet', 'listQuestions', 'createQuestion', 'editQuestion',
  'discardQuestion', 'sendToProjector', 'listPublications', 'closePublication',
  'setProjector',
  // quiz (3)
  'getQuizSession', 'listPublicationResponses', 'getLeaderboard',
  // logs (2)
  'queryLogs', 'exportLogsCsv',
] as const;

export type PanelOperationId = (typeof PANEL_OPERATION_IDS)[number];

/** Server-to-server; deliberately absent from EduscopeClient. */
export const SERVER_SIDE_ONLY_OPERATION_IDS = [
  'quizSyncCreateSession',
  'quizSyncCloseSession',
  'quizSyncPublish',
  'quizSyncClosePublication',
] as const;
```

`packages/shared/src/index.ts`:

```ts
export * from './schemas/rest.js';
export * from './schemas/events.js';
export * from './constants/timers.js';
export * from './constants/operations.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @eduscope/shared test`
Expected: PASS — all three suites, `Tests 15 passed`.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/constants packages/shared/src/index.ts packages/shared/test/constants.test.ts
git commit -m "feat(shared): timer catalog, operation partition, public barrel"
```

---

## Task 5: packages/api-client — the `EduscopeClient` boundary and the honest stub

**Files:**
- Create: `packages/api-client/package.json`, `packages/api-client/tsconfig.json`
- Create: `packages/api-client/src/stream.ts`, `src/errors.ts`, `src/client.ts`, `src/real/create-real-client.ts`, `src/index.ts`
- Test: `packages/api-client/test/operation-coverage.test.ts`, `packages/api-client/test/real-stub.test.ts`

**Interfaces:**
- Consumes: `@eduscope/shared` — `PANEL_OPERATION_IDS`, `SERVER_SIDE_ONLY_OPERATION_IDS`, `PANEL_EVENT_NAMES`, every `z*` schema and inferred type, `Page<T>`.
- Produces:
  - `type Unsubscribe = () => void`
  - `interface EventStream<T> { subscribe(listener: (value: T) => void): Unsubscribe }`
  - `type ConnectionStatus = { phase: 'connecting' | 'open' | 'reconnecting' | 'stale' | 'closed'; attempt: number; since: string }`
  - `class NotImplementedError extends Error` (`name === 'NotImplementedError'`)
  - `class ProblemError extends Error { readonly problem: Problem }`
  - `interface PreviewChannel { send(msg: PreviewClientMessage): void; messages$: EventStream<PreviewServerMessage>; close(): void }`
  - `interface EduscopeClient` — **77 methods**, one per `PanelOperationId`, plus `events$: EventStream<EventEnvelope>`, `connection$: EventStream<ConnectionStatus>`, `openPreview(): PreviewChannel`, `resync(): Promise<void>`, `dispose(): void`
  - `createRealClient(baseUrl: string): EduscopeClient`

> **Method signature rule** (applies to every one of the 77): path parameters first in declaration order, then the request body, then query params as a single optional object. Operations that openapi.yaml defines as `202 Accepted` return `Promise<CommandAccepted>`; `204` returns `Promise<void>`; list operations with a cursor return `Promise<Page<Item>>`.

- [ ] **Step 1: Write the failing tests**

Create `packages/api-client/test/operation-coverage.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  PANEL_EVENT_NAMES,
  PANEL_OPERATION_IDS,
  SERVER_SIDE_ONLY_OPERATION_IDS,
} from '@eduscope/shared';
import { createRealClient } from '../src/index.js';

const client = createRealClient('http://localhost:8080/api/v1') as unknown as Record<
  string,
  unknown
>;

describe('EduscopeClient covers the contract', () => {
  it('implements a method for every panel-facing operation', () => {
    const missing = PANEL_OPERATION_IDS.filter(
      (id) => typeof client[id] !== 'function',
    );
    expect(missing, `no client method for: ${missing.join(', ')}`).toEqual([]);
  });

  it('does NOT implement the server-to-server quiz-sync operations', () => {
    const leaked = SERVER_SIDE_ONLY_OPERATION_IDS.filter((id) => id in client);
    expect(leaked, `quiz-sync leaked into the browser client: ${leaked.join(', ')}`)
      .toEqual([]);
  });

  it('adds no methods beyond the contract plus the realtime surface', () => {
    const allowedExtras = new Set([
      'events$', 'connection$', 'openPreview', 'resync', 'dispose',
    ]);
    const contract = new Set<string>(PANEL_OPERATION_IDS);
    const extras = Object.keys(client).filter(
      (k) => !contract.has(k) && !allowedExtras.has(k),
    );
    expect(extras, `undocumented client surface: ${extras.join(', ')}`).toEqual([]);
  });

  it('exposes a realtime channel typed to the closed event catalog', () => {
    expect(typeof client.events$).toBe('object');
    expect(PANEL_EVENT_NAMES).toHaveLength(22);
  });
});
```

Create `packages/api-client/test/real-stub.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PANEL_OPERATION_IDS } from '@eduscope/shared';
import { NotImplementedError, createRealClient } from '../src/index.js';

describe('createRealClient is an honest Phase-4 stub', () => {
  const client = createRealClient('http://localhost:8080/api/v1') as unknown as Record<
    string,
    (...a: unknown[]) => unknown
  >;

  it.each(PANEL_OPERATION_IDS)('%s throws NotImplementedError("Phase 4")', (id) => {
    let thrown: unknown;
    try {
      client[id]!();
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(NotImplementedError);
    expect((thrown as Error).message).toContain('Phase 4');
    expect((thrown as Error).message).toContain(id);
  });

  it('throws rather than silently returning a dead subscription', () => {
    expect(() =>
      (client.events$ as unknown as { subscribe: () => void }).subscribe(),
    ).toThrow(NotImplementedError);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @eduscope/api-client test`
Expected: FAIL — `Failed to resolve import "../src/index.js"`

- [ ] **Step 3: Create the package**

`packages/api-client/package.json`:

```json
{
  "name": "@eduscope/api-client",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts", "./mock": "./src/mock/create-mock-client.ts" },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": { "@eduscope/shared": "workspace:*", "zod": "^3.23.8" },
  "devDependencies": { "typescript": "^5.6.3", "vitest": "^3.0.0" }
}
```

`packages/api-client/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": ".", "noEmit": true },
  "include": ["src", "test"]
}
```

- [ ] **Step 4: Write the stream and error primitives**

`packages/api-client/src/stream.ts`:

```ts
/** Zero-dependency push stream. No RxJS: the boundary must stay trivially mockable. */
export type Unsubscribe = () => void;

export interface EventStream<T> {
  subscribe(listener: (value: T) => void): Unsubscribe;
}

/** events.md §1 reconnect/staleness lifecycle; drives U-2 and U-3 in the panel. */
export interface ConnectionStatus {
  /** `stale` = disconnected longer than T-WS-STALE (10 s). */
  readonly phase: 'connecting' | 'open' | 'reconnecting' | 'stale' | 'closed';
  readonly attempt: number;
  readonly since: string;
  /** Set when a `seq` gap forced a full resync (events.md §1). */
  readonly resyncReason?: 'seq-gap' | 'reconnect';
}

export function createEmitter<T>(): EventStream<T> & {
  emit(value: T): void;
  size(): number;
} {
  const listeners = new Set<(value: T) => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(value) {
      for (const l of [...listeners]) l(value);
    },
    size: () => listeners.size,
  };
}
```

`packages/api-client/src/errors.ts`:

```ts
import type { Problem } from '@eduscope/shared';

/** Thrown by createRealClient. The interface is honest: unimplemented is loud. */
export class NotImplementedError extends Error {
  constructor(operation: string, phase = 'Phase 4') {
    super(`${operation} is not implemented until ${phase}`);
    this.name = 'NotImplementedError';
  }
}

/**
 * application/problem+json (openapi.yaml Conventions). Refusals are NAMED —
 * never a silent no-op (R-04, INV-SB-3, universal state U-5).
 */
export class ProblemError extends Error {
  readonly problem: Problem;
  constructor(problem: Problem) {
    super(`${problem.code}: ${problem.title}`);
    this.name = 'ProblemError';
    this.problem = problem;
  }
}
```

- [ ] **Step 5: Write the interface**

`packages/api-client/src/client.ts`. Write **all 77 methods** — one per `PanelOperationId`, in the order `PANEL_OPERATION_IDS` declares them. The excerpt below fixes the exact style for every tag; continue it verbatim through the list. Read each operation's responses in `contracts/openapi.yaml` to pick the return type by the rule in the Interfaces block above.

```ts
import type {
  AiCountdownSnapshot, AudioControl, AudioControlUpdate, ChangePasswordRequest,
  ChannelConfig, ChannelConfigUpdate, ChannelStatus, CommandAccepted, DeviceHealth,
  DeviceProvisioning, EventEnvelope, LayoutPreset, LoginRequest, LoginResponse,
  Page, PreviewClientMessage, PreviewServerMessage, RecordingStateSnapshot,
  RefreshResponse, SourceRole, SourceRoleId, SourceStatus, StorageOverview,
  SystemAlert, User,
} from '@eduscope/shared';
import type { ConnectionStatus, EventStream } from './stream.js';

/** events.md §3 — its own socket, and the one place the client sends WS messages. */
export interface PreviewChannel {
  send(message: PreviewClientMessage): void;
  readonly messages$: EventStream<PreviewServerMessage>;
  close(): void;
}

/**
 * THE network boundary (frontend-conventions §1). Mock and real adapters
 * implement this identically; no component may reach past it.
 *
 * Commands are 202-async: a `CommandAccepted` return means ACCEPTED, not DONE.
 * The resolving transition arrives on `events$` within `resolveBySec`
 * (T-CMD-RESOLVE, 10 s); after that the UI renders a failure, never a spinner.
 */
export interface EduscopeClient {
  // ── auth ────────────────────────────────────────────────────────────────
  login(body: LoginRequest): Promise<LoginResponse>;
  refreshToken(body: { refreshToken: string }): Promise<RefreshResponse>;
  logout(): Promise<void>;
  getMe(): Promise<User>;
  changePassword(body: ChangePasswordRequest): Promise<void>;

  // ── recording (machine 1a) ──────────────────────────────────────────────
  getRecordingState(): Promise<RecordingStateSnapshot>;
  startRecording(): Promise<CommandAccepted>;
  pauseRecording(): Promise<CommandAccepted>;
  resumeRecording(): Promise<CommandAccepted>;
  stopRecording(): Promise<CommandAccepted>;
  /** x-required-role: admin (R-21). */
  takeoverRecording(): Promise<CommandAccepted>;

  // ── channels (machine 1c) ───────────────────────────────────────────────
  listChannels(): Promise<ChannelStatus[]>;
  updateChannelConfig(channelId: string, body: ChannelConfigUpdate): Promise<ChannelConfig>;
  enableChannel(channelId: string): Promise<CommandAccepted>;
  disableChannel(channelId: string): Promise<CommandAccepted>;
  listLayoutPresets(): Promise<LayoutPreset[]>;

  // ── sources & audio (machine 5a) ────────────────────────────────────────
  listSourceRoles(): Promise<SourceRole[]>;
  getSourcesStatus(): Promise<SourceStatus[]>;
  // … listPhysicalInputs, updatePhysicalInput, listSourceBindings,
  //   updateSourceBinding, listAudioControls — same style, admin-gated per spec
  updateAudioControl(roleId: SourceRoleId, body: AudioControlUpdate): Promise<AudioControl>;

  // ── recordings, exports, uploads, storage, settings, firmware, users,
  //    ai, quiz, logs — continue for every remaining PANEL_OPERATION_ID.
  //    Cursor lists return Promise<Page<T>>; 202 commands return
  //    Promise<CommandAccepted>; 204 responses return Promise<void>.

  getProvisioning(): Promise<DeviceProvisioning>;
  getDeviceHealth(): Promise<DeviceHealth>;
  listAlerts(query?: { acknowledged?: boolean }): Promise<Page<SystemAlert>>;
  acknowledgeAlert(alertId: string): Promise<void>;
  powerOffDevice(): Promise<CommandAccepted>;
  getStorageOverview(): Promise<StorageOverview>;
  getAiCountdown(): Promise<AiCountdownSnapshot>;

  // ── realtime (events.md §1 + §3) ────────────────────────────────────────
  /** Server->client only. On subscribe the current snapshot is replayed first. */
  readonly events$: EventStream<EventEnvelope>;
  readonly connection$: EventStream<ConnectionStatus>;
  /** <= 1 active negotiation per connection; a new offer closes the previous. */
  openPreview(): PreviewChannel;
  /** Force the full-snapshot re-request a `seq` gap demands. */
  resync(): Promise<void>;
  dispose(): void;
}
```

- [ ] **Step 6: Write the real stub**

`packages/api-client/src/real/create-real-client.ts`:

```ts
import { PANEL_OPERATION_IDS } from '@eduscope/shared';
import type { EduscopeClient } from '../client.js';
import { NotImplementedError } from '../errors.js';

/**
 * Phase-4 placeholder. Every operation throws.
 *
 * This exists so the interface is HONEST: `EduscopeClient` claims to describe a
 * real backend, and until one exists that claim must fail loudly rather than
 * quietly resolve. Do not add fetch calls here in Phase 2 — the mock adapter is
 * the Phase-2 implementation.
 */
export function createRealClient(baseUrl: string): EduscopeClient {
  void baseUrl;
  const client = {} as Record<string, unknown>;

  for (const id of PANEL_OPERATION_IDS) {
    client[id] = () => {
      throw new NotImplementedError(id);
    };
  }

  const deadStream = {
    subscribe() {
      throw new NotImplementedError('events$.subscribe');
    },
  };

  client.events$ = deadStream;
  client.connection$ = deadStream;
  client.openPreview = () => {
    throw new NotImplementedError('openPreview');
  };
  client.resync = () => {
    throw new NotImplementedError('resync');
  };
  client.dispose = () => {};

  return client as unknown as EduscopeClient;
}
```

`packages/api-client/src/index.ts`:

```ts
export type { EduscopeClient, PreviewChannel } from './client.js';
export type { ConnectionStatus, EventStream, Unsubscribe } from './stream.js';
export { createEmitter } from './stream.js';
export { NotImplementedError, ProblemError } from './errors.js';
export { createRealClient } from './real/create-real-client.js';
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter @eduscope/api-client test`
Expected: PASS — `operation-coverage.test.ts` 4 passed, `real-stub.test.ts` 78 passed (77 parameterised + 1).

Run: `pnpm --filter @eduscope/api-client typecheck`
Expected: exit 0. A typecheck error here means `client.ts` is missing a signature the coverage test found on the runtime object — add it.

- [ ] **Step 8: Commit**

```bash
git add packages/api-client
git commit -m "feat(api-client): EduscopeClient boundary and honest Phase-4 stub"
```

---

## Task 6: Mock world — clock, machine runtime, seq'd emitter

**Files:**
- Create: `packages/api-client/src/mock/clock.ts`, `src/mock/machines/types.ts`, `src/mock/world.ts`
- Test: `packages/api-client/test/mock/world.test.ts`

**Interfaces:**
- Consumes: `createEmitter` (Task 5), `zEventEnvelope`, `EventEnvelope`, `PanelEventName` (Task 3).
- Produces:
  - `interface Clock { now(): number; nowIso(): string; setTimeout(fn, ms): number; clearTimeout(h): void }`, `createWallClock()`, `createVirtualClock(startIso)` returning `VirtualClock` with `advance(ms)`.
  - `type MachineId`, `type TransitionId`, `type Effect`, `interface Transition`, `interface MachineDef`.
  - `class MockWorld` with `registerMachine(def)`, `state(machineId)`, `apply(transitionId)`, `schedule(transitionId, afterMs)`, `emit(event, payload)`, `snapshot()`, `subscribeEvents(fn)`, `events$`, `data`, `clock`.
  - `PAYLOAD_BUILDERS` (mutable registry, filled per machine), `nextUlid(world)`, `buildAlert(world, code, severity)`.

- [ ] **Step 1: Write the failing test**

Create `packages/api-client/test/mock/world.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { zEventEnvelope } from '@eduscope/shared';
import { createVirtualClock } from '../../src/mock/clock.js';
import { MockWorld } from '../../src/mock/world.js';
import { recordingMachine } from '../../src/mock/machines/recording.js';

function world() {
  const clock = createVirtualClock('2026-07-30T09:00:00.000+00:00');
  const w = new MockWorld({ clock });
  w.registerMachine(recordingMachine);
  return { w, clock };
}

describe('MockWorld', () => {
  it('starts machine 1a in idle — idle is the absence of a session', () => {
    const { w } = world();
    expect(w.state('recording')).toBe('idle');
  });

  it('applies R-01 and emits recording.state{starting}', () => {
    const { w } = world();
    const seen: unknown[] = [];
    w.subscribeEvents((e) => seen.push(e));
    w.apply('R-01');
    expect(w.state('recording')).toBe('starting');
    const evt = zEventEnvelope.parse(seen.at(-1));
    expect(evt.event).toBe('recording.state');
    expect(evt.payload).toMatchObject({ state: 'starting', startReason: 'initial' });
  });

  it('refuses a transition whose `from` does not match, and says why', () => {
    const { w } = world();
    expect(() => w.apply('R-05')).toThrow(/R-05.*from idle/);
  });

  it('numbers events with a monotonic per-connection seq', () => {
    const { w } = world();
    const seen: { seq: number }[] = [];
    w.subscribeEvents((e) => seen.push(e));
    w.apply('R-01');
    w.apply('R-05');
    expect(seen.map((e) => e.seq)).toEqual([0, 1]);
  });

  it('runs scheduled transitions only when the virtual clock advances', () => {
    const { w, clock } = world();
    w.apply('R-01');
    w.schedule('R-05', 1_200);
    expect(w.state('recording')).toBe('starting');
    clock.advance(1_199);
    expect(w.state('recording')).toBe('starting');
    clock.advance(1);
    expect(w.state('recording')).toBe('recording');
  });

  it('replays a schema-valid snapshot on subscribe (events.md §1)', () => {
    const { w } = world();
    w.apply('R-01');
    const snapshot = w.snapshot();
    expect(snapshot.map((e) => e.event)).toContain('recording.state');
    for (const e of snapshot) expect(() => zEventEnvelope.parse(e)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @eduscope/api-client test mock/world`
Expected: FAIL — `Failed to resolve import "../../src/mock/clock.js"`

- [ ] **Step 3: Write the clock**

`packages/api-client/src/mock/clock.ts`:

```ts
export interface Clock {
  now(): number;
  nowIso(): string;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(handle: number): void;
}

export function createWallClock(): Clock {
  return {
    now: () => Date.now(),
    nowIso: () => new Date().toISOString().replace('Z', '+00:00'),
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms) as unknown as number,
    clearTimeout: (h) => {
      globalThis.clearTimeout(h);
    },
  };
}

export interface VirtualClock extends Clock {
  /** Advance time and run everything that comes due, in scheduled order. */
  advance(ms: number): void;
}

/** Deterministic clock for tests — no real timers, so suites never sleep. */
export function createVirtualClock(startIso: string): VirtualClock {
  let t = Date.parse(startIso);
  let nextHandle = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();

  return {
    now: () => t,
    nowIso: () => new Date(t).toISOString().replace('Z', '+00:00'),
    setTimeout(fn, ms) {
      const handle = nextHandle++;
      pending.set(handle, { at: t + ms, fn });
      return handle;
    },
    clearTimeout(handle) {
      pending.delete(handle);
    },
    advance(ms) {
      const target = t + ms;
      for (;;) {
        const due = [...pending.entries()]
          .filter(([, v]) => v.at <= target)
          .sort((a, b) => a[1].at - b[1].at);
        const next = due[0];
        if (!next) break;
        pending.delete(next[0]);
        t = next[1].at;
        next[1].fn();
      }
      t = target;
    },
  };
}
```

- [ ] **Step 4: Write the machine types**

`packages/api-client/src/mock/machines/types.ts`:

```ts
import type { PanelEventName } from '@eduscope/shared';

/** One runtime machine instance. Channel and source machines are per-id. */
export type MachineId =
  | 'recording'
  | `channel:${'meeting' | 'streaming'}`
  | 'ai.countdown'
  | 'ai.set'
  | 'ai.publication'
  | 'quiz.session'
  | 'quiz.sync'
  | `source:${string}`
  | 'storage';

/** Stable ids from docs/design/state-machines.md — 'R-01', 'CH-05', 'Q-12', … */
export type TransitionId = string;

export type Effect =
  /** Emit a catalog event; `patch` is merged over the machine's payload builder. */
  | { readonly kind: 'emit'; readonly event: PanelEventName; readonly patch?: Record<string, unknown> }
  /** Mutate world data (session title, segment index, joined count, …). */
  | { readonly kind: 'set'; readonly path: string; readonly value: unknown }
  /** Queue a follow-on transition — this is how "realistic delays" are expressed. */
  | { readonly kind: 'fire'; readonly transition: TransitionId; readonly afterMs: number }
  /** Raise a system.alert row (INV-SA-1: a still-true condition re-raises). */
  | { readonly kind: 'alert'; readonly code: string; readonly severity: 'info' | 'warning' | 'error' };

export interface Transition {
  readonly id: TransitionId;
  readonly machine: MachineId;
  /** Legal source states. `'*'` = any non-terminal state (R-21, R-22). */
  readonly from: readonly string[];
  /** Target state, or `null` for self-transitions that only emit (R-20, R-21). */
  readonly to: string | null;
  readonly effects: readonly Effect[];
  /** Citation, e.g. 'state-machines §1.2 R-05'. Rendered in the scenario overlay. */
  readonly cite: string;
}

export interface MachineDef {
  readonly id: MachineId;
  readonly initial: string;
  readonly terminal: readonly string[];
  readonly transitions: readonly Transition[];
}
```

- [ ] **Step 5: Write the world**

`packages/api-client/src/mock/world.ts`:

```ts
import { zEventEnvelope, type EventEnvelope, type PanelEventName } from '@eduscope/shared';
import { createEmitter, type EventStream, type Unsubscribe } from '../stream.js';
import { createWallClock, type Clock } from './clock.js';
import type { MachineDef, MachineId, Transition, TransitionId } from './machines/types.js';

export interface WorldOptions {
  readonly clock?: Clock;
  /** Scenario hook: return the id to run instead, or null to refuse entirely. */
  readonly intercept?: (id: TransitionId) => TransitionId | null;
}

/**
 * The mock's single source of truth: machine states + entity data + the emitter.
 * Deliberately a discrete-event simulation of docs/design/state-machines.md
 * rather than ad-hoc setTimeout soup — that is what makes scenarios composable.
 */
export class MockWorld {
  readonly clock: Clock;
  readonly data: Record<string, unknown> = {};

  private readonly machines = new Map<MachineId, MachineDef>();
  private readonly states = new Map<MachineId, string>();
  private readonly transitions = new Map<TransitionId, Transition>();
  private readonly emitter = createEmitter<EventEnvelope>();
  private readonly latest = new Map<PanelEventName, EventEnvelope>();
  private readonly intercept: WorldOptions['intercept'];
  private seq = 0;

  constructor(options: WorldOptions = {}) {
    this.clock = options.clock ?? createWallClock();
    this.intercept = options.intercept;
  }

  registerMachine(def: MachineDef): void {
    this.machines.set(def.id, def);
    this.states.set(def.id, def.initial);
    for (const t of def.transitions) this.transitions.set(t.id, t);
  }

  state(machine: MachineId): string {
    const s = this.states.get(machine);
    if (s === undefined) throw new Error(`machine not registered: ${machine}`);
    return s;
  }

  subscribeEvents(listener: (e: EventEnvelope) => void): Unsubscribe {
    return this.emitter.subscribe(listener);
  }

  get events$(): EventStream<EventEnvelope> {
    return this.emitter;
  }

  /** events.md §1: on subscribe the server emits the current snapshot. */
  snapshot(): EventEnvelope[] {
    return [...this.latest.values()];
  }

  schedule(id: TransitionId, afterMs: number): void {
    this.clock.setTimeout(() => {
      this.apply(id);
    }, afterMs);
  }

  apply(requested: TransitionId): void {
    const id = this.intercept ? this.intercept(requested) : requested;
    if (id === null) return; // refused by a scenario script
    const t = this.transitions.get(id);
    if (!t) throw new Error(`unknown transition: ${id}`);

    const current = this.state(t.machine);
    const legal = t.from.includes('*')
      ? !this.machines.get(t.machine)!.terminal.includes(current)
      : t.from.includes(current);
    if (!legal) {
      throw new Error(
        `illegal transition ${id}: from ${current}, expected one of ${t.from.join('|')}`,
      );
    }

    if (t.to !== null) this.states.set(t.machine, t.to);
    for (const effect of t.effects) this.runEffect(effect, t);
  }

  emit(event: PanelEventName, payload: unknown): void {
    const envelope = zEventEnvelope.parse({
      event,
      at: this.clock.nowIso(),
      seq: this.seq++,
      payload,
    });
    this.latest.set(event, envelope);
    this.emitter.emit(envelope);
  }

  private runEffect(effect: Transition['effects'][number], t: Transition): void {
    switch (effect.kind) {
      case 'set':
        this.data[effect.path] = effect.value;
        return;
      case 'fire':
        this.schedule(effect.transition, effect.afterMs);
        return;
      case 'emit': {
        const build = PAYLOAD_BUILDERS[effect.event];
        if (!build) throw new Error(`no payload builder registered for ${effect.event}`);
        this.emit(effect.event, { ...build(this, t), ...(effect.patch ?? {}) });
        return;
      }
      case 'alert':
        this.emit('system.alert', buildAlert(this, effect.code, effect.severity));
        return;
    }
  }
}

/** Per-event payload builders; each machine module registers its own on import. */
export const PAYLOAD_BUILDERS: Partial<
  Record<PanelEventName, (w: MockWorld, t: Transition) => Record<string, unknown>>
> = {};

export function buildAlert(
  w: MockWorld,
  code: string,
  severity: 'info' | 'warning' | 'error',
): Record<string, unknown> {
  return {
    id: nextUlid(w),
    code,
    severity,
    category: 'System',
    title: code,
    detail: null,
    raisedAt: w.clock.nowIso(),
    acknowledgedAt: null,
    clearedAt: null,
    clearedReason: null,
  };
}

const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let ulidCounter = 0;

/** Deterministic ULID-shaped ids — tests must not depend on randomness. */
export function nextUlid(w: MockWorld): string {
  const time = Math.floor(w.clock.now() / 1000)
    .toString(32)
    .toUpperCase();
  const rand = (ulidCounter++).toString(32).toUpperCase();
  const raw = (time + rand.padStart(16, '0')).padEnd(26, '0').slice(0, 26);
  return [...raw].map((c) => (ULID_ALPHABET.includes(c) ? c : '0')).join('');
}
```

- [ ] **Step 6: Run test to verify the only remaining failure is Task 7's module**

Run: `pnpm --filter @eduscope/api-client test mock/world`
Expected: FAIL — `Failed to resolve import "../../src/mock/machines/recording.js"`, and nothing else unresolved. Task 7 turns this suite green.

- [ ] **Step 7: Commit**

```bash
git add packages/api-client/src/mock packages/api-client/test/mock
git commit -m "feat(api-client): mock world runtime with virtual clock and seq'd emitter"
```

---

## Task 7: Machine definitions — 1a, 1c, 2a/2b/2d, 4a/4d, 5a/5b

**Files:**
- Create: `packages/api-client/src/mock/machines/helpers.ts`, `recording.ts`, `channel.ts`, `ai.ts`, `quiz.ts`, `health.ts`, `index.ts`
- Test: `packages/api-client/test/mock/machines.test.ts` (plus Task 6's `world.test.ts` turns green)

**Interfaces:**
- Consumes: `MachineDef`, `Transition`, `Effect`, `MockWorld`, `PAYLOAD_BUILDERS`, `nextUlid`, `TIMERS`.
- Produces: `recordingMachine`, `meetingChannelMachine`, `streamingChannelMachine`, `aiCountdownMachine`, `aiSetMachine`, `aiPublicationMachine`, `quizSessionMachine`, `quizSyncMachine`, `sourceMachine(roleId)`, `storageMachine`, and `ALL_MACHINES` (the array `createMockClient` registers). Every module registers its payload builders into `PAYLOAD_BUILDERS` as an import side effect.

> Every transition id below is copied from `docs/design/state-machines.md`. The `cite` field is not decoration — the scenario overlay renders it so a demo can be traced back to the spec row.

- [ ] **Step 1: Write the failing test**

Create `packages/api-client/test/mock/machines.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_MACHINES } from '../../src/mock/machines/index.js';

const doc = readFileSync(
  resolve(__dirname, '../../../../docs/design/state-machines.md'),
  'utf8',
);

/** Transition-table rows look like: `| R-05 | starting | … |` */
function documentedIds(prefix: string): string[] {
  return [
    ...new Set(
      [...doc.matchAll(new RegExp(`^\\| (${prefix}-\\d+) \\|`, 'gm'))].map((m) => m[1]!),
    ),
  ];
}

const implemented = new Set(
  ALL_MACHINES.flatMap((m) => m.transitions.map((t) => t.id)),
);

/**
 * Machines 4b (QuizParticipant) and 4c (per-student answer view) run on
 * quiz-service, not core-api — state-machines §0.2 names quiz-service as their
 * single writer. apps/quiz mocks them; this adapter must not.
 */
const QUIZ_SERVICE_SIDE = new Set([
  'Z-10', 'Z-11', 'Z-12', 'Z-13', 'Z-14', 'Z-15',
  'Z-20', 'Z-21', 'Z-22', 'Z-23', 'Z-24', 'Z-25', 'Z-26',
]);

describe('machine definitions mirror state-machines.md', () => {
  it.each(['R', 'CH', 'Q', 'Z', 'HL'])(
    'implements every %s-xx transition core-api owns',
    (prefix) => {
      const ids = documentedIds(prefix).filter((id) => !QUIZ_SERVICE_SIDE.has(id));
      expect(ids.length).toBeGreaterThan(0);
      const missing = ids.filter((id) => !implemented.has(id));
      expect(missing, `unimplemented transitions: ${missing.join(', ')}`).toEqual([]);
    },
  );

  it('does not implement the quiz-service-owned machines (SM-R-1: one writer)', () => {
    const leaked = [...QUIZ_SERVICE_SIDE].filter((id) => implemented.has(id));
    expect(leaked, `core-api mock claims quiz-service transitions: ${leaked.join(', ')}`)
      .toEqual([]);
  });

  it('cites a spec section on every transition', () => {
    const uncited = ALL_MACHINES.flatMap((m) => m.transitions)
      .filter((t) => !/state-machines §/.test(t.cite))
      .map((t) => t.id);
    expect(uncited, `missing citation: ${uncited.join(', ')}`).toEqual([]);
  });

  it('declares no duplicate transition ids across machines', () => {
    const all = ALL_MACHINES.flatMap((m) => m.transitions.map((t) => t.id));
    expect(all.length).toBe(new Set(all).size);
  });

  it('gives every non-initial state at least one inbound transition', () => {
    for (const m of ALL_MACHINES) {
      const reachable = new Set([m.initial, ...m.transitions.map((t) => t.to)]);
      for (const t of m.transitions) {
        for (const from of t.from) {
          if (from === '*') continue;
          expect(reachable.has(from), `${m.id}: ${t.id} starts from unreachable "${from}"`)
            .toBe(true);
        }
      }
    }
  });
});
```

Expected counts after the skip list is applied: **R** 22, **CH** 10, **Q** 30 (Q-01…Q-23 plus Q-30…Q-36), **Z** 10 (4a `Z-01…Z-06` + 4d `Z-30…Z-33`), **HL** 19 (`HL-01…HL-14` + `HL-20…HL-23`).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @eduscope/api-client test mock/machines`
Expected: FAIL — `Failed to resolve import "../../src/mock/machines/index.js"`

- [ ] **Step 3: Write the transition helper**

`packages/api-client/src/mock/machines/helpers.ts`:

```ts
import type { PanelEventName } from '@eduscope/shared';
import type { Effect, MachineId, Transition, TransitionId } from './types.js';

/** Terse constructor so a transition table reads like the doc's table. */
export function t(
  machine: MachineId,
  id: TransitionId,
  from: readonly string[],
  to: string | null,
  cite: string,
  ...effects: Effect[]
): Transition {
  return { id, machine, from, to, cite, effects };
}

export const emit = (
  event: PanelEventName,
  patch?: Record<string, unknown>,
): Effect => ({ kind: 'emit', event, ...(patch ? { patch } : {}) });

export const fire = (transition: TransitionId, afterMs: number): Effect => ({
  kind: 'fire',
  transition,
  afterMs,
});

export const alert = (
  code: string,
  severity: 'info' | 'warning' | 'error',
): Effect => ({ kind: 'alert', code, severity });

export const set = (path: string, value: unknown): Effect => ({
  kind: 'set',
  path,
  value,
});
```

- [ ] **Step 4: Write machine 1a**

`packages/api-client/src/mock/machines/recording.ts`:

```ts
import { TIMERS } from '@eduscope/shared';
import { PAYLOAD_BUILDERS, nextUlid, type MockWorld } from '../world.js';
import { alert, emit, fire, set, t } from './helpers.js';
import type { MachineDef, Transition } from './types.js';

const M = 'recording' as const;
const cite = (n: string) => `state-machines §1.2 ${n}`;

/**
 * Machine 1a. `idle` is the absence of a non-terminal LectureSession, not a row.
 * Every entry into `recording` opens exactly one segment; every exit closes one
 * (SEG-1). `error` means nothing was captured (SM-R-4) — a truncated 50-minute
 * lecture still ends `completed`.
 */
export const recordingMachine: MachineDef = {
  id: M,
  initial: 'idle',
  terminal: ['completed', 'error'],
  transitions: [
    t(M, 'R-01', ['idle'], 'starting', cite('R-01'),
      set('session.id', 'PENDING'),
      set('session.startReason', 'initial'),
      emit('recording.state'),
      fire('R-05', 1_200)),

    t(M, 'R-02', ['idle'], null, cite('R-02'),
      alert('storage.critical', 'error'),
      emit('recording.state')),

    t(M, 'R-03', ['idle'], null, cite('R-03'),
      emit('recording.state')),

    t(M, 'R-04', ['idle'], null, cite('R-04'),
      alert('config.invalid', 'error'),
      emit('recording.state')),

    t(M, 'R-05', ['starting'], 'recording', cite('R-05'),
      set('session.segmentOpen', true),
      emit('recording.state'),
      emit('recording.segment', { state: 'capturing', endReason: null }),
      emit('ai.countdown'),
      emit('quiz.session')),

    t(M, 'R-06', ['starting'], 'error', cite('R-06'),
      set('session.errorCode', 'capture.start-failed'),
      emit('recording.state'),
      alert('recording.start-failed', 'error')),

    t(M, 'R-07', ['starting'], 'stopping', cite('R-07'),
      emit('recording.state'),
      alert('recording.resume-failed', 'error'),
      fire('R-12', TIMERS['T-STOP-EOS'] / 4)),

    t(M, 'R-08', ['recording'], 'paused', cite('R-08'),
      set('session.segmentOpen', false),
      emit('recording.state'),
      emit('recording.segment', { state: 'finalized', endReason: 'pause' }),
      emit('ai.countdown')),

    t(M, 'R-09', ['recording'], 'paused', cite('R-09'),
      emit('recording.state'),
      emit('recording.segment', { state: 'truncated', endReason: 'pause' }),
      alert('recording.truncated', 'error')),

    t(M, 'R-10', ['paused'], 'starting', cite('R-10'),
      set('session.startReason', 'resume'),
      emit('recording.state'),
      fire('R-05', 800)),

    t(M, 'R-11', ['recording', 'paused'], 'stopping', cite('R-11'),
      emit('recording.state'),
      emit('ai.countdown'),
      emit('quiz.session'),
      fire('R-12', 900)),

    t(M, 'R-12', ['stopping'], 'finalizing', cite('R-12'),
      emit('recording.state'),
      emit('recording.segment', { state: 'finalized', endReason: 'stop' }),
      fire('R-14', 1_400)),

    t(M, 'R-13', ['stopping'], 'finalizing', cite('R-13'),
      emit('recording.state'),
      emit('recording.segment', { state: 'truncated', endReason: 'stop' }),
      alert('recording.stop-timeout', 'error'),
      fire('R-14', 1_400)),

    t(M, 'R-14', ['finalizing'], 'completed', cite('R-14'),
      emit('recording.state'),
      emit('recording.artifact', { state: 'merging', mergeState: 'running' })),

    t(M, 'R-15', ['finalizing'], 'error', cite('R-15'),
      set('session.errorCode', 'capture.empty'),
      emit('recording.state'),
      emit('recording.artifact', { state: 'failed', mergeState: 'failed' }),
      alert('recording.empty', 'error')),

    t(M, 'R-16', ['recording'], 'starting', cite('R-16'),
      set('session.startReason', 'recovery'),
      emit('recording.segment', { state: 'truncated', endReason: 'crash' }),
      emit('recording.state'),
      alert('recording.pipeline-lost', 'error'),
      fire('R-17', TIMERS['T-CONSUMER-RESTART'] ?? 1_000)),

    t(M, 'R-17', ['starting'], 'recording', cite('R-17'),
      emit('recording.state'),
      emit('recording.segment', { state: 'capturing', endReason: null })),

    t(M, 'R-18', ['starting'], 'stopping', cite('R-18'),
      alert('recording.unrecoverable', 'error'),
      emit('recording.state'),
      fire('R-12', 900)),

    t(M, 'R-19', ['recording'], 'stopping', cite('R-19'),
      alert('storage.critical', 'error'),
      emit('recording.state'),
      fire('R-12', 900)),

    t(M, 'R-20', ['recording'], null, cite('R-20'),
      emit('storage.status', { pressure: 'warning' }),
      alert('storage.warning', 'warning')),

    t(M, 'R-21', ['*'], null, cite('R-21'),
      emit('recording.state')),

    t(M, 'R-22', ['*'], null, cite('R-22'),
      alert('poweroff.refused', 'info')),
  ],
};

PAYLOAD_BUILDERS['recording.state'] = (w: MockWorld) => ({
  state: w.state(M),
  startReason: (w.data['session.startReason'] as string | undefined) ?? null,
  sessionId: (w.data['session.ulid'] as string | undefined) ?? null,
  title: (w.data['session.title'] as string | undefined) ?? null,
  ownerUserId: (w.data['session.ownerUserId'] as string | undefined) ?? null,
  ownerDisplayName: (w.data['session.ownerDisplayName'] as string | undefined) ?? null,
  startedAt: (w.data['session.startedAt'] as string | undefined) ?? null,
  recordedDurationMs: (w.data['session.recordedDurationMs'] as number | undefined) ?? null,
  segmentIndex: (w.data['session.segmentIndex'] as number | undefined) ?? null,
  segmentCount: (w.data['session.segmentCount'] as number | undefined) ?? null,
  pauseCount: (w.data['session.pauseCount'] as number | undefined) ?? null,
  takeoverBy: (w.data['session.takeoverBy'] as string | undefined) ?? null,
  errorCode: (w.data['session.errorCode'] as string | undefined) ?? null,
  errorMessage: (w.data['session.errorMessage'] as string | undefined) ?? null,
});

PAYLOAD_BUILDERS['recording.segment'] = (w: MockWorld, tr: Transition) => ({
  sessionId: (w.data['session.ulid'] as string) ?? nextUlid(w),
  recordingId: (w.data['recording.ulid'] as string) ?? nextUlid(w),
  segmentId: nextUlid(w),
  index: (w.data['session.segmentIndex'] as number | undefined) ?? 0,
  state: 'capturing',
  endReason: null,
  durationMs: null,
  __cite: tr.cite,
});
```

> `__cite` is stripped by `zRecordingSegmentPayload` (zod objects are non-strict by default here); if the generated schema is `.strict()`, drop the field. It exists so the overlay can show which row fired.

- [ ] **Step 5: Write the remaining machines**

Follow the identical shape. Each file exports its `MachineDef`(s) and registers its payload builders.

`channel.ts` — machine 1c, one def per channel id (`meeting`, `streaming`):
`CH-01` off→preflight (streaming only, `fire('CH-02', 900)`); `CH-02` preflight→starting; `CH-03` preflight→failed + `alert('streaming.preflight-failed','warning')`; `CH-04` off→starting (meeting, `fire('CH-05', 700)`); `CH-05` starting→on; `CH-06` starting→failed + alert; `CH-07` on→stopping (`fire('CH-08', 500)`); `CH-08` stopping→off; `CH-09` on→starting + `alert('channel.restarting','warning')`; `CH-10` failed→off. Payload builder for `channel.state` reads `w.data['channel.<id>.presetId']`.

`ai.ts` — three defs:
- 2a `aiCountdownMachine` (`unavailable` initial): `Q-01`…`Q-10`, each emitting `ai.countdown`. `Q-03` sets `remainingMs` back to the full interval (the load-bearing LP-16 rule) **and** fires `Q-04` after `TIMERS['T-LLM-REQUEST'] / 15` so a demo does not wait 45 s.
- 2b `aiSetMachine` (`requested` initial): `Q-11`…`Q-17`, emitting `ai.set` and, on `Q-12`, N× `ai.question{draft, generated}`.
- 2d `aiPublicationMachine` (`publishing` initial): `Q-30`…`Q-36`, emitting `quiz.publication`; `Q-31` closes the previous open publication **before** setting `isShowing` (INV-QPUB-1/2 ordering is load-bearing); `Q-32` leaves the projector on slides (INV-QPUB-3).

`quiz.ts` — 4a `quizSessionMachine` (`absent` initial) `Z-01`…`Z-06` emitting `quiz.session`; 4d `quizSyncMachine` (`synced` initial) `Z-30`…`Z-33` emitting `quiz.publication{syncState}` and `quiz.responses{stale}`.

`health.ts` — 5a `sourceMachine(roleId)` (`unknown` initial) `HL-01`…`HL-09` emitting `sources.status`; 5b `storageMachine` (`ok` initial) `HL-10`…`HL-14` emitting `storage.status`; 5c `HL-20`…`HL-23` emitting `device.health`.

`index.ts`:

```ts
import { recordingMachine } from './recording.js';
import { meetingChannelMachine, streamingChannelMachine } from './channel.js';
import { aiCountdownMachine, aiPublicationMachine, aiSetMachine } from './ai.js';
import { quizSessionMachine, quizSyncMachine } from './quiz.js';
import { sourceMachine, storageMachine } from './health.js';
import type { MachineDef } from './types.js';
import type { SourceRoleId } from '@eduscope/shared';

/** V1 binds four roles; mic-room is permanently unbound (INV-SR-2, A-08 amended). */
export const BOUND_SOURCE_ROLES: readonly SourceRoleId[] = [
  'presentation',
  'lecturer-cam',
  'students-cam',
  'mic-lecturer',
];

export const ALL_MACHINES: readonly MachineDef[] = [
  recordingMachine,
  meetingChannelMachine,
  streamingChannelMachine,
  aiCountdownMachine,
  aiSetMachine,
  aiPublicationMachine,
  quizSessionMachine,
  quizSyncMachine,
  storageMachine,
  ...BOUND_SOURCE_ROLES.map(sourceMachine),
];

export { recordingMachine, sourceMachine, storageMachine };
export { meetingChannelMachine, streamingChannelMachine };
export { aiCountdownMachine, aiSetMachine, aiPublicationMachine };
export { quizSessionMachine, quizSyncMachine };
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @eduscope/api-client test mock`
Expected: PASS — `world.test.ts` 6 passed, `machines.test.ts` 8 passed. The first assertion names any transition id present in the doc but missing from code, so partial machines are visible immediately.

- [ ] **Step 7: Commit**

```bash
git add packages/api-client/src/mock/machines packages/api-client/test/mock/machines.test.ts
git commit -m "feat(api-client): state-machine definitions mirroring state-machines.md"
```

---

## Task 8: Scenario engine — forced transitions and the extension API

**Files:**
- Create: `packages/api-client/src/mock/scenario/types.ts`, `scenario/engine.ts`, `scenario/registry.ts`
- Test: `packages/api-client/test/scenario/engine.test.ts`

**Interfaces:**
- Consumes: `MockWorld`, `WorldOptions.intercept`, `TransitionId`, `PanelOperationId`, `Problem`.
- Produces:
  - `type ScenarioName = 'happy' | 'start-fails' | 'pipeline-crash-midway' | 'llm-timeout' | 'disk-full' | 'ws-flap' | 'quiz-network-loss'`
  - `interface ForcedTransition { on: { command: PanelOperationId } | { transition: TransitionId }; nth?: number; replace: TransitionId | 'refuse'; refusal?: Problem; delayMs?: number }`
  - `interface ScenarioScript { name: ScenarioName; description: string; forced: readonly ForcedTransition[]; seed?: Partial<WorldSeed>; wsFlap?: { afterMs: number; downMs: number; repeat: number } }`
  - `function createScenarioEngine(script): { intercept(id): TransitionId | null; onCommand(op): Problem | null; reset(): void; trace(): TraceEntry[] }`
  - `function getScenario(name)`, `listScenarios()`, `extendScenario(name, ...forced)` — **the screen-facing extension API**.

### How the engine works (the design this plan is required to make explicit)

**1. The default path is the spec.** Every REST command maps to a `CommandPlan` — an ordered list of `(transitionId, afterMs)` steps taken straight from the state-machine tables. `startRecording` is `[{R-01, 0}]`, and `R-01`'s own `fire` effect queues `R-05` at 1 200 ms. Nothing about the happy path lives in a scenario; `happy` is the empty script.

**2. A script forces transitions, it does not script the UI.** A `ForcedTransition` is a rewrite rule over that default path:

- `on: { transition: 'R-05' }` matches when the world is about to apply `R-05`.
- `on: { command: 'startRecording' }` matches when that operation is invoked (used for Class-A refusals, which never enter the machine at all — state-machines §0.4).
- `nth` scopes the rule to the *n*-th matching occurrence (1-based). Omit it and the rule applies every time. This is how `pipeline-crash-midway` fires once, mid-lecture, rather than looping.
- `replace: 'R-06'` runs `R-06` instead. `replace: 'refuse'` cancels the transition and — for command matches — makes the client method reject with `refusal`, a real `Problem` body.
- `delayMs` overrides the scheduled delay, so `llm-timeout` can hold `generating` for a demo-sized interval instead of the spec's 45 s.

**3. Wiring.** `createMockClient(scenario)` builds the engine, then constructs `new MockWorld({ intercept: engine.intercept })`. Because the world funnels *every* `apply()` through `intercept`, a script reaches transitions fired by effects and by timers — not just the ones a command started. `engine.trace()` records `{ at, requested, applied, ruleIndex }` for the overlay.

**4. How screens register new forced transitions.** Conventions §4 says the catalog is extended, never forked. A screen that needs a state the catalog does not yet reach adds it in one place:

```ts
// apps/panel/src/routes/library/scenario.ts — colocated with the screen
import { extendScenario } from '@eduscope/api-client/mock';

extendScenario('disk-full', {
  on: { command: 'createExport' },
  replace: 'refuse',
  refusal: {
    status: 409,
    code: 'export.invalid-target',
    title: 'Not enough space on the selected drive',
  },
});
```

`extendScenario` **appends** to the named script's `forced` array and throws on an unknown name, so a typo cannot silently fork the catalog. Screens import their `scenario.ts` from the route module; the overlay picks the additions up automatically because it renders the live registry. Rules are matched in registration order and the **first** match wins, so a screen's later addition never shadows a catalog rule for the same trigger — if it needs to, it must change the catalog rule, which is a reviewable edit to `scripts/*.ts`.

- [ ] **Step 1: Write the failing test**

Create `packages/api-client/test/scenario/engine.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { createVirtualClock } from '../../src/mock/clock.js';
import { MockWorld } from '../../src/mock/world.js';
import { recordingMachine } from '../../src/mock/machines/index.js';
import {
  createScenarioEngine,
  extendScenario,
  getScenario,
  listScenarios,
} from '../../src/mock/scenario/registry.js';

function worldFor(name: Parameters<typeof getScenario>[0]) {
  const engine = createScenarioEngine(getScenario(name));
  const clock = createVirtualClock('2026-07-30T09:00:00.000+00:00');
  const w = new MockWorld({ clock, intercept: engine.intercept });
  w.registerMachine(recordingMachine);
  return { w, clock, engine };
}

describe('scenario engine', () => {
  beforeEach(() => {
    for (const s of listScenarios()) createScenarioEngine(s).reset();
  });

  it('ships exactly the seven catalog scripts', () => {
    expect(listScenarios().map((s) => s.name)).toEqual([
      'happy',
      'start-fails',
      'pipeline-crash-midway',
      'llm-timeout',
      'disk-full',
      'ws-flap',
      'quiz-network-loss',
    ]);
  });

  it('happy is the empty script — the spec path is the default', () => {
    expect(getScenario('happy').forced).toEqual([]);
    const { w, clock } = worldFor('happy');
    w.apply('R-01');
    clock.advance(1_200);
    expect(w.state('recording')).toBe('recording');
  });

  it('start-fails rewrites R-05 to R-06 so start never reads as recording', () => {
    const { w, clock } = worldFor('start-fails');
    w.apply('R-01');
    expect(w.state('recording')).toBe('starting');
    clock.advance(1_200);
    expect(w.state('recording')).toBe('error');
  });

  it('pipeline-crash-midway fires once, not on every entry to recording', () => {
    const { w, clock, engine } = worldFor('pipeline-crash-midway');
    w.apply('R-01');
    clock.advance(60_000);
    expect(w.state('recording')).toBe('recording');
    const forced = engine.trace().filter((e) => e.applied === 'R-16');
    expect(forced).toHaveLength(1);
  });

  it('a refuse rule rejects the command with a named Problem, never a no-op', () => {
    const { engine } = worldFor('disk-full');
    const problem = engine.onCommand('startRecording');
    expect(problem).toMatchObject({ status: 409, code: 'storage.critical' });
  });

  it('records a trace naming the rule that fired', () => {
    const { w, clock, engine } = worldFor('start-fails');
    w.apply('R-01');
    clock.advance(1_200);
    expect(engine.trace()).toContainEqual(
      expect.objectContaining({ requested: 'R-05', applied: 'R-06' }),
    );
  });

  it('extendScenario appends without forking, and rejects unknown names', () => {
    const before = getScenario('llm-timeout').forced.length;
    extendScenario('llm-timeout', {
      on: { command: 'createQuestion' },
      replace: 'refuse',
      refusal: { status: 409, code: 'ai.unavailable', title: 'AI is unavailable' },
    });
    expect(getScenario('llm-timeout').forced).toHaveLength(before + 1);
    expect(() =>
      // @ts-expect-error unknown scenario name is a compile error and a runtime throw
      extendScenario('made-up', { on: { command: 'getMe' }, replace: 'refuse' }),
    ).toThrow(/unknown scenario/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @eduscope/api-client test scenario/engine`
Expected: FAIL — `Failed to resolve import "../../src/mock/scenario/registry.js"`

- [ ] **Step 3: Write the types**

`packages/api-client/src/mock/scenario/types.ts`:

```ts
import type { PanelOperationId, Problem } from '@eduscope/shared';
import type { TransitionId } from '../machines/types.js';

/** frontend-conventions §4 — extend this catalog, never fork it. */
export type ScenarioName =
  | 'happy'
  | 'start-fails'
  | 'pipeline-crash-midway'
  | 'llm-timeout'
  | 'disk-full'
  | 'ws-flap'
  | 'quiz-network-loss';

export type ForcedTrigger =
  | { readonly command: PanelOperationId }
  | { readonly transition: TransitionId };

export interface ForcedTransition {
  readonly on: ForcedTrigger;
  /** 1-based occurrence to act on. Omit to apply on every occurrence. */
  readonly nth?: number;
  /** Run this instead, or cancel the transition / reject the command. */
  readonly replace: TransitionId | 'refuse';
  /** Required when `replace === 'refuse'` and the trigger is a command. */
  readonly refusal?: Problem;
  /** Override the scheduled delay so demos are not spec-length. */
  readonly delayMs?: number;
}

/** Overrides applied to the seed fixtures before the world starts. */
export interface WorldSeed {
  readonly storagePressure: 'ok' | 'warning' | 'critical';
  readonly aiEnabled: boolean;
  readonly quizAvailable: boolean;
  readonly recordingOwnedByOtherUser: boolean;
}

export interface ScenarioScript {
  readonly name: ScenarioName;
  readonly description: string;
  forced: ForcedTransition[];
  readonly seed?: Partial<WorldSeed>;
  /** ws-flap only: drop and restore the socket on a cycle (events.md §1). */
  readonly wsFlap?: { readonly afterMs: number; readonly downMs: number; readonly repeat: number };
}

export interface TraceEntry {
  readonly at: string;
  readonly requested: TransitionId;
  readonly applied: TransitionId | null;
  readonly ruleIndex: number | null;
}
```

- [ ] **Step 4: Write the engine**

`packages/api-client/src/mock/scenario/engine.ts`:

```ts
import type { Problem } from '@eduscope/shared';
import type { TransitionId } from '../machines/types.js';
import type { ForcedTransition, ScenarioScript, TraceEntry } from './types.js';

export interface ScenarioEngine {
  /** Passed to MockWorld as `intercept` — every apply() funnels through here. */
  intercept(id: TransitionId): TransitionId | null;
  /** Called by each mock REST method before it runs its CommandPlan. */
  onCommand(operationId: string): Problem | null;
  trace(): readonly TraceEntry[];
  reset(): void;
  readonly script: ScenarioScript;
}

export function createScenarioEngine(script: ScenarioScript): ScenarioEngine {
  let counts = new Map<number, number>();
  let log: TraceEntry[] = [];
  let nowIso = () => new Date().toISOString().replace('Z', '+00:00');

  function match(
    predicate: (f: ForcedTransition) => boolean,
  ): { rule: ForcedTransition; index: number } | null {
    for (const [index, rule] of script.forced.entries()) {
      if (!predicate(rule)) continue;
      const seen = (counts.get(index) ?? 0) + 1;
      counts.set(index, seen);
      if (rule.nth !== undefined && rule.nth !== seen) continue;
      return { rule, index }; // first match wins — registration order is priority
    }
    return null;
  }

  return {
    script,

    intercept(id) {
      const hit = match((f) => 'transition' in f.on && f.on.transition === id);
      if (!hit) {
        log.push({ at: nowIso(), requested: id, applied: id, ruleIndex: null });
        return id;
      }
      const applied = hit.rule.replace === 'refuse' ? null : hit.rule.replace;
      log.push({ at: nowIso(), requested: id, applied, ruleIndex: hit.index });
      return applied;
    },

    onCommand(operationId) {
      const hit = match((f) => 'command' in f.on && f.on.command === operationId);
      if (!hit || hit.rule.replace !== 'refuse') return null;
      return (
        hit.rule.refusal ?? {
          status: 409,
          code: 'conflict',
          title: `Refused by scenario "${script.name}"`,
        }
      );
    },

    trace: () => log,

    reset() {
      counts = new Map();
      log = [];
    },
  };
}
```

- [ ] **Step 5: Write the registry**

`packages/api-client/src/mock/scenario/registry.ts`:

```ts
import { happy } from './scripts/happy.js';
import { startFails } from './scripts/start-fails.js';
import { pipelineCrashMidway } from './scripts/pipeline-crash-midway.js';
import { llmTimeout } from './scripts/llm-timeout.js';
import { diskFull } from './scripts/disk-full.js';
import { wsFlap } from './scripts/ws-flap.js';
import { quizNetworkLoss } from './scripts/quiz-network-loss.js';
import type { ForcedTransition, ScenarioName, ScenarioScript } from './types.js';

/** The catalog, in overlay display order. Extend the scripts; never fork them. */
const CATALOG: Record<ScenarioName, ScenarioScript> = {
  happy,
  'start-fails': startFails,
  'pipeline-crash-midway': pipelineCrashMidway,
  'llm-timeout': llmTimeout,
  'disk-full': diskFull,
  'ws-flap': wsFlap,
  'quiz-network-loss': quizNetworkLoss,
};

export function getScenario(name: ScenarioName): ScenarioScript {
  const script = CATALOG[name];
  if (!script) throw new Error(`unknown scenario: ${String(name)}`);
  return script;
}

export function listScenarios(): readonly ScenarioScript[] {
  return Object.values(CATALOG);
}

/**
 * The screen-facing extension point (frontend-conventions §4). A screen that
 * needs a state the catalog cannot reach appends a rule here — it does not
 * define a new script. Rules match in registration order, first match wins.
 */
export function extendScenario(name: ScenarioName, ...forced: ForcedTransition[]): void {
  getScenario(name).forced.push(...forced);
}

export { createScenarioEngine } from './engine.js';
export type * from './types.js';
```

- [ ] **Step 6: Run test to verify it fails only on the scripts**

Run: `pnpm --filter @eduscope/api-client test scenario/engine`
Expected: FAIL — `Failed to resolve import "./scripts/happy.js"`. Task 9 supplies the seven scripts and turns this green.

- [ ] **Step 7: Commit**

```bash
git add packages/api-client/src/mock/scenario packages/api-client/test/scenario
git commit -m "feat(api-client): scenario engine with forced-transition rewrite rules"
```

---

## Task 9: The seven scenario scripts

**Files:**
- Create: `packages/api-client/src/mock/scenario/scripts/{happy,start-fails,pipeline-crash-midway,llm-timeout,disk-full,ws-flap,quiz-network-loss}.ts`
- Test: `packages/api-client/test/scenario/scripts.test.ts` (plus Task 8's suite turns green)

**Interfaces:**
- Consumes: `ScenarioScript`, `ForcedTransition` (Task 8), transition ids from Task 7.
- Produces: the seven named script constants, each exported under a camelCase name matching its file.

- [ ] **Step 1: Write the failing test**

Create `packages/api-client/test/scenario/scripts.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { listScenarios } from '../../src/mock/scenario/registry.js';

describe('scenario scripts', () => {
  it('every script has a human description the overlay can render', () => {
    for (const s of listScenarios()) {
      expect(s.description.length, `${s.name} has no description`).toBeGreaterThan(20);
    }
  });

  it('every refuse-on-command rule carries a named Problem (U-5)', () => {
    for (const s of listScenarios()) {
      for (const f of s.forced) {
        if ('command' in f.on && f.replace === 'refuse') {
          expect(f.refusal, `${s.name}: refuse without a Problem`).toBeDefined();
          expect(f.refusal!.code, `${s.name}: refusal has no machine code`).toBeTruthy();
        }
      }
    }
  });

  it('only ws-flap manipulates the socket', () => {
    for (const s of listScenarios()) {
      if (s.name === 'ws-flap') expect(s.wsFlap).toBeDefined();
      else expect(s.wsFlap, `${s.name} must not flap the socket`).toBeUndefined();
    }
  });

  it('disk-full seeds critical pressure so Start is refused before it is pressed', () => {
    const s = listScenarios().find((x) => x.name === 'disk-full')!;
    expect(s.seed?.storagePressure).toBe('critical');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @eduscope/api-client test scenario/scripts`
Expected: FAIL — `Failed to resolve import "../../src/mock/scenario/registry.js"` (its script imports are still missing).

- [ ] **Step 3: Write the seven scripts**

`happy.ts`:

```ts
import type { ScenarioScript } from '../types.js';

/**
 * The spec path, unmodified. `happy` is deliberately EMPTY: the default command
 * plans plus each transition's own `fire` effects already reproduce the documented
 * timings, so there is nothing to force. If a demo needs a rule here, the machine
 * definition is wrong — fix the machine, not the scenario.
 */
export const happy: ScenarioScript = {
  name: 'happy',
  description:
    'Everything works: start confirms, the AI countdown arms, the quiz session opens, ' +
    'stop finalizes to a playable recording. J-1 and J-2 happy paths.',
  forced: [],
};
```

`start-fails.ts`:

```ts
import type { ScenarioScript } from '../types.js';

/**
 * Class B (state-machines §0.4): the session IS created and then fails to `error`
 * — a start that fails must never read as `recording` (B-12, LP-4, J-1 failure).
 */
export const startFails: ScenarioScript = {
  name: 'start-fails',
  description:
    'The record consumer never confirms. R-05 is replaced by R-06, so the session ' +
    'goes starting -> error with a named cause; the red frame never appears.',
  forced: [{ on: { transition: 'R-05' }, replace: 'R-06' }],
};
```

`pipeline-crash-midway.ts`:

```ts
import type { ScenarioScript } from '../types.js';

/**
 * R-16: the consumer dies mid-lecture, a NEW segment opens, and the lecture is
 * not ended by a dead pipeline. `nth: 1` keeps it a one-off event, not a loop.
 */
export const pipelineCrashMidway: ScenarioScript = {
  name: 'pipeline-crash-midway',
  description:
    'Forty seconds in, the record consumer exits unexpectedly. R-16 truncates the ' +
    'open segment, raises recording.pipeline-lost, and R-17 resumes into a new ' +
    'segment — the seam is visible, the lecture survives.',
  forced: [
    { on: { transition: 'R-05' }, nth: 1, replace: 'R-05', delayMs: 1_200 },
    { on: { transition: 'R-16' }, nth: 1, replace: 'R-16' },
  ],
};
```

> The crash itself is queued by the mock's `startRecording` plan when this script is active — the world schedules `R-16` at 40 s. The `nth: 1` rule above is what stops the restart path from re-crashing forever.

`llm-timeout.ts`:

```ts
import type { ScenarioScript } from '../types.js';

/**
 * Q-13 -> Q-05: the LLM is unreachable after retries, the countdown is HELD in
 * `degraded`, and recording plus every other panel function is untouched
 * (LP-18, INV-QS-1, J-2 failure path).
 */
export const llmTimeout: ScenarioScript = {
  name: 'llm-timeout',
  description:
    'Question generation times out. The AI studio shows its unavailable state with ' +
    'a Retry, the countdown holds, and recording is completely unaffected.',
  forced: [
    // Demo-sized: hold `generating` for 4 s instead of T-LLM-REQUEST's 45 s.
    { on: { transition: 'Q-12' }, replace: 'Q-13', delayMs: 4_000 },
    { on: { transition: 'Q-14' }, replace: 'Q-05' },
    {
      on: { command: 'generateNow' },
      nth: 2,
      replace: 'refuse',
      refusal: {
        status: 409,
        code: 'ai.unavailable',
        title: 'The question service is not responding',
        detail: 'Recording is unaffected. Try again in a moment.',
      },
    },
  ],
};
```

`disk-full.ts`:

```ts
import type { ScenarioScript } from '../types.js';

/**
 * Class A (state-machines §0.4): storage is critical, so R-02 refuses the start
 * and NO session row is created — never a phantom `error` row in the library
 * (SM-Q-1). The warning text must be generated from the real RetentionPolicy
 * carried on storage.status, not hardcoded (INV-RP-1, B-53).
 */
export const diskFull: ScenarioScript = {
  name: 'disk-full',
  description:
    'The recordings volume is over its critical threshold. Start is refused with the ' +
    'real policy text, and an in-progress lecture is stopped gracefully by R-19.',
  seed: { storagePressure: 'critical' },
  forced: [
    {
      on: { command: 'startRecording' },
      replace: 'refuse',
      refusal: {
        status: 409,
        code: 'storage.critical',
        title: 'Not enough free space to start a recording',
        detail: 'Free space is below the critical threshold in the retention policy.',
      },
    },
    { on: { transition: 'R-01' }, replace: 'R-02' },
  ],
};
```

`ws-flap.ts`:

```ts
import type { ScenarioScript } from '../types.js';

/**
 * events.md §1 / state-machines §5.5: the socket drops and reconnects. The panel
 * must dim live regions after T-WS-STALE, KEEP the recording frame, reject
 * commands client-side, and full-resync on a seq gap — never partial-patch.
 */
export const wsFlap: ScenarioScript = {
  name: 'ws-flap',
  description:
    'The panel loses the event socket three times. Live regions dim after 10 s, the ' +
    'recording frame is kept, commands are rejected rather than queued, and each ' +
    'reconnect forces a full snapshot resync.',
  forced: [],
  wsFlap: { afterMs: 15_000, downMs: 12_000, repeat: 3 },
};
```

`quiz-network-loss.ts`:

```ts
import type { ScenarioScript } from '../types.js';

/**
 * Machine 4d Z-30 -> Z-32: the device<->quiz-service link goes stale then fails.
 * Responses are MARKED stale rather than shown as current (INV-AP-2), sent
 * questions stay on the projector, and recording is untouched (QZ-7).
 */
export const quizNetworkLoss: ScenarioScript = {
  name: 'quiz-network-loss',
  description:
    'The link to the campus quiz server drops. Insights mark responses stale instead ' +
    'of fabricating them, Send to Projector is refused with a named reason, and the ' +
    'lecture recording continues normally.',
  forced: [
    { on: { transition: 'Z-31' }, replace: 'Z-32' },
    {
      on: { command: 'sendToProjector' },
      replace: 'refuse',
      refusal: {
        status: 409,
        code: 'quiz.unavailable',
        title: 'Students cannot receive this question right now',
        detail: 'The quiz server is unreachable. The projector stayed on your slides.',
      },
    },
  ],
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @eduscope/api-client test scenario`
Expected: PASS — `engine.test.ts` 7 passed, `scripts.test.ts` 4 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/api-client/src/mock/scenario/scripts packages/api-client/test/scenario/scripts.test.ts
git commit -m "feat(api-client): the seven catalog scenario scripts"
```

---

## Task 10: Mock seed data and the 77 REST operations

**Files:**
- Create: `packages/api-client/src/mock/seed/index.ts`, `seed/users.ts`, `seed/device.ts`, `seed/sources.ts`, `seed/recordings.ts`, `seed/ai.ts`
- Create: `packages/api-client/src/mock/rest/index.ts` and one module per tag (`auth.ts`, `recording.ts`, `channels.ts`, `sources.ts`, `recordings.ts`, `uploads.ts`, `provisioning.ts`, `device.ts`, `storage.ts`, `settings.ts`, `firmware.ts`, `users.ts`, `ai.ts`, `quiz.ts`, `logs.ts`)
- Create: `packages/api-client/src/mock/commands.ts`
- Test: `packages/api-client/test/mock/contract-honesty.test.ts`

**Interfaces:**
- Consumes: `MockWorld`, `ScenarioEngine`, `ProblemError`, `nextUlid`, every `z*` schema from `@eduscope/shared`.
- Produces:
  - `createSeed(overrides?: Partial<WorldSeed>): Seed` — a frozen object holding `users`, `provisioning`, `sourceRoles`, `sourceStatuses`, `audioControls`, `channels`, `layoutPresets`, `recordings`, `storage`, `deviceHealth`, `alerts`, `questions`, `questionSets`, `publications`, `uploadJobs`, `streamTargets`, `networkConfigs`, `encoderSettings`, `firmware`, `logs`, `leaderboard`.
  - `COMMAND_PLANS: Record<PanelOperationId, CommandPlan>` where `CommandPlan = readonly { transition: TransitionId; afterMs: number }[]` — empty for pure reads.
  - `createRestOperations(ctx: { world; engine; seed }): Record<PanelOperationId, (...args: never[]) => Promise<unknown>>`.
  - `validated<T>(schema, value): T` — the single choke point that enforces contract honesty.

- [ ] **Step 1: Write the failing test**

Create `packages/api-client/test/mock/contract-honesty.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  PANEL_OPERATION_IDS,
  zAiCountdownSnapshot, zAudioControl, zChannelStatus, zDeviceHealth,
  zDeviceProvisioning, zLoginResponse, zRecordingStateSnapshot, zSourceStatus,
  zStorageOverview, zUser,
} from '@eduscope/shared';
import { createMockClient } from '../../src/mock/create-mock-client.js';

const client = createMockClient('happy');

/** One entry per operation whose response has a single named schema. */
const READ_CONTRACTS = [
  ['getMe', () => client.getMe(), zUser],
  ['getRecordingState', () => client.getRecordingState(), zRecordingStateSnapshot],
  ['getProvisioning', () => client.getProvisioning(), zDeviceProvisioning],
  ['getDeviceHealth', () => client.getDeviceHealth(), zDeviceHealth],
  ['getStorageOverview', () => client.getStorageOverview(), zStorageOverview],
  ['getAiCountdown', () => client.getAiCountdown(), zAiCountdownSnapshot],
] as const;

describe('contract honesty — every mock response validates', () => {
  it.each(READ_CONTRACTS)('%s returns a schema-valid body', async (_n, call, schema) => {
    const body = await call();
    expect(() => schema.parse(body)).not.toThrow();
  });

  it('login returns a schema-valid LoginResponse', async () => {
    const body = await client.login({
      username: 'a.perera',
      password: 'correct-horse',
      client: 'panel',
    });
    expect(() => zLoginResponse.parse(body)).not.toThrow();
  });

  it.each([
    ['listChannels', () => client.listChannels(), zChannelStatus],
    ['getSourcesStatus', () => client.getSourcesStatus(), zSourceStatus],
    ['listAudioControls', () => client.listAudioControls(), zAudioControl],
  ] as const)('%s returns schema-valid items', async (_n, call, item) => {
    const rows = await call();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(() => item.parse(row)).not.toThrow();
  });

  it('cursor lists return the { items, nextCursor } envelope', async () => {
    const page = await client.listRecordings();
    expect(page).toHaveProperty('items');
    expect(page).toHaveProperty('nextCursor');
    expect(Array.isArray(page.items)).toBe(true);
  });

  it('every 202 command resolves to a CommandAccepted with a resolve deadline', async () => {
    const accepted = await client.startRecording();
    expect(accepted.commandId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(accepted.resolveBySec).toBe(10); // T-CMD-RESOLVE
  });

  it('implements every panel operation — no method is missing at runtime', () => {
    const c = client as unknown as Record<string, unknown>;
    const missing = PANEL_OPERATION_IDS.filter((id) => typeof c[id] !== 'function');
    expect(missing, `mock is missing: ${missing.join(', ')}`).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @eduscope/api-client test contract-honesty`
Expected: FAIL — `Failed to resolve import "../../src/mock/create-mock-client.js"`

- [ ] **Step 3: Write the validation choke point and the seed**

`packages/api-client/src/mock/seed/index.ts` opens with the rule the whole package hangs on:

```ts
import type { z } from 'zod';

/**
 * THE contract-honesty gate (frontend-conventions §5). Every value the mock
 * hands back goes through here, so a mock that drifts from contracts/ fails at
 * the moment it is constructed rather than in a screen three waves later.
 */
export function validated<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `mock response violates the contract:\n${JSON.stringify(result.error.format(), null, 2)}`,
    );
  }
  return result.data;
}
```

Seed content rules — these are not arbitrary:

- **Users.** Two accounts: `a.perera` (`role: lecturer`, `mustResetPassword: false`) and `admin` (`role: admin`). A third, `n.silva`, carries `mustResetPassword: true` so the S-02 forced-reset path (U-7) is reachable without editing code.
- **Sources.** Four bound roles — `presentation`, `lecturer-cam`, `students-cam`, `mic-lecturer` — all `online`. `mic-room` is seeded `unbound` and stays that way (INV-SR-2).
- **Channels.** `local` (always on, mirrors machine 1a), `meeting` (`off`, preset `cams-fifty-fifty`), `streaming` (`off`). Layout presets are filtered by `allowedChannels` — never the full list (INV-LP-1).
- **Provisioning.** `hallCode`, `hallDisplayName`, `titlePattern` all non-empty so `G-PROVISIONED` passes; `llmEndpoint` non-null unless the seed override turns AI off (`G-AI-ENABLED`).
- **Storage.** A `RetentionPolicy` with real threshold values, because the storage banner text is **generated from the policy**, never hardcoded (INV-RP-1).
- **Recordings.** Six rows spanning `ready`, `merging`, `failed` so the library badge vocabulary is exercised.
- **Do not port anything from `/prototype`'s `mock/`** — `INITIAL_MICS`, `CLASS_ROSTER`, `simulateResponses`, `COUNTDOWN_SPEED` are prototype-only (frontend-conventions §2). Seed values here are new and contract-shaped.

Every seed builder ends with `validated(zX, row)` so a malformed fixture is caught at import.

- [ ] **Step 4: Write the command plans**

`packages/api-client/src/mock/commands.ts`:

```ts
import type { PanelOperationId } from '@eduscope/shared';
import type { TransitionId } from './machines/types.js';

export interface CommandStep {
  readonly transition: TransitionId;
  readonly afterMs: number;
}
export type CommandPlan = readonly CommandStep[];

/**
 * operationId -> the transitions that operation kicks off, straight from the
 * state-machine tables. Follow-on steps (R-01 -> R-05) live as `fire` effects on
 * the transitions themselves, so a plan is usually one step: the command's own
 * entry point. Reads have an empty plan.
 */
export const COMMAND_PLANS: Partial<Record<PanelOperationId, CommandPlan>> = {
  startRecording: [{ transition: 'R-01', afterMs: 0 }],
  pauseRecording: [{ transition: 'R-08', afterMs: 250 }],
  resumeRecording: [{ transition: 'R-10', afterMs: 250 }],
  stopRecording: [{ transition: 'R-11', afterMs: 200 }],
  takeoverRecording: [{ transition: 'R-21', afterMs: 300 }],
  enableChannel: [{ transition: 'CH-04', afterMs: 150 }],
  disableChannel: [{ transition: 'CH-07', afterMs: 150 }],
  generateNow: [{ transition: 'Q-03', afterMs: 100 }],
  setAiInterval: [{ transition: 'Q-10', afterMs: 100 }],
  sendToProjector: [{ transition: 'Q-30', afterMs: 150 }],
  closePublication: [{ transition: 'Q-35', afterMs: 150 }],
  powerOffDevice: [{ transition: 'R-22', afterMs: 200 }],
};

/** openapi.yaml Conventions: T-CMD-RESOLVE is 10 s. */
export const RESOLVE_BY_SEC = 10;
```

- [ ] **Step 5: Write the REST operations**

One module per OpenAPI tag; each exports a factory taking `{ world, engine, seed }`. The pattern, shown for the two representative cases — a read and a 202 command:

```ts
// packages/api-client/src/mock/rest/recording.ts
import { TIMERS, zCommandAccepted, zRecordingStateSnapshot } from '@eduscope/shared';
import { ProblemError } from '../../errors.js';
import { COMMAND_PLANS, RESOLVE_BY_SEC } from '../commands.js';
import { validated } from '../seed/index.js';
import { PAYLOAD_BUILDERS, nextUlid } from '../world.js';
import type { RestContext } from './index.js';

export function createRecordingOperations({ world, engine }: RestContext) {
  /** Shared by every 202 command: scenario refusal first, then the plan. */
  function accept(operationId: keyof typeof COMMAND_PLANS) {
    const refusal = engine.onCommand(operationId);
    if (refusal) throw new ProblemError(refusal);
    for (const step of COMMAND_PLANS[operationId] ?? []) {
      world.schedule(step.transition, step.afterMs);
    }
    return validated(zCommandAccepted, {
      commandId: nextUlid(world),
      acceptedAt: world.clock.nowIso(),
      resolveBySec: RESOLVE_BY_SEC,
    });
  }

  return {
    // REST snapshot mirror (contract C-9) — the same shape the WS re-emits.
    getRecordingState: async () =>
      validated(zRecordingStateSnapshot, PAYLOAD_BUILDERS['recording.state']!(world, {
        id: 'snapshot', machine: 'recording', from: [], to: null, effects: [], cite: 'C-9',
      })),

    startRecording: async () => accept('startRecording'),
    pauseRecording: async () => accept('pauseRecording'),
    resumeRecording: async () => accept('resumeRecording'),
    stopRecording: async () => accept('stopRecording'),
    takeoverRecording: async () => accept('takeoverRecording'),
  };
}

void TIMERS;
```

Apply that shape to every tag. Three rules hold everywhere:

1. **Every return value passes through `validated(...)`.** No exceptions — that is the gate the contract-honesty test is checking.
2. **Every command calls `engine.onCommand(operationId)` first** and throws `ProblemError` on a refusal, so scenario refusals surface as real `application/problem+json` bodies (U-5) rather than as silent no-ops.
3. **Reads never mutate the world.** A read that would need to change state is a design error — the state changes belong to a transition.

Admin-gated operations (`x-required-role: admin`) throw `ProblemError({ status: 403, code: 'not-authorized', … })` when the seeded session's role is `lecturer`, mirroring INV-U-4: the server gate is the security boundary, the UI gate is convenience.

`packages/api-client/src/mock/rest/index.ts` assembles them:

```ts
import type { PanelOperationId } from '@eduscope/shared';
import type { ScenarioEngine } from '../scenario/engine.js';
import type { MockWorld } from '../world.js';
import type { Seed } from '../seed/index.js';
// … one import per tag module

export interface RestContext {
  readonly world: MockWorld;
  readonly engine: ScenarioEngine;
  readonly seed: Seed;
}

export function createRestOperations(ctx: RestContext) {
  return {
    ...createAuthOperations(ctx),
    ...createRecordingOperations(ctx),
    // … every tag
  } as Record<PanelOperationId, (...args: never[]) => Promise<unknown>>;
}
```

- [ ] **Step 6: Run test to verify it fails only on the assembler**

Run: `pnpm --filter @eduscope/api-client test contract-honesty`
Expected: FAIL — `Failed to resolve import "../../src/mock/create-mock-client.js"`. Task 12 supplies it.

- [ ] **Step 7: Commit**

```bash
git add packages/api-client/src/mock/seed packages/api-client/src/mock/rest packages/api-client/src/mock/commands.ts packages/api-client/test/mock/contract-honesty.test.ts
git commit -m "feat(api-client): mock seed fixtures and the 77 REST operations"
```

---

## Task 11: Realtime — snapshot replay, throttled telemetry, preview frames, socket flap

**Files:**
- Create: `packages/api-client/src/mock/events/emitter.ts`, `events/telemetry.ts`, `events/preview.ts`, `events/connection.ts`
- Test: `packages/api-client/test/mock/telemetry.test.ts`

**Interfaces:**
- Consumes: `MockWorld`, `createEmitter`, `TIMERS`, `WS_RECONNECT_BACKOFF_MS`, `ScenarioScript.wsFlap`.
- Produces:
  - `startAudioLevels(world, roleIds): () => void` — emits `audio.levels` at exactly 10 Hz, only while a panel is subscribed.
  - `createPreviewChannel(world): PreviewChannel` — answers an `offer` with an `answer`, then pushes generated JPEG data-URI frames; errors per `PreviewServerMessage.code`.
  - `generateFrame(roleId, seq): string` — a `data:image/jpeg;base64,…` URI.
  - `createConnectionController(world, script): { connection$; start(); stop() }` — drives `connecting → open → reconnecting → stale` and the seq-gap resync.

- [ ] **Step 1: Write the failing test**

Create `packages/api-client/test/mock/telemetry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { zAudioLevelsPayload } from '@eduscope/shared';
import { createVirtualClock } from '../../src/mock/clock.js';
import { MockWorld } from '../../src/mock/world.js';
import { generateFrame, startAudioLevels } from '../../src/mock/events/telemetry.js';

function world() {
  const clock = createVirtualClock('2026-07-30T09:00:00.000+00:00');
  return { w: new MockWorld({ clock }), clock };
}

describe('audio.levels telemetry', () => {
  it('is throttled to 10 Hz (events.md §2.6 budget)', () => {
    const { w, clock } = world();
    const seen: unknown[] = [];
    w.subscribeEvents((e) => {
      if (e.event === 'audio.levels') seen.push(e);
    });
    const stop = startAudioLevels(w, ['mic-lecturer']);
    clock.advance(1_000);
    stop();
    expect(seen).toHaveLength(10);
  });

  it('emits an rms inside the contract range on every tick', () => {
    const { w, clock } = world();
    const payloads: unknown[] = [];
    w.subscribeEvents((e) => {
      if (e.event === 'audio.levels') payloads.push(e.payload);
    });
    const stop = startAudioLevels(w, ['mic-lecturer']);
    clock.advance(2_000);
    stop();
    for (const p of payloads) expect(() => zAudioLevelsPayload.parse(p)).not.toThrow();
  });

  it('stops emitting once the last subscriber leaves', () => {
    const { w, clock } = world();
    let count = 0;
    const unsub = w.subscribeEvents((e) => {
      if (e.event === 'audio.levels') count += 1;
    });
    const stop = startAudioLevels(w, ['mic-lecturer']);
    clock.advance(500);
    const atUnsubscribe = count;
    unsub();
    clock.advance(500);
    stop();
    expect(count).toBe(atUnsubscribe);
  });
});

describe('preview frames', () => {
  it('produces a decodable JPEG data URI', () => {
    const uri = generateFrame('lecturer-cam', 0);
    expect(uri.startsWith('data:image/jpeg;base64,')).toBe(true);
    const bytes = Buffer.from(uri.slice('data:image/jpeg;base64,'.length), 'base64');
    expect(bytes.subarray(0, 2).toString('hex')).toBe('ffd8'); // SOI
    expect(bytes.subarray(-2).toString('hex')).toBe('ffd9'); // EOI
  });

  it('varies frame to frame so the UI visibly animates', () => {
    expect(generateFrame('lecturer-cam', 0)).not.toBe(generateFrame('lecturer-cam', 1));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @eduscope/api-client test telemetry`
Expected: FAIL — `Failed to resolve import "../../src/mock/events/telemetry.js"`

- [ ] **Step 3: Write the telemetry module**

`packages/api-client/src/mock/events/telemetry.ts`:

```ts
import type { SourceRoleId } from '@eduscope/shared';
import type { MockWorld } from '../world.js';

/** events.md §2.6/§5: throttled to <= 10 Hz. */
const LEVELS_HZ = 10;
const LEVELS_PERIOD_MS = 1_000 / LEVELS_HZ;

/**
 * Mic level telemetry.
 *
 * Deliberately NOT the prototype's `useMicLevels` random walk — that is
 * prototype-only (frontend-conventions §2). The panel binds to this event, and
 * this event obeys the contract's frequency budget: the kiosk browser shares an
 * RK3588 with the capture pipelines, so 10 Hz is a hard ceiling, not a target.
 */
export function startAudioLevels(
  world: MockWorld,
  roleIds: readonly SourceRoleId[],
): () => void {
  let stopped = false;
  let tick = 0;

  const step = () => {
    if (stopped) return;
    // Suppress entirely when no panel is subscribed (events.md §2.6).
    if (world.subscriberCount() > 0) {
      for (const roleId of roleIds) {
        // Speech-shaped envelope: a slow syllabic rise/fall plus jitter, clamped.
        const phase = (tick % 24) / 24;
        const envelope = 0.18 + 0.55 * Math.sin(Math.PI * phase) ** 2;
        const jitter = ((tick * 2654435761) % 1000) / 10000; // deterministic
        world.emit('audio.levels', {
          roleId,
          rms: Math.min(1, Math.max(0, envelope + jitter - 0.05)),
        });
      }
    }
    tick += 1;
    world.clock.setTimeout(step, LEVELS_PERIOD_MS);
  };

  world.clock.setTimeout(step, LEVELS_PERIOD_MS);
  return () => {
    stopped = true;
  };
}

/** A 1x1 baseline JPEG — SOI ffd8 … EOI ffd9. Used where no canvas exists. */
const FALLBACK_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
  'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

/**
 * A fake preview frame as a JPEG data URI.
 *
 * In a browser this paints a labelled, moving test card on a canvas and encodes
 * it — that is where previews actually render, and a moving frame is what proves
 * the lightbox is live rather than frozen (S-10's `live` vs `negotiating`).
 * Under Node (vitest) there is no canvas, so a constant baseline JPEG is
 * returned with the sequence number appended to the URI fragment so successive
 * frames still differ.
 */
const FRAME_W = 480;
const FRAME_H = 270;

/** One canvas for the life of the module — never one per frame (see the note). */
let frameCanvas: HTMLCanvasElement | null = null;

export function generateFrame(roleId: SourceRoleId, seq: number): string {
  if (typeof document === 'undefined') {
    return `data:image/jpeg;base64,${FALLBACK_JPEG_BASE64}#${seq}`;
  }
  if (!frameCanvas) {
    frameCanvas = document.createElement('canvas');
    frameCanvas.width = FRAME_W;
    frameCanvas.height = FRAME_H;
  }
  const ctx = frameCanvas.getContext('2d');
  if (!ctx) return `data:image/jpeg;base64,${FALLBACK_JPEG_BASE64}#${seq}`;

  ctx.fillStyle = '#242a35'; // --ink-3
  ctx.fillRect(0, 0, FRAME_W, FRAME_H);
  ctx.fillStyle = '#2f6bed'; // --accent
  ctx.fillRect((seq * 7) % (FRAME_W - 40), 120, 40, 60);
  ctx.fillStyle = '#f2f4f8'; // --on-ink
  ctx.font = '16px system-ui';
  ctx.fillText(`${roleId} · mock preview · frame ${seq}`, 16, 32);
  return frameCanvas.toDataURL('image/jpeg', 0.5);
}
```

> **Cost note (RK3588).** `toDataURL` is a synchronous main-thread JPEG encode plus a base64 string allocation, on a board concurrently running capture pipelines. Three things keep it cheap: the canvas is allocated **once** rather than per frame, the frame is 480×270 at quality 0.5 (≈8 KB, not ≈30 KB), and `PREVIEW_FPS` below is **8**, not 12. A preview is on screen only while the S-10 lightbox is open — one at a time — and Wave 8 replaces this entire path with a WebRTC `MediaStream`, so this is a bounded, temporary cost and is not worth an `OffscreenCanvas` worker. It is worth not allocating a canvas 8 times a second.

Add `subscriberCount()` to `MockWorld` (it already holds the emitter):

```ts
  subscriberCount(): number {
    return this.emitter.size();
  }
```

- [ ] **Step 4: Write the preview channel and connection controller**

`events/preview.ts` — `createPreviewChannel(world)` returns a `PreviewChannel` that:
- on `offer`: if the role's machine 5a state is not `online`, replies `error{code:'source-offline'}`; if a negotiation is already open, `error{code:'busy'}`; otherwise replies `answer` after ~300 ms (INT-8's < 1 s budget) and starts a `PREVIEW_FPS = 8` `generateFrame` loop delivered to the consumer via `messages$`;
- on a second `offer`: implicitly closes the previous negotiation (events.md §3);
- on `close`: stops the frame loop. **Preview death never touches recording** — nothing in this module reaches machine 1a.

`events/connection.ts` — `createConnectionController(world, script)` emits `ConnectionStatus`. With `script.wsFlap` set it drops the socket at `afterMs`, emits `reconnecting` with the `WS_RECONNECT_BACKOFF_MS` ladder, escalates to `stale` after `TIMERS['T-WS-STALE']`, then restores and emits `{ phase: 'open', resyncReason: 'reconnect' }` followed by a **full snapshot replay** — never a partial patch (events.md §1).

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @eduscope/api-client test telemetry`
Expected: PASS — `Tests 5 passed`. The 10 Hz assertion is exact: 11 or 9 events means the throttle drifted off the contract budget.

- [ ] **Step 6: Commit**

```bash
git add packages/api-client/src/mock/events packages/api-client/test/mock/telemetry.test.ts
git commit -m "feat(api-client): throttled audio telemetry, JPEG preview frames, socket lifecycle"
```

---

## Task 12: `createMockClient` — assembling the adapter

**Files:**
- Create: `packages/api-client/src/mock/create-mock-client.ts`
- Modify: `packages/api-client/src/index.ts`
- Test: `packages/api-client/test/mock/create-mock-client.test.ts` (Tasks 8, 10 suites also turn green)

**Interfaces:**
- Consumes: everything from Tasks 6–11.
- Produces: `createMockClient(scenario?: ScenarioName, options?: { clock?: Clock }): EduscopeClient & { readonly scenario: ScenarioName; switchScenario(name: ScenarioName): void; readonly world: MockWorld }`. The three extras are what the dev overlay drives; they are **not** on `EduscopeClient`, so no screen can reach them.

- [ ] **Step 1: Write the failing test**

Create `packages/api-client/test/mock/create-mock-client.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createVirtualClock } from '../../src/mock/clock.js';
import { createMockClient } from '../../src/mock/create-mock-client.js';

const at = () => createVirtualClock('2026-07-30T09:00:00.000+00:00');

describe('createMockClient', () => {
  it('replays the on-subscribe snapshot before any new event', () => {
    const client = createMockClient('happy', { clock: at() });
    const seen: string[] = [];
    client.events$.subscribe((e) => seen.push(e.event));
    expect(seen).toContain('recording.state');
    expect(seen).toContain('sources.status');
    expect(seen).toContain('storage.status');
  });

  it('drives the happy path from idle to recording', async () => {
    const clock = at();
    const client = createMockClient('happy', { clock });
    await client.startRecording();
    clock.advance(2_000);
    expect(client.world.state('recording')).toBe('recording');
    expect((await client.getRecordingState()).state).toBe('recording');
  });

  it('start-fails lands in error and never passes through recording', async () => {
    const clock = at();
    const client = createMockClient('start-fails', { clock });
    const states: string[] = [];
    client.events$.subscribe((e) => {
      if (e.event === 'recording.state') states.push(e.payload.state);
    });
    await client.startRecording();
    clock.advance(3_000);
    expect(states).toContain('error');
    expect(states).not.toContain('recording');
  });

  it('switchScenario resets the world and applies the new script live', async () => {
    const clock = at();
    const client = createMockClient('happy', { clock });
    await client.startRecording();
    clock.advance(2_000);
    expect(client.world.state('recording')).toBe('recording');

    client.switchScenario('start-fails');
    expect(client.scenario).toBe('start-fails');
    expect(client.world.state('recording')).toBe('idle');

    await client.startRecording();
    clock.advance(3_000);
    expect(client.world.state('recording')).toBe('error');
  });

  it('rejects a refused command with a named Problem, never a silent no-op', async () => {
    const client = createMockClient('disk-full', { clock: at() });
    await expect(client.startRecording()).rejects.toMatchObject({
      name: 'ProblemError',
      problem: { code: 'storage.critical' },
    });
  });

  it('keeps the emitted seq monotonic across a scenario switch', () => {
    const clock = at();
    const client = createMockClient('happy', { clock });
    const seqs: number[] = [];
    client.events$.subscribe((e) => seqs.push(e.seq));
    client.switchScenario('ws-flap');
    clock.advance(1_000);
    for (let i = 1; i < seqs.length; i += 1) {
      expect(seqs[i]!).toBeGreaterThan(seqs[i - 1]!);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @eduscope/api-client test create-mock-client`
Expected: FAIL — `Failed to resolve import "../../src/mock/create-mock-client.js"`

- [ ] **Step 3: Write the assembler**

`packages/api-client/src/mock/create-mock-client.ts`:

```ts
import type { EduscopeClient, PreviewChannel } from '../client.js';
import { createEmitter, type ConnectionStatus, type EventStream } from '../stream.js';
import type { Clock } from './clock.js';
import { createWallClock } from './clock.js';
import { ALL_MACHINES, BOUND_SOURCE_ROLES } from './machines/index.js';
import { createRestOperations } from './rest/index.js';
import { createScenarioEngine, getScenario } from './scenario/registry.js';
import type { ScenarioName } from './scenario/types.js';
import { createSeed } from './seed/index.js';
import { createConnectionController } from './events/connection.js';
import { createPreviewChannel } from './events/preview.js';
import { startAudioLevels } from './events/telemetry.js';
import { MockWorld } from './world.js';

export interface MockClient extends EduscopeClient {
  readonly scenario: ScenarioName;
  readonly world: MockWorld;
  /** Dev-overlay only: rebuild the world under a different script, live. */
  switchScenario(name: ScenarioName): void;
}

/**
 * The Phase-2 implementation of EduscopeClient: a discrete-event simulation of
 * docs/design/state-machines.md, seeded from contract-valid fixtures and driven
 * by the scenario catalog.
 *
 * `scenario`, `world` and `switchScenario` are NOT on EduscopeClient — only the
 * dev overlay, which holds the concrete MockClient, can reach them. A screen
 * that needs a state must add a forced transition via `extendScenario`.
 */
export function createMockClient(
  scenario: ScenarioName = 'happy',
  options: { clock?: Clock } = {},
): MockClient {
  const clock = options.clock ?? createWallClock();
  const outward = createEmitter<Parameters<Parameters<EventStream<never>['subscribe']>[0]>[0]>();

  let current: ScenarioName = scenario;
  let teardown: (() => void)[] = [];
  let world!: MockWorld;
  let rest!: ReturnType<typeof createRestOperations>;
  let connection!: ReturnType<typeof createConnectionController>;
  let seq = 0;

  function build(name: ScenarioName): void {
    for (const stop of teardown) stop();
    teardown = [];

    const script = getScenario(name);
    const engine = createScenarioEngine(script);
    engine.reset();

    const seed = createSeed(script.seed);
    world = new MockWorld({ clock, intercept: engine.intercept });
    for (const machine of ALL_MACHINES) world.registerMachine(machine);

    // Re-stamp seq so it stays monotonic per connection across a live switch.
    teardown.push(
      world.subscribeEvents((e) => {
        outward.emit({ ...e, seq: seq++ });
      }),
    );

    rest = createRestOperations({ world, engine, seed });
    connection = createConnectionController(world, script);
    teardown.push(connection.start());
    teardown.push(startAudioLevels(world, BOUND_SOURCE_ROLES));

    // events.md §1: the server emits the current snapshot on subscribe.
    seedSnapshot(world, seed);
    current = name;
  }

  build(scenario);

  const client = {
    get scenario() {
      return current;
    },
    get world() {
      return world;
    },
    switchScenario(name: ScenarioName) {
      build(name);
    },

    events$: {
      subscribe(listener) {
        for (const e of world.snapshot()) listener(e);
        return outward.subscribe(listener);
      },
    },
    get connection$(): EventStream<ConnectionStatus> {
      return connection.connection$;
    },
    openPreview: (): PreviewChannel => createPreviewChannel(world),
    resync: async () => {
      for (const e of world.snapshot()) outward.emit(e);
    },
    dispose() {
      for (const stop of teardown) stop();
      teardown = [];
    },
  } as unknown as MockClient;

  return new Proxy(client, {
    get(target, prop: string, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver);
      const op = rest[prop as keyof typeof rest];
      return typeof op === 'function' ? op : undefined;
    },
    has: (target, prop) => prop in target || prop in rest,
    ownKeys: (target) => [...Reflect.ownKeys(target), ...Object.keys(rest)],
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
  });
}

/** Emit one of every snapshot event so a cold client renders without polling. */
function seedSnapshot(world: MockWorld, seed: ReturnType<typeof createSeed>): void {
  world.emit('recording.state', seed.recordingState);
  for (const s of seed.sourceStatuses) world.emit('sources.status', s);
  for (const c of seed.channels) world.emit('channel.state', c);
  world.emit('storage.status', seed.storageStatus);
  world.emit('device.health', seed.deviceHealth);
  world.emit('ai.countdown', seed.aiCountdown);
  world.emit('quiz.session', seed.quizSession);
  for (const a of seed.alerts) world.emit('system.alert', a);
}
```

Add to `packages/api-client/src/index.ts`:

```ts
export { createMockClient } from './mock/create-mock-client.js';
export type { MockClient } from './mock/create-mock-client.js';
export {
  createScenarioEngine, extendScenario, getScenario, listScenarios,
} from './mock/scenario/registry.js';
export type {
  ForcedTransition, ScenarioName, ScenarioScript,
} from './mock/scenario/types.js';
```

- [ ] **Step 4: Run the whole package suite**

Run: `pnpm --filter @eduscope/api-client test`
Expected: PASS — every suite green, including `contract-honesty.test.ts` and `scenario/engine.test.ts` from earlier tasks.

Run: `pnpm --filter @eduscope/api-client typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/api-client
git commit -m "feat(api-client): createMockClient assembling world, scenarios and realtime"
```

---

## Task 13: apps/panel — kiosk shell and the ported design tokens

**Files:**
- Create: `apps/panel/package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `vitest.config.ts`
- Create: `apps/panel/src/main.tsx`, `src/App.tsx`, `src/styles/tokens.css`, `src/styles/app.css`
- Test: `apps/panel/src/styles/tokens.test.ts`, `apps/panel/src/App.test.tsx`

**Interfaces:**
- Consumes: nothing from the packages yet — this task is the frame. (Task 1 already supplies the jsdom test project and the base lint config.)
- Produces: the `@eduscope/panel` app; `<Stage>` (grey backdrop, `.us-panel` capped at 1280×800, `position: relative` so overlays are `absolute` inside it); `tokens.css` exporting every custom property from screen-inventory §8.

> **Token port decision.** screen-inventory §8.6 offers a choice: rename `--radius-lg` from 24 px to 14 px in one commit at scaffold time, or keep the prototype's three names and add only the new ones. **This plan takes the rename** — it happens here, in Wave 0, in one commit, exactly as §8.6 permits ("Do the rename in one commit at scaffold time (Wave 0)"). Doing it later would silently change the meaning mid-build, which §8.6 forbids.
>
> §8.2 proposes two new semantic colors, `--danger` and `--danger-soft` plus `--info`/`--info-soft`, and says they "need approval with the wireframes". They are **defined in `tokens.css` but used by nothing in this scaffold**, so the approval gate stays open while screens (prompt 09) can reference them the moment it closes.

- [ ] **Step 1: Write the failing tests**

Create `apps/panel/src/styles/tokens.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, 'tokens.css'), 'utf8');
const value = (name: string) =>
  new RegExp(`--${name}:\\s*([^;]+);`).exec(css)?.[1]?.trim();

describe('design tokens (screen-inventory §8)', () => {
  it('carries the §8.1 light palette verbatim', () => {
    expect(value('bg')).toBe('#eef0f4');
    expect(value('surface')).toBe('#ffffff');
    expect(value('text')).toBe('#1c2430');
    expect(value('border')).toBe('#d8dee9');
  });

  it('carries the §8.2 ink scope, semantics and brand', () => {
    expect(value('ink')).toBe('#101319');
    expect(value('accent')).toBe('#2f6bed');
    expect(value('record')).toBe('#e5342e');
    expect(value('success')).toBe('#1c9e6a');
    expect(value('warning')).toBe('#d98a12');
    expect(value('brand-red')).toBe('#e5231f');
  });

  it('adds the two §8.2 semantics that the prototype lacks', () => {
    expect(value('danger')).toBe('#c62828');
    expect(value('info')).toBe('#2f6bed');
  });

  it('declares the full §8.4 type scale', () => {
    for (const [token, px] of [
      ['fs-3xs', '11px'], ['fs-2xs', '12px'], ['fs-xs', '13px'], ['fs-sm', '14px'],
      ['fs-base', '15px'], ['fs-md', '16px'], ['fs-lg', '17px'], ['fs-xl', '19px'],
      ['fs-2xl', '21px'], ['fs-3xl', '24px'], ['fs-timer', '38px'], ['fs-display', '46px'],
    ] as const) {
      expect(value(token), `--${token}`).toBe(px);
    }
  });

  it('declares the §8.5 2px spacing grid', () => {
    expect(value('sp-1')).toBe('4px');
    expect(value('sp-3')).toBe('8px');
    expect(value('sp-10')).toBe('24px');
  });

  it('applies the §8.6 radius rename in one place', () => {
    expect(value('radius-md')).toBe('12px');
    expect(value('radius-lg')).toBe('14px'); // reassigned from the prototype's 24px
    expect(value('radius-xl')).toBe('24px');
    expect(value('radius-panel')).toBe('20px');
  });

  it('declares the §8.7 layout constants', () => {
    expect(value('panel-w')).toBe('1280px');
    expect(value('panel-h')).toBe('800px');
    expect(value('header-h')).toBe('62px');
    expect(value('sidebar-w')).toBe('430px');
    expect(value('tap-min')).toBe('44px');
  });

  it('re-declares the ink scope inside .us-assistant rather than forking classes', () => {
    expect(css).toMatch(/\.us-assistant\s*\{[^}]*--surface:\s*#1e242f/s);
    expect(css).toMatch(/\.us-assistant\s*\{[^}]*--text:\s*#f2f4f8/s);
  });

  it('keeps the reduced-motion escape hatch', () => {
    expect(css).toContain('prefers-reduced-motion');
  });
});
```

Create `apps/panel/src/App.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App.js';

describe('panel shell', () => {
  it('renders the kiosk stage at the fixed panel size', () => {
    render(<App />);
    const panel = screen.getByTestId('us-panel');
    expect(panel).toBeTruthy();
    expect(getComputedStyle(panel).maxWidth).toBe('1280px');
    expect(getComputedStyle(panel).maxHeight).toBe('800px');
  });

  it('makes the panel the positioning context for overlays', () => {
    render(<App />);
    expect(getComputedStyle(screen.getByTestId('us-panel')).position).toBe('relative');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @eduscope/panel test`
Expected: FAIL — `Cannot find module './App.js'` / `ENOENT … tokens.css`

- [ ] **Step 3: Create the app package**

`apps/panel/package.json`:

```json
{
  "name": "@eduscope/panel",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview --port 4173",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "e2e": "playwright test"
  },
  "dependencies": {
    "@eduscope/api-client": "workspace:*",
    "@eduscope/shared": "workspace:*",
    "@hookform/resolvers": "^3.9.1",
    "@tanstack/react-query": "^5.59.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-hook-form": "^7.53.2",
    "react-router": "^7.0.1",
    "react-simple-keyboard": "^3.8.0",
    "zod": "^3.23.8",
    "zustand": "^5.0.1"
  },
  "devDependencies": {
    "@playwright/test": "^1.48.2",
    "@tailwindcss/vite": "^4.0.0",
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.0.1",
    "@testing-library/user-event": "^14.5.2",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.3",
    "jsdom": "^25.0.1",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.6.3",
    "vite": "^7.0.0",
    "vitest": "^3.0.0"
  }
}
```

`apps/panel/vite.config.ts`:

```ts
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true },
});
```

`apps/panel/vitest.config.ts`:

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    name: 'panel',
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: true, // tokens.css must be applied for the computed-style assertions
  },
});
```

`apps/quiz` gets the equivalent (`name: 'quiz'`, `include: ['{app,src}/**/*.test.{ts,tsx}']`, `setupFiles: ['./src/test-setup.ts']`) in Task 18. The root `vitest.workspace.ts` from Task 1 delegates to both, so root and per-app runs cannot drift.

`apps/panel/src/test-setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
```

`apps/panel/src/vite-env.d.ts` — without this, `import.meta.env.VITE_*` is untyped and `exactOptionalPropertyTypes` turns the client-provider read in Task 15 into a typecheck error:

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** '1' selects createRealClient. Anything else uses the mock adapter. */
  readonly VITE_EDUSCOPE_REAL_API?: string;
  readonly VITE_EDUSCOPE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

> `react-simple-keyboard` is in the dependency list because frontend-conventions §3 makes the on-screen keyboard mandatory for every panel text field. The **host** that owns its open/closed state and reports its height ships with **S-01 in Wave 1**, not here: its one hard requirement — "must not cover the submit button at 1280×800; reserve the lower 380 px" (screen-inventory S-01) — is a screen-layout decision, and there is no text input in this scaffold to host it for.

`apps/panel/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <!-- Kiosk: fixed 1280x800, no user zoom, no page scroll. -->
    <meta name="viewport" content="width=1280, initial-scale=1, user-scalable=no" />
    <title>Eduscope</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Write the tokens**

`apps/panel/src/styles/tokens.css` — port §8 in full. The head of the file, showing the exact shape:

```css
/* ============================================================
   Eduscope design tokens — ported from /prototype per
   frontend-conventions §6 and docs/design/screen-inventory.md §8.
   Custom properties are the system; do NOT convert to Tailwind
   utilities. Fixed light scheme — no dark mode, no theme toggle.
   ============================================================ */

:root {
  /* §8.1 light palette */
  --bg: #eef0f4;
  --surface: #ffffff;
  --surface-2: #f4f6fb;
  --surface-3: #e9edf4;
  --border: #d8dee9;
  --border-strong: #c2cad8;
  --text: #1c2430;
  --text-muted: #5b6675;
  --text-faint: #8a94a3;

  /* §8.2 ink scope */
  --ink: #101319;
  --ink-2: #191d26;
  --ink-3: #242a35;
  --ink-border: #2c333f;
  --on-ink: #f2f4f8;
  --on-ink-muted: #9aa4b2;
  --on-ink-faint: #6b7684;

  /* §8.2 brand + semantics */
  --accent: #2f6bed;
  --accent-hover: #285cd0;
  --accent-soft: rgba(138, 169, 236, 0.12);
  --on-accent: #ffffff;
  --brand-red: #e5231f;
  --record: #e5342e;
  --record-soft: rgba(229, 52, 46, 0.12);
  --success: #1c9e6a;
  --success-soft: rgba(28, 158, 106, 0.14);
  --warning: #d98a12;
  --gold: #e0a530;
  --silver: #7b828e;
  --bronze: #b06a3a;

  /* §8.2 additions — "we are recording" must not read as "this destroys data".
     Pending wireframe approval; defined here, used by no scaffold code. */
  --danger: #c62828;
  --danger-soft: rgba(198, 40, 40, 0.12);
  --info: #2f6bed;
  --info-soft: rgba(47, 107, 237, 0.12);

  /* §8.4 type */
  --sans: system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --mono: ui-monospace, "SF Mono", Consolas, "Liberation Mono", monospace;
  --fs-3xs: 11px;  --fs-2xs: 12px; --fs-xs: 13px;   --fs-sm: 14px;
  --fs-base: 15px; --fs-md: 16px;  --fs-lg: 17px;   --fs-xl: 19px;
  --fs-2xl: 21px;  --fs-3xl: 24px; --fs-timer: 38px; --fs-display: 46px;
  --tracking-tight: -0.4px; --tracking-normal: 0; --tracking-wide: 0.4px;
  --tracking-caps: 1px;     --tracking-caps-lg: 2.5px;

  /* §8.5 spacing — 2px grid */
  --sp-1: 4px;  --sp-2: 6px;  --sp-3: 8px;  --sp-4: 10px; --sp-5: 12px;
  --sp-6: 14px; --sp-7: 16px; --sp-8: 18px; --sp-9: 20px; --sp-10: 24px;

  /* §8.6 radii — NOTE: --radius-lg is reassigned from the prototype's 24px
     to 14px, done here in one commit as §8.6 requires. */
  --radius-xs: 6px;   --radius-sm: 10px;  --radius-md: 12px; --radius-lg: 14px;
  --radius: 16px;     --radius-panel: 20px; --radius-xl: 24px;
  --radius-pill: 999px; --radius-circle: 50%;

  --shadow-sm: 0 1px 2px rgba(16, 24, 40, 0.06), 0 1px 3px rgba(16, 24, 40, 0.08);
  --shadow-md: 0 4px 10px rgba(16, 24, 40, 0.08), 0 2px 4px rgba(16, 24, 40, 0.06);
  --shadow-lg: 0 12px 32px rgba(16, 24, 40, 0.16);

  /* §8.7 layout constants */
  --panel-w: 1280px; --panel-h: 800px; --header-h: 62px; --sidebar-w: 430px;
  --panelbar-head-h: 54px; --recframe-w: 4px; --modal-w: 680px;
  --srctile-w: 152px; --tap-min: 44px; --tap-row: 56px; --tap-row-lg: 64px;

  color-scheme: light;
  font-family: var(--sans);
  font-size: var(--fs-lg);
  line-height: 1.45;
  color: var(--text);
  -webkit-font-smoothing: antialiased;
}

/* §8.3 — the ink scope RE-DECLARES token values so nested us-* children adapt
   for free. Do not fork a parallel class set. */
.us-assistant {
  --surface: #1e242f;
  --surface-2: #262d3a;
  --surface-3: #313a49;
  --border: #2f3745;
  --border-strong: #424d5f;
  --text: #f2f4f8;
  --text-muted: #9aa4b2;
  --text-faint: #6e7987;
  --accent: #5b8cff;
  --accent-hover: #6f9bff;
  --accent-soft: rgba(91, 140, 255, 0.16);
  --record-soft: rgba(255, 91, 83, 0.16);
  --success-soft: rgba(62, 207, 142, 0.16);
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.35);
}

*, *::before, *::after { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }

body {
  background: #d5d6d9;
  color: var(--text);
  overflow: hidden; /* the kiosk page NEVER scrolls; regions scroll internally */
}

button { font-family: inherit; cursor: pointer; }

/* Every touch target meets the floor. */
:where(button, a[role="button"], [role="tab"]) { min-height: var(--tap-min); }

:where(button, a, input, select, [tabindex]):focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 2px;
}

@keyframes pulse-rec {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.45; transform: scale(0.82); }
}
@keyframes fade-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

/* No information may be carried by motion alone (§8.6). */
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.001ms !important; transition-duration: 0.001ms !important; }
}
```

`apps/panel/src/styles/app.css` — shell chrome only (`.us-panel`, `.us-stage`, `.us-header`). Screens bring their own; that is prompt 09.

```css
.us-stage {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}

/* The positioning context for EVERY overlay. Overlays are absolute inside this,
   never position: fixed against the viewport. */
.us-panel {
  position: relative;
  width: 100%;
  height: 100%;
  max-width: var(--panel-w);
  max-height: var(--panel-h);
  overflow: hidden;
  background: var(--bg);
  border-radius: var(--radius-panel);
  box-shadow: var(--shadow-lg);
}
```

- [ ] **Step 5: Write the shell**

`apps/panel/src/App.tsx`:

```tsx
import type { ReactNode } from 'react';
import './styles/tokens.css';
import './styles/app.css';

/**
 * The kiosk stage. `.us-panel` is capped at 1280x800 and is the positioning
 * context for every overlay (frontend-conventions §3, prototype CLAUDE.md).
 */
export function Stage({ children }: { children?: ReactNode }) {
  return (
    <div className="us-stage">
      <div className="us-panel" data-testid="us-panel">
        {children}
      </div>
    </div>
  );
}

export function App() {
  return <Stage />;
}
```

`apps/panel/src/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing from index.html');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @eduscope/panel test`
Expected: PASS — `tokens.test.ts` 8 passed, `App.test.tsx` 2 passed.

- [ ] **Step 7: Commit**

```bash
git add apps/panel
git commit -m "feat(panel): kiosk shell and design tokens ported from the prototype"
```

---

## Task 14: apps/panel — router skeleton, auth context, role gating

**Files:**
- Create: `apps/panel/src/auth/auth-context.tsx`, `src/auth/require-role.tsx`, `src/routes/router.tsx`, `src/routes/screens.tsx`, `src/routes/panel-shell.tsx`, `src/routes/route-error.tsx`, `src/overlays/overlay-host.tsx`
- Modify: `apps/panel/src/App.tsx`
- Test: `apps/panel/src/routes/router.test.tsx`, `apps/panel/src/auth/require-role.test.tsx`, `apps/panel/src/overlays/overlay-host.test.tsx`

**Interfaces:**
- Consumes: `EduscopeClient` (via Task 15's provider — for this task the tests inject a stub), `User`, `UserRole`.
- Produces:
  - `AuthProvider`, `useAuth(): { user: User | null; role: UserRole | null; mustResetPassword: boolean; setUser(...) }`
  - `<RequireRole role="admin">` — renders children, or redirects, per U-6.
  - `<PanelShell>` — the **layout route element**: always-mounted chrome + `<Outlet/>` + `<OverlayHost/>`. This is where S-03 lands in Wave 1.
  - `<RouteError>` — the layout route's `errorElement`.
  - `createRouter()` / `routeObjects` — one layout route with 16 children plus a catch-all, covering the screen-inventory §1.1 nav map.
  - `OverlayProvider`, `useOverlays(): { open(node): id; close(id): void; stack: OverlayEntry[] }`, `<OverlayHost/>`.

> **Why a layout route, and why the overlay host is scaffold.**
>
> **S-03** is *"the always-mounted frame … owns more failure states than any real screen and must be built first"* and is specified as `(panel, all routes)`. With a flat sibling array it has nowhere to live except outside `RouterProvider`, where it cannot call `useLocation`/`useNavigate` — so nav highlighting and route-aware chrome would have to duplicate router state by hand. A layout route is the difference between S-03 being buildable in Wave 1 and being a workaround.
>
> **Overlays** are UI-local and correctly have no route (SI-D-2), but ten of them (S-10, S-12, S-14, S-15, S-18, S-19, S-20, S-23, S-24, S-33) still need somewhere to mount, and two binding rules constrain it: overlays are `position: absolute` inside `.us-panel`, **never** `position: fixed` (frontend-conventions §3); and *"`Modal` and `Drawer` portal into `.us-panel`, so dialogs opened from the dark scope render light — that is intentional and must be preserved"* (screen-inventory §8.3). S-15 opens on top of S-14, so this is a **stack**, not a boolean. Ten screens each inventing their own scrim, focus trap and escape handling is the most predictable duplication in this plan.
>
> The host is the mount point and the stack — **not** a styled `Modal`. `Modal`, `Drawer`, `Toggle` and `Stepper` are component work and stay in prompt 09.

**Routes** (screen-inventory §1.1; overlays are UI-local and get **no** route, per SI-D-2):

| Path | Screen | Gate |
|---|---|---|
| `/login` | S-01 | public |
| `/login/reset` | S-02 | authenticated |
| `/` | S-04 / S-05 / S-06 (state variants of one route) | authenticated |
| `/library` | S-21 | authenticated |
| `/library/:recordingId` | S-22 | authenticated |
| `/advanced` | S-25 | authenticated |
| `/advanced/local-capture` | S-26 | lecturer + admin |
| `/advanced/streaming` | S-27 | lecturer + admin |
| `/advanced/network` | S-28 | admin |
| `/advanced/encoder` | S-29 | admin |
| `/advanced/storage` | S-30 | admin |
| `/advanced/firmware` | S-31 | admin |
| `/advanced/users` | S-32 | admin |
| `/advanced/logs` | S-34 | admin |
| `/advanced/uploads` | S-35 | admin |
| `/advanced/device` | S-36 | admin |

- [ ] **Step 1: Write the failing tests**

Create `apps/panel/src/routes/router.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AuthProvider } from '../auth/auth-context.js';
import { ROUTES, routeObjects } from './router.js';

function renderAt(path: string, role: 'lecturer' | 'admin' = 'lecturer') {
  const router = createMemoryRouter(routeObjects, { initialEntries: [path] });
  return render(
    <AuthProvider
      initialUser={{
        id: '01JBQ8ZK3T7WBM5N2Q4XPRVC9D',
        username: 'a.perera',
        displayName: 'A. Perera',
        role,
        source: 'local',
        mustResetPassword: false,
        disabled: false,
        lastLoginAt: null,
        createdAt: '2026-01-01T00:00:00+00:00',
      }}
    >
      <RouterProvider router={router} />
    </AuthProvider>,
  );
}

describe('panel router (screen-inventory §1.1)', () => {
  it('declares exactly the 16 nav-map routes', () => {
    expect(ROUTES.map((r) => r.path)).toEqual([
      '/login', '/login/reset', '/', '/library', '/library/:recordingId',
      '/advanced', '/advanced/local-capture', '/advanced/streaming',
      '/advanced/network', '/advanced/encoder', '/advanced/storage',
      '/advanced/firmware', '/advanced/users', '/advanced/logs',
      '/advanced/uploads', '/advanced/device',
    ]);
  });

  it('gives no overlay a route (SI-D-2)', () => {
    const overlayIds = ['S-10', 'S-12', 'S-14', 'S-15', 'S-18', 'S-19', 'S-20', 'S-23', 'S-24', 'S-33'];
    for (const id of overlayIds) {
      expect(ROUTES.some((r) => r.screen === id), `${id} must not be a route`).toBe(false);
    }
  });

  it.each([
    ['/', 'S-04'],
    ['/library', 'S-21'],
    ['/advanced', 'S-25'],
    ['/advanced/local-capture', 'S-26'],
  ])('renders %s as screen %s', (path, screenId) => {
    renderAt(path);
    expect(screen.getByTestId('screen').dataset.screen).toBe(screenId);
  });

  it('renders an admin route for an admin', () => {
    renderAt('/advanced/users', 'admin');
    expect(screen.getByTestId('screen').dataset.screen).toBe('S-32');
  });

  it('mounts every route inside ONE layout route — S-03 is (panel, all routes)', () => {
    expect(routeObjects).toHaveLength(1);
    expect(routeObjects[0]!.children).toHaveLength(ROUTES.length + 1); // + catch-all
  });

  it('gives the shell an overlay host on every route', () => {
    renderAt('/library');
    expect(screen.getByTestId('overlay-host')).toBeTruthy();
    renderAt('/advanced');
    expect(screen.getByTestId('overlay-host')).toBeTruthy();
  });

  it('catches an unknown path instead of rendering blank', () => {
    renderAt('/nope/not/a/route');
    expect(screen.getByTestId('screen').dataset.screen).toBe('not-found');
  });

  it('renders an error card instead of a white screen when a route throws', () => {
    const boom: typeof routeObjects = [
      {
        ...routeObjects[0]!,
        children: [
          {
            path: '/',
            element: (() => {
              throw new Error('kaboom');
            })(),
          },
        ],
      },
    ];
    const router = createMemoryRouter(boom, { initialEntries: ['/'] });
    render(<RouterProvider router={router} />);
    expect(screen.getByTestId('route-error')).toBeTruthy();
  });
});
```

Create `apps/panel/src/auth/require-role.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AuthProvider } from './auth-context.js';
import { RequireRole } from './require-role.js';

const user = (role: 'lecturer' | 'admin', mustResetPassword = false) => ({
  id: '01JBQ8ZK3T7WBM5N2Q4XPRVC9D',
  username: 'u', displayName: 'U', role, source: 'local' as const,
  mustResetPassword, disabled: false, lastLoginAt: null,
  createdAt: '2026-01-01T00:00:00+00:00',
});

function at(path: string, u: ReturnType<typeof user> | null) {
  return render(
    <AuthProvider initialUser={u}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login" element={<p>login</p>} />
          <Route path="/login/reset" element={<p>reset</p>} />
          <Route path="/" element={<p>dashboard</p>} />
          <Route
            path="/advanced/users"
            element={<RequireRole role="admin"><p>users</p></RequireRole>}
          />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe('role gating', () => {
  it('lets an admin through', () => {
    at('/advanced/users', user('admin'));
    expect(screen.getByText('users')).toBeTruthy();
  });

  it('sends a lecturer back to the role-scoped shell, not a 403 page (U-6)', () => {
    at('/advanced/users', user('lecturer'));
    expect(screen.queryByText('users')).toBeNull();
    expect(screen.getByText('dashboard')).toBeTruthy();
  });

  it('sends an unauthenticated visitor to login', () => {
    at('/advanced/users', null);
    expect(screen.getByText('login')).toBeTruthy();
  });

  it('redirects to the forced reset while mustResetPassword is true (U-7)', () => {
    at('/', user('lecturer', true));
    expect(screen.getByText('reset')).toBeTruthy();
  });
});
```

Create `apps/panel/src/overlays/overlay-host.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { OverlayHost, OverlayProvider, useOverlays } from './overlay-host.js';

function Harness() {
  const { open, close, stack } = useOverlays();
  return (
    <>
      <button type="button" onClick={() => open(<p>first</p>)}>open first</button>
      <button type="button" onClick={() => open(<p>second</p>)}>open second</button>
      <button type="button" onClick={() => open(<p>locked</p>, { dismissible: false })}>
        open locked
      </button>
      <button type="button" onClick={() => stack[0] && close(stack[0].id)}>
        close first
      </button>
      <OverlayHost />
    </>
  );
}

const renderHost = () =>
  render(
    <OverlayProvider>
      <Harness />
    </OverlayProvider>,
  );

describe('overlay host', () => {
  it('renders nothing until an overlay is opened', () => {
    renderHost();
    expect(screen.getByTestId('overlay-host').dataset.depth).toBe('0');
  });

  it('stacks overlays — S-15 opens on top of S-14, it does not replace it', async () => {
    const user = userEvent.setup();
    renderHost();
    await user.click(screen.getByRole('button', { name: 'open first' }));
    await user.click(screen.getByRole('button', { name: 'open second' }));
    expect(screen.getByText('first')).toBeTruthy();
    expect(screen.getByText('second')).toBeTruthy();
    expect(screen.getByTestId('overlay-host').dataset.depth).toBe('2');
  });

  it('orders layers so the newest is on top', async () => {
    const user = userEvent.setup();
    renderHost();
    await user.click(screen.getByRole('button', { name: 'open first' }));
    await user.click(screen.getByRole('button', { name: 'open second' }));
    const layers = screen.getByTestId('overlay-host').querySelectorAll('.us-overlayhost__layer');
    const z = [...layers].map((l) => Number((l as HTMLElement).style.zIndex));
    expect(z[1]!).toBeGreaterThan(z[0]!);
  });

  it('closes a specific overlay without disturbing the rest', async () => {
    const user = userEvent.setup();
    renderHost();
    await user.click(screen.getByRole('button', { name: 'open first' }));
    await user.click(screen.getByRole('button', { name: 'open second' }));
    await user.click(screen.getByRole('button', { name: 'close first' }));
    expect(screen.queryByText('first')).toBeNull();
    expect(screen.getByText('second')).toBeTruthy();
  });

  it('leaves a non-dismissible overlay alone on Escape (S-02 has no escape hatch)', async () => {
    const user = userEvent.setup();
    renderHost();
    await user.click(screen.getByRole('button', { name: 'open locked' }));
    await user.type(screen.getByTestId('overlay-host'), '{Escape}');
    expect(screen.getByText('locked')).toBeTruthy();
  });

  it('mounts inside .us-panel — never position: fixed (conventions §3)', () => {
    renderHost();
    expect(getComputedStyle(screen.getByTestId('overlay-host')).position).toBe('absolute');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @eduscope/panel test routes auth`
Expected: FAIL — `Cannot find module './router.js'`

- [ ] **Step 3: Write the auth context**

`apps/panel/src/auth/auth-context.tsx`:

```tsx
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { User, UserRole } from '@eduscope/shared';

interface AuthValue {
  readonly user: User | null;
  readonly role: UserRole | null;
  /** INV-U-3: while true, every surface except S-02 and getMe is unreachable. */
  readonly mustResetPassword: boolean;
  setUser(user: User | null): void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({
  children,
  initialUser = null,
}: {
  children: ReactNode;
  initialUser?: User | null;
}) {
  const [user, setUser] = useState<User | null>(initialUser);
  const value = useMemo<AuthValue>(
    () => ({
      user,
      role: user?.role ?? null,
      mustResetPassword: user?.mustResetPassword ?? false,
      setUser,
    }),
    [user],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
```

- [ ] **Step 4: Write the gate**

`apps/panel/src/auth/require-role.tsx`:

```tsx
import { Navigate, useLocation } from 'react-router';
import type { UserRole } from '@eduscope/shared';
import type { ReactNode } from 'react';
import { useAuth } from './auth-context.js';

/**
 * The UI gate is convenience; the server gate is the security boundary
 * (screen-inventory §1.1, PF-17, INV-U-4). A lecturer reaching an admin route
 * gets the role-scoped shell, NOT a 403 page (U-6) — the nav never offers what
 * the role cannot use, so arriving here at all is an anomaly.
 */
export function RequireRole({
  role,
  children,
}: {
  role?: UserRole;
  children: ReactNode;
}) {
  const { user, mustResetPassword } = useAuth();
  const location = useLocation();

  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  // U-7: the router redirects rather than rendering the 403 the API would send.
  if (mustResetPassword && location.pathname !== '/login/reset') {
    return <Navigate to="/login/reset" replace />;
  }

  if (role && user.role !== role) return <Navigate to="/" replace />;

  return <>{children}</>;
}
```

- [ ] **Step 5: Write the router and placeholders**

`apps/panel/src/routes/screens.tsx`:

```tsx
/**
 * Route skeletons ONLY. Screen implementation is prompt 09; a placeholder here
 * renders its screen id and title so the router, the gates and the Playwright
 * smoke test have something real to assert against.
 */
export function ScreenPlaceholder({ id, title }: { id: string; title: string }) {
  return (
    <main data-testid="screen" data-screen={id}>
      <h1>{title}</h1>
    </main>
  );
}
```

`apps/panel/src/overlays/overlay-host.tsx`:

```tsx
import {
  createContext, useCallback, useContext, useMemo, useRef, useState,
  type ReactNode,
} from 'react';

export interface OverlayEntry {
  readonly id: number;
  readonly node: ReactNode;
  /** Set by the opener when the overlay must not be dismissed by the scrim. */
  readonly dismissible: boolean;
}

interface OverlayValue {
  readonly stack: readonly OverlayEntry[];
  open(node: ReactNode, options?: { dismissible?: boolean }): number;
  close(id: number): void;
  closeTop(): void;
}

const OverlayContext = createContext<OverlayValue | null>(null);

/**
 * The mount point and z-stack for every UI-local overlay (SI-D-2: overlays are
 * state, not URLs). A STACK, not a flag — S-15 opens on top of S-14.
 *
 * This is deliberately not a Modal: it owns mounting, ordering, the scrim and
 * Escape, and nothing else. Visual design lives in the screens (prompt 09).
 */
export function OverlayProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<OverlayEntry[]>([]);
  const nextId = useRef(1);

  const open = useCallback((node: ReactNode, options?: { dismissible?: boolean }) => {
    const id = nextId.current++;
    setStack((s) => [...s, { id, node, dismissible: options?.dismissible ?? true }]);
    return id;
  }, []);

  const close = useCallback((id: number) => {
    setStack((s) => s.filter((e) => e.id !== id));
  }, []);

  const closeTop = useCallback(() => {
    setStack((s) => (s.at(-1)?.dismissible === false ? s : s.slice(0, -1)));
  }, []);

  const value = useMemo(() => ({ stack, open, close, closeTop }), [stack, open, close, closeTop]);
  return <OverlayContext.Provider value={value}>{children}</OverlayContext.Provider>;
}

export function useOverlays(): OverlayValue {
  const ctx = useContext(OverlayContext);
  if (!ctx) throw new Error('useOverlays must be used inside <OverlayProvider>');
  return ctx;
}

/**
 * Renders the stack INSIDE .us-panel. No portal to document.body and no
 * position: fixed — frontend-conventions §3, and screen-inventory §8.3 requires
 * that a dialog opened from the dark .us-assistant scope render light, which
 * only holds if it mounts here rather than inside that scope.
 */
export function OverlayHost() {
  const { stack, closeTop } = useOverlays();
  return (
    <div
      className="us-overlayhost"
      data-testid="overlay-host"
      data-depth={stack.length}
      onKeyDown={(e) => {
        if (e.key === 'Escape') closeTop();
      }}
    >
      {stack.map((entry, i) => (
        <div
          key={entry.id}
          className="us-overlayhost__layer"
          data-overlay-id={entry.id}
          style={{ zIndex: 100 + i }}
          role="presentation"
        >
          {entry.node}
        </div>
      ))}
    </div>
  );
}
```

Add to `apps/panel/src/styles/app.css`:

```css
/* Absolute inside .us-panel — never fixed against the viewport. */
.us-overlayhost { position: absolute; inset: 0; pointer-events: none; }
.us-overlayhost[data-depth="0"] { display: none; }
.us-overlayhost__layer { position: absolute; inset: 0; pointer-events: auto; }
```

`apps/panel/src/routes/panel-shell.tsx`:

```tsx
import { Outlet } from 'react-router';
import { OverlayHost, OverlayProvider } from '../overlays/overlay-host.js';

/**
 * The layout route element. S-03 (panel shell, chrome & alert host — "panel,
 * all routes") lands HERE in Wave 1: header, recording frame + notch, the
 * alert/banner host and the WS connection indicator all go beside <Outlet/>,
 * inside the router, so they can use useLocation/useNavigate.
 */
export function PanelShell() {
  return (
    <OverlayProvider>
      {/* Wave 1: <PanelHeader/> and the recording frame mount here. */}
      <Outlet />
      <OverlayHost />
    </OverlayProvider>
  );
}
```

`apps/panel/src/routes/route-error.tsx`:

```tsx
import { useRouteError } from 'react-router';

/**
 * A kiosk has no keyboard, no address bar and nobody to press reload — an
 * unhandled render error must not become a white screen in a lecture hall.
 * Recording continues regardless: the device is the authority, not the browser
 * (state-machines §5.5).
 */
export function RouteError() {
  const error = useRouteError();
  return (
    <main data-testid="route-error" role="alert">
      <h1>Something went wrong on this screen</h1>
      <p>Recording is not affected. Go back to the dashboard and try again.</p>
      <a href="/">Back to dashboard</a>
      <pre hidden>{error instanceof Error ? error.message : String(error)}</pre>
    </main>
  );
}
```

`apps/panel/src/routes/router.tsx`:

```tsx
import { createBrowserRouter, type RouteObject } from 'react-router';
import type { UserRole } from '@eduscope/shared';
import { RequireRole } from '../auth/require-role.js';
import { PanelShell } from './panel-shell.js';
import { RouteError } from './route-error.js';
import { ScreenPlaceholder } from './screens.js';

interface RouteSpec {
  readonly path: string;
  readonly screen: string;
  readonly title: string;
  /** Omitted = any authenticated role. `public` = no gate at all. */
  readonly gate?: UserRole | 'public';
}

/** screen-inventory §1.1. Overlays are UI-local state and appear nowhere here. */
export const ROUTES: readonly RouteSpec[] = [
  { path: '/login', screen: 'S-01', title: 'Login', gate: 'public' },
  { path: '/login/reset', screen: 'S-02', title: 'Set a new password' },
  { path: '/', screen: 'S-04', title: 'Dashboard' },
  { path: '/library', screen: 'S-21', title: 'Recordings' },
  { path: '/library/:recordingId', screen: 'S-22', title: 'Recording detail' },
  { path: '/advanced', screen: 'S-25', title: 'Advanced' },
  { path: '/advanced/local-capture', screen: 'S-26', title: 'Local Capture Layout' },
  { path: '/advanced/streaming', screen: 'S-27', title: 'Streaming Configuration' },
  { path: '/advanced/network', screen: 'S-28', title: 'Network', gate: 'admin' },
  { path: '/advanced/encoder', screen: 'S-29', title: 'Encoder', gate: 'admin' },
  { path: '/advanced/storage', screen: 'S-30', title: 'Local Storage', gate: 'admin' },
  { path: '/advanced/firmware', screen: 'S-31', title: 'Firmware', gate: 'admin' },
  { path: '/advanced/users', screen: 'S-32', title: 'User Management', gate: 'admin' },
  { path: '/advanced/logs', screen: 'S-34', title: 'System Logs', gate: 'admin' },
  { path: '/advanced/uploads', screen: 'S-35', title: 'Upload Queue', gate: 'admin' },
  { path: '/advanced/device', screen: 'S-36', title: 'Device & Identity', gate: 'admin' },
];

const screenRoutes: RouteObject[] = ROUTES.map(({ path, screen, title, gate }) => {
  const element = <ScreenPlaceholder id={screen} title={title} />;
  return {
    path,
    element:
      gate === 'public' ? (
        element
      ) : (
        <RequireRole {...(gate ? { role: gate } : {})}>{element}</RequireRole>
      ),
  };
});

/**
 * ONE layout route wrapping every screen. The shell must be inside the router,
 * not above it, or S-03's chrome cannot read the current location.
 */
export const routeObjects: RouteObject[] = [
  {
    element: <PanelShell />,
    errorElement: <RouteError />,
    children: [
      ...screenRoutes,
      // No address bar to mistype, but a bad programmatic navigate must not
      // leave a blank panel with no way back.
      { path: '*', element: <ScreenPlaceholder id="not-found" title="Screen not found" /> },
    ],
  },
];

export const createRouter = () => createBrowserRouter(routeObjects);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @eduscope/panel test`
Expected: PASS — `router.test.tsx` 11 passed, `require-role.test.tsx` 4 passed, `overlay-host.test.tsx` 6 passed, plus Task 13's suites.

- [ ] **Step 7: Commit**

```bash
git add apps/panel/src/auth apps/panel/src/routes apps/panel/src/overlays apps/panel/src/styles/app.css
git commit -m "feat(panel): layout route, role gating, error boundary and overlay host"
```

---

## Task 15: apps/panel — client provider, WS store, TanStack Query

**Files:**
- Create: `apps/panel/src/client/client-provider.tsx`, `src/store/ws-store.ts`, `src/store/selectors.ts`, `src/store/telemetry-store.ts`, `src/hooks/use-ticker.ts`, `src/query/query-client.ts`
- Modify: `apps/panel/src/App.tsx`, `src/main.tsx`, `docs/design/frontend-conventions.md`
- Test: `apps/panel/src/store/ws-store.test.ts`, `apps/panel/src/store/selectors.test.tsx`, `apps/panel/src/hooks/use-ticker.test.ts`

**Interfaces:**
- Consumes: `EduscopeClient`, `createMockClient`, `createRealClient`, `EventEnvelope`, `ConnectionStatus`, and the payload types `RecordingStatePayload`, `SourcesStatusPayload`, `ChannelStatePayload`, `StorageStatusPayload`, `DeviceHealthPayload`, `AiCountdownPayload`, `AiSetPayload`, `QuizSessionPayload`, `QuizPublicationPayload`, `SystemAlert`.
- Produces:
  - `ClientProvider` + `useClient(): EduscopeClient` — **the single place in the app that constructs a client**.
  - `useWsStore` (zustand) with **typed** slices `{ recording, sources, channels, storage, deviceHealth, aiCountdown, aiSet, quizSession, publications, alerts, connection, needsResync, stale }` and actions `ingest(envelope)`, `setConnection(status)`, `clearResync()`, `reset()`.
  - `useTelemetryStore` — a separate transient store for `audioLevels` and `lastSeq`, created with `subscribeWithSelector` and **read imperatively, never through a React hook**.
  - `src/store/selectors.ts` — the atomic selectors screens use, plus `useWsShallow` for multi-field reads.
  - `useTicker(intervalMs)` — a leaf-local tick for locally-derived time.
  - `createQueryClient()` — `staleTime: Infinity`, `refetchOnWindowFocus: false`, `retry: 1`. **No polling anywhere a WS event exists** (events.md §5).

> **Why this task is bigger than "wire a store".** Forty-two screens are written against whatever shape lands here, so three decisions have to be made now rather than retrofitted:
>
> 1. **Typed slices.** Tasks 2–4 exist to produce `RecordingStatePayload` and friends. Storing them as `Record<string, unknown>` throws that away and forces a cast at every point of use — exactly where `state === 'recording'` narrowing should be doing the work.
> 2. **Selector discipline.** zustand v5 removed the equality-function argument from the hook, so an object-returning selector is a fresh reference on **every** store notification and re-renders unconditionally. `ingest` rebuilds `sources`/`channels`/`publications` by spread, so map selectors are never referentially stable either. Atomic selectors by default, `useShallow` for multi-field reads, and the rule written into frontend-conventions.
> 3. **Telemetry is not application state.** `audio.levels` arrives at 10 Hz. In the same store it notifies every subscriber ten times a second, and zustand re-runs every registered selector on each notification — on an RK3588 that is also running the capture pipelines. Meters never enter React state: the transient store is subscribed imperatively and writes a CSS custom property. `lastSeq` changes on every event and gets the same treatment.

- [ ] **Step 1: Write the failing test**

Create `apps/panel/src/store/ws-store.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { useTelemetryStore, useWsStore } from './ws-store.js';

const envelope = (event: string, payload: unknown, seq: number) =>
  ({ event, at: '2026-07-30T09:00:00+00:00', seq, payload }) as never;

describe('ws store', () => {
  beforeEach(() => {
    useWsStore.getState().reset();
  });

  it('ingests recording.state into the recording slice', () => {
    useWsStore.getState().ingest(
      envelope('recording.state', { state: 'recording', sessionId: null }, 0),
    );
    expect(useWsStore.getState().recording?.state).toBe('recording');
  });

  it('keys sources.status by roleId rather than replacing the map', () => {
    const s = useWsStore.getState();
    s.ingest(envelope('sources.status', { roleId: 'lecturer-cam', state: 'online' }, 0));
    s.ingest(envelope('sources.status', { roleId: 'mic-lecturer', state: 'offline' }, 1));
    expect(Object.keys(useWsStore.getState().sources)).toEqual([
      'lecturer-cam',
      'mic-lecturer',
    ]);
  });

  it('flags a seq gap for a FULL resync — never a partial patch (events.md §1)', () => {
    const s = useWsStore.getState();
    s.ingest(envelope('recording.state', { state: 'idle' }, 0));
    s.ingest(envelope('recording.state', { state: 'recording' }, 5));
    expect(useWsStore.getState().needsResync).toBe(true);
  });

  it('marks live regions stale after T-WS-STALE but KEEPS the recording slice', () => {
    const s = useWsStore.getState();
    s.ingest(envelope('recording.state', { state: 'recording' }, 0));
    s.setConnection({ phase: 'stale', attempt: 3, since: '2026-07-30T09:00:10+00:00' });
    const after = useWsStore.getState();
    expect(after.stale).toBe(true);
    // The device is still recording; hiding the frame would be the dangerous lie.
    expect(after.recording?.state).toBe('recording');
  });

  it('never buffers commands — the store holds no outbound queue', () => {
    expect(Object.keys(useWsStore.getState())).not.toContain('pendingCommands');
  });

  it('notifies subscribers exactly ONCE per envelope', () => {
    let notifications = 0;
    const unsub = useWsStore.subscribe(() => {
      notifications += 1;
    });
    useWsStore.getState().ingest(envelope('recording.state', { state: 'recording' }, 0));
    unsub();
    expect(notifications).toBe(1);
  });

  it('keeps audio levels OUT of the application store', () => {
    useWsStore.getState().ingest(
      envelope('audio.levels', { roleId: 'mic-lecturer', rms: 0.4 }, 0),
    );
    expect(Object.keys(useWsStore.getState())).not.toContain('audioLevels');
    expect(useTelemetryStore.getState().audioLevels['mic-lecturer']).toBe(0.4);
  });

  it('does not notify the application store for telemetry', () => {
    let notifications = 0;
    const unsub = useWsStore.subscribe(() => {
      notifications += 1;
    });
    for (let i = 0; i < 20; i += 1) {
      useWsStore.getState().ingest(
        envelope('audio.levels', { roleId: 'mic-lecturer', rms: 0.4 }, i),
      );
    }
    unsub();
    expect(notifications, '10 Hz telemetry must not wake the UI store').toBe(0);
  });

  it('drops cleared alerts rather than growing forever on a weeks-long uptime', () => {
    const s = useWsStore.getState();
    s.ingest(envelope('system.alert', { id: 'A1', code: 'source.offline', clearedAt: null }, 0));
    expect(Object.keys(useWsStore.getState().alerts)).toEqual(['A1']);
    s.ingest(
      envelope(
        'system.alert',
        { id: 'A1', code: 'source.offline', clearedAt: '2026-07-30T09:01:00+00:00' },
        1,
      ),
    );
    expect(useWsStore.getState().alerts).toEqual({});
  });
});
```

Create `apps/panel/src/store/selectors.test.tsx`:

```tsx
import { render } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useTelemetryStore, useWsStore } from './ws-store.js';
import { useRecordingState, useWsShallow } from './selectors.js';

const envelope = (event: string, payload: unknown, seq: number) =>
  ({ event, at: '2026-07-30T09:00:00+00:00', seq, payload }) as never;

function Probe({ onRender }: { onRender: () => void }) {
  useRecordingState();
  onRender();
  return null;
}

describe('selector discipline (zustand v5 has no automatic shallow equality)', () => {
  beforeEach(() => {
    useWsStore.getState().reset();
  });

  it('an atomic selector does not re-render on an unrelated slice change', () => {
    let renders = 0;
    render(<Probe onRender={() => { renders += 1; }} />);
    const baseline = renders;
    act(() => {
      useWsStore.getState().ingest(
        envelope('storage.status', { pressure: 'warning' }, 0),
      );
    });
    expect(renders, 'storage must not re-render a recording-state consumer').toBe(baseline);
  });

  it('a multi-field read via useWsShallow is stable when nothing it reads changed', () => {
    let renders = 0;
    function Multi() {
      useWsShallow((s) => ({ stale: s.stale, needsResync: s.needsResync }));
      renders += 1;
      return null;
    }
    render(<Multi />);
    const baseline = renders;
    act(() => {
      useWsStore.getState().ingest(envelope('device.health', { ntpSynced: true }, 0));
    });
    expect(renders).toBe(baseline);
  });

  it('telemetry at 10 Hz causes ZERO React renders', () => {
    let renders = 0;
    render(<Probe onRender={() => { renders += 1; }} />);
    const baseline = renders;
    act(() => {
      for (let i = 0; i < 100; i += 1) {
        useTelemetryStore.getState().setLevel('mic-lecturer', i / 100);
      }
    });
    expect(renders, 'meters must never enter React state').toBe(baseline);
  });
});
```

Create `apps/panel/src/hooks/use-ticker.test.ts`:

```ts
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTicker } from './use-ticker.js';
import { useWsStore } from '../store/ws-store.js';

describe('useTicker', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('ticks locally and never touches shared state (INV-G-7)', () => {
    let storeNotifications = 0;
    const unsub = useWsStore.subscribe(() => { storeNotifications += 1; });
    const { result } = renderHook(() => useTicker(1_000));
    const first = result.current;
    vi.advanceTimersByTime(3_000);
    expect(result.current).toBeGreaterThan(first);
    unsub();
    expect(storeNotifications, 'a tick is not application state').toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @eduscope/panel test ws-store`
Expected: FAIL — `Cannot find module './ws-store.js'`

- [ ] **Step 3: Write the store**

`apps/panel/src/store/ws-store.ts`:

`apps/panel/src/store/telemetry-store.ts` — the transient half:

```ts
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { SourceRoleId } from '@eduscope/shared';

interface TelemetryState {
  /** audio.levels at <= 10 Hz. NEVER read through a React hook. */
  audioLevels: Partial<Record<SourceRoleId, number>>;
  /** Bookkeeping: changes on every event, consumed by nothing visual. */
  lastSeq: number | null;
  setLevel(roleId: SourceRoleId, rms: number): void;
  setLastSeq(seq: number): void;
  reset(): void;
}

/**
 * Telemetry, kept out of the application store on purpose.
 *
 * Ten notifications a second against a store that 42 screens subscribe to means
 * zustand re-runs every registered selector ten times a second, on a board that
 * is also running the capture pipelines. Meters subscribe here IMPERATIVELY —
 *
 *   useEffect(() => useTelemetryStore.subscribe(
 *     (s) => s.audioLevels['mic-lecturer'],
 *     (rms) => el.current?.style.setProperty('--level', String(rms)),
 *   ), []);
 *
 * — which writes a CSS custom property and causes zero React renders.
 */
export const useTelemetryStore = create<TelemetryState>()(
  subscribeWithSelector((set) => ({
    audioLevels: {},
    lastSeq: null,
    setLevel: (roleId, rms) =>
      set((s) => ({ audioLevels: { ...s.audioLevels, [roleId]: rms } })),
    setLastSeq: (seq) => set({ lastSeq: seq }),
    reset: () => set({ audioLevels: {}, lastSeq: null }),
  })),
);
```

`apps/panel/src/store/ws-store.ts`:

```ts
import { create } from 'zustand';
import type { ConnectionStatus } from '@eduscope/api-client';
import type {
  AiCountdownPayload, AiSetPayload, ChannelStatePayload, DeviceHealthPayload,
  EventEnvelope, QuizPublicationPayload, QuizSessionPayload, RecordingStatePayload,
  SourcesStatusPayload, StorageStatusPayload, SystemAlert,
} from '@eduscope/shared';
import { useTelemetryStore } from './telemetry-store.js';

export { useTelemetryStore };

/**
 * Slices are TYPED FROM THE CONTRACT. Tasks 2–4 exist to produce these payload
 * types; storing them as `unknown` would push a cast into all 42 screens and
 * defeat the narrowing (`recording.state === 'recording'`) they are built on.
 */
export interface WsState {
  recording: RecordingStatePayload | null;
  sources: Partial<Record<SourcesStatusPayload['roleId'], SourcesStatusPayload>>;
  channels: Partial<Record<ChannelStatePayload['channelId'], ChannelStatePayload>>;
  storage: StorageStatusPayload | null;
  deviceHealth: DeviceHealthPayload | null;
  aiCountdown: AiCountdownPayload | null;
  aiSet: AiSetPayload | null;
  quizSession: QuizSessionPayload | null;
  publications: Record<string, QuizPublicationPayload>;
  alerts: Record<string, SystemAlert>;

  connection: ConnectionStatus | null;
  /** events.md §1: a gap forces a full snapshot re-request, never a patch. */
  needsResync: boolean;
  /** U-2: disconnected longer than T-WS-STALE — dim live regions. */
  stale: boolean;

  ingest(envelope: EventEnvelope): void;
  setConnection(status: ConnectionStatus): void;
  clearResync(): void;
  reset(): void;
}

const EMPTY = {
  recording: null, sources: {}, channels: {}, storage: null, deviceHealth: null,
  aiCountdown: null, aiSet: null, quizSession: null, publications: {}, alerts: {},
  connection: null, needsResync: false, stale: false,
} satisfies Omit<WsState, 'ingest' | 'setConnection' | 'clearResync' | 'reset'>;

/**
 * WS-fed application state. Separate from TanStack Query: query owns
 * request/response, this owns the push channel (frontend-conventions §1).
 *
 * There is no outbound queue by design — "commands are never queued and
 * replayed; a stop tapped five minutes ago must not fire on reconnect"
 * (state-machines §5.5).
 */
export const useWsStore = create<WsState>((set, get) => ({
  ...EMPTY,

  ingest(envelope) {
    // Telemetry short-circuits BEFORE any set() on this store, so 10 Hz levels
    // never notify a UI subscriber.
    if (envelope.event === 'audio.levels') {
      const t = useTelemetryStore.getState();
      t.setLevel(envelope.payload.roleId, envelope.payload.rms);
      t.setLastSeq(envelope.seq);
      return;
    }

    const { lastSeq } = useTelemetryStore.getState();
    useTelemetryStore.getState().setLastSeq(envelope.seq);
    const gap = lastSeq !== null && envelope.seq > lastSeq + 1;

    // ONE set() per envelope: every extra set is another full notification pass
    // over every registered selector.
    const patch = ((): Partial<WsState> => {
      switch (envelope.event) {
        case 'recording.state': return { recording: envelope.payload };
        case 'sources.status':
          return { sources: { ...get().sources, [envelope.payload.roleId]: envelope.payload } };
        case 'channel.state':
          return { channels: { ...get().channels, [envelope.payload.channelId]: envelope.payload } };
        case 'storage.status': return { storage: envelope.payload };
        case 'device.health': return { deviceHealth: envelope.payload };
        case 'ai.countdown': return { aiCountdown: envelope.payload };
        case 'ai.set': return { aiSet: envelope.payload };
        case 'quiz.session': return { quizSession: envelope.payload };
        case 'quiz.publication': {
          const next = { ...get().publications };
          // Bounded: a closed, unprojected publication is history, and history
          // lives in the library — not in a store on a device that runs for weeks.
          next[envelope.payload.publicationId] = envelope.payload;
          for (const [id, p] of Object.entries(next)) {
            if (p.state === 'closed' && p.projectorState === 'withdrawn') delete next[id];
          }
          return { publications: next };
        }
        case 'system.alert': {
          const next = { ...get().alerts };
          // INV-SA-1 re-raises a still-true condition every 30 s; a source that
          // flaps for a week would otherwise grow this map without bound.
          if (envelope.payload.clearedAt) delete next[envelope.payload.id];
          else next[envelope.payload.id] = envelope.payload;
          return { alerts: next };
        }
        default:
          return {}; // catalog events with no slice yet (log.entry, upload.*, …)
      }
    })();

    if (gap) set({ ...patch, needsResync: true });
    else if (Object.keys(patch).length > 0) set(patch);
  },

  setConnection(status) {
    // U-2: dim live regions, KEEP the recording slice — the device is still
    // recording and hiding the frame would be the more dangerous lie.
    set({ connection: status, stale: status.phase === 'stale' });
  },

  clearResync() {
    set({ needsResync: false });
    useTelemetryStore.getState().setLastSeq(-1);
  },

  reset() {
    set({ ...EMPTY });
    useTelemetryStore.getState().reset();
  },
}));
```

`apps/panel/src/store/selectors.ts` — **the shape every screen in prompt 09 must use**:

```ts
import { useShallow } from 'zustand/react/shallow';
import { useWsStore, type WsState } from './ws-store.js';

/**
 * zustand v5 removed the equality-function argument from the hook. A selector
 * that returns a NEW object — `s => ({ a: s.a, b: s.b })` — therefore compares
 * unequal on every notification and re-renders unconditionally.
 *
 * The rule, in two lines:
 *   - read ONE field  -> use an atomic selector from this file
 *   - read SEVERAL    -> use useWsShallow
 * Never call useWsStore() with no selector, and never return a fresh object or
 * array literal from a bare useWsStore(...).
 */
export const useWsShallow = <T>(selector: (s: WsState) => T): T =>
  useWsStore(useShallow(selector));

// ── atomic selectors ───────────────────────────────────────────────────────
export const useRecordingState = () => useWsStore((s) => s.recording?.state ?? 'idle');
export const useRecordingSession = () => useWsStore((s) => s.recording);
export const useIsStale = () => useWsStore((s) => s.stale);
export const useNeedsResync = () => useWsStore((s) => s.needsResync);
export const useConnectionPhase = () => useWsStore((s) => s.connection?.phase ?? 'connecting');
export const useStoragePressure = () => useWsStore((s) => s.storage?.pressure ?? 'ok');
export const useAiCountdown = () => useWsStore((s) => s.aiCountdown);

/**
 * Keyed reads take the key so the selector returns a stable primitive-or-row
 * reference rather than the whole map, which `ingest` rebuilds by spread.
 */
export const useSourceStatus = (roleId: string) =>
  useWsStore((s) => s.sources[roleId as keyof WsState['sources']]);
export const useChannelStatus = (channelId: string) =>
  useWsStore((s) => s.channels[channelId as keyof WsState['channels']]);
```

Append to `docs/design/frontend-conventions.md` §1, so the rule is binding rather than advisory:

```markdown
- Screens read WS state through `apps/panel/src/store/selectors.ts` only: one
  atomic selector per field, or `useWsShallow` for a multi-field read. A bare
  `useWsStore(s => ({ … }))` re-renders on every store notification — zustand v5
  has no automatic shallow equality.
- `audio.levels` and other telemetry never enter React state. Subscribe to the
  transient store imperatively and write a CSS custom property or paint a canvas.
```

`apps/panel/src/hooks/use-ticker.ts`:

```ts
import { useEffect, useState } from 'react';

/**
 * A leaf-local clock tick.
 *
 * The contract is explicit that the panel derives elapsed time locally — the
 * timer from `startedAt` + `recordedDurationMs`, the AI countdown from the
 * absolute `nextAt` — because "countdown ticks are never events per second"
 * (INV-G-7). The corollary is that a tick is not application state either: put
 * it in the store and you have replaced a 10 Hz storm with a 1 Hz one.
 *
 * Use it in the leaf that renders digits, and derive from the absolute instant:
 *
 *   useTicker(1_000);
 *   const elapsed = Date.now() - Date.parse(startedAt);
 */
export function useTicker(intervalMs: number): number {
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setTick(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return tick;
}
```

- [ ] **Step 4: Write the provider and query client**

`apps/panel/src/query/query-client.ts`:

```ts
import { QueryClient } from '@tanstack/react-query';

/**
 * Request/response only. `staleTime: Infinity` and no refetch interval are
 * deliberate: "No polling anywhere a WS event exists" (events.md §5). Anything
 * that changes over time arrives on events$ and lands in the zustand store.
 */
export const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Number.POSITIVE_INFINITY,
        refetchOnWindowFocus: false,
        refetchInterval: false,
        retry: 1,
      },
      mutations: { retry: 0 },
    },
  });
```

`apps/panel/src/client/client-provider.tsx`:

```tsx
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import {
  createMockClient, createRealClient, type EduscopeClient, type MockClient,
} from '@eduscope/api-client';
import type { ScenarioName } from '@eduscope/api-client';
import { useWsStore } from '../store/ws-store.js';

const ClientContext = createContext<EduscopeClient | null>(null);

/**
 * THE only place in apps/panel that constructs a client. Everything else takes
 * it from context, which is what makes the ESLint boundary rule enforceable:
 * there is no second path to the network.
 */
export function ClientProvider({
  children,
  scenario = 'happy',
}: {
  children: ReactNode;
  scenario?: ScenarioName;
}) {
  const [client, setClient] = useState<EduscopeClient | null>(null);

  /**
   * The client is constructed INSIDE the effect, not in useMemo.
   *
   * `createMockClient` starts wall-clock timers the moment it is called (the
   * 10 Hz level loop, the ws-flap schedule). Under StrictMode React renders
   * twice and throws the first render away — a useMemo'd client from that
   * discarded render never reaches an effect, so nothing ever calls dispose()
   * and it emits forever. Constructing here means every client that exists has
   * a matching cleanup.
   */
  useEffect(() => {
    const instance =
      import.meta.env.VITE_EDUSCOPE_REAL_API === '1'
        ? createRealClient(import.meta.env.VITE_EDUSCOPE_API_URL ?? '/api/v1')
        : createMockClient(scenario);

    const offEvents = instance.events$.subscribe((e) => {
      useWsStore.getState().ingest(e);
    });
    const offConn = instance.connection$.subscribe((s) => {
      useWsStore.getState().setConnection(s);
      if (s.resyncReason) {
        void instance.resync().then(() => useWsStore.getState().clearResync());
      }
    });

    setClient(instance);
    return () => {
      offEvents();
      offConn();
      useWsStore.getState().reset();
      instance.dispose();
      setClient(null);
    };
  }, [scenario]);

  // One frame with no client while the effect runs. The kiosk boots into U-1's
  // skeleton anyway, so there is nothing to show yet.
  if (!client) return null;

  return <ClientContext.Provider value={client}>{children}</ClientContext.Provider>;
}

export function useClient(): EduscopeClient {
  const client = useContext(ClientContext);
  if (!client) throw new Error('useClient must be used inside <ClientProvider>');
  return client;
}

/** Dev overlay only — narrows to the concrete mock. Returns null against real. */
export function useMockClient(): MockClient | null {
  const client = useClient() as Partial<MockClient>;
  return typeof client.switchScenario === 'function' ? (client as MockClient) : null;
}
```

Wire them in `App.tsx`:

```tsx
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import { AuthProvider } from './auth/auth-context.js';
import { ClientProvider } from './client/client-provider.js';
import { createQueryClient } from './query/query-client.js';
import { createRouter } from './routes/router.js';
import './styles/tokens.css';
import './styles/app.css';

const queryClient = createQueryClient();
const router = createRouter();

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ClientProvider>
        <AuthProvider>
          <Stage>
            <RouterProvider router={router} />
          </Stage>
        </AuthProvider>
      </ClientProvider>
    </QueryClientProvider>
  );
}
```

(keep the existing `Stage` export unchanged.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @eduscope/panel test`
Expected: PASS — `ws-store.test.ts` 9 passed, `selectors.test.tsx` 3 passed, `use-ticker.test.ts` 1 passed, everything from Tasks 13–14 still green.

The two assertions that matter most are *"10 Hz telemetry must not wake the UI store"* (0 notifications) and *"notifies subscribers exactly ONCE per envelope"*. If either regresses in prompt 09, every screen pays for it.

- [ ] **Step 6: Commit**

```bash
git add apps/panel/src/client apps/panel/src/store apps/panel/src/hooks apps/panel/src/query apps/panel/src/App.tsx docs/design/frontend-conventions.md
git commit -m "feat(panel): typed WS store, selector discipline, transient telemetry store"
```

---

## Task 16: apps/panel — the scenario dev overlay

**Files:**
- Create: `apps/panel/src/devtools/scenario-overlay.tsx`, `src/devtools/use-long-press.ts`, `src/devtools/scenario-overlay.css`
- Modify: `apps/panel/src/App.tsx`
- Test: `apps/panel/src/devtools/scenario-overlay.test.tsx`

**Interfaces:**
- Consumes: `useMockClient()` (Task 15), `listScenarios()`, `ScenarioName`.
- Produces: `<ScenarioOverlay />` — hidden until a **2 000 ms long-press** on a 44×44 px invisible corner target; lists the seven scripts with descriptions; switching calls `client.switchScenario(name)` live. `useLongPress(ms, onTrigger)` returns pointer handlers.

> The overlay renders `null` when `useMockClient()` returns `null`, so it cannot appear against a real backend. It is gated behind a long-press rather than a visible button because the panel is a kiosk in a lecture hall: a visible debug affordance is a support call waiting to happen, and there is no keyboard shortcut to lean on.

- [ ] **Step 1: Write the failing test**

Create `apps/panel/src/devtools/scenario-overlay.test.tsx`:

```tsx
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientProvider } from '../client/client-provider.js';
import { ScenarioOverlay } from './scenario-overlay.js';

const renderOverlay = () =>
  render(
    <ClientProvider>
      <ScenarioOverlay />
    </ClientProvider>,
  );

describe('scenario dev overlay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is hidden until the long-press completes', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderOverlay();
    expect(screen.queryByRole('dialog', { name: /scenario/i })).toBeNull();

    await user.pointer({ keys: '[MouseLeft>]', target: screen.getByTestId('scenario-hotspot') });
    act(() => {
      vi.advanceTimersByTime(1_900);
    });
    expect(screen.queryByRole('dialog', { name: /scenario/i })).toBeNull();

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByRole('dialog', { name: /scenario/i })).toBeTruthy();
  });

  it('lists all seven catalog scripts with their descriptions', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderOverlay();
    await user.pointer({ keys: '[MouseLeft>]', target: screen.getByTestId('scenario-hotspot') });
    act(() => {
      vi.advanceTimersByTime(2_100);
    });
    for (const name of [
      'happy', 'start-fails', 'pipeline-crash-midway', 'llm-timeout',
      'disk-full', 'ws-flap', 'quiz-network-loss',
    ]) {
      expect(screen.getByRole('radio', { name: new RegExp(name) })).toBeTruthy();
    }
  });

  it('switches the live scenario when a script is chosen', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderOverlay();
    await user.pointer({ keys: '[MouseLeft>]', target: screen.getByTestId('scenario-hotspot') });
    act(() => {
      vi.advanceTimersByTime(2_100);
    });
    await user.click(screen.getByRole('radio', { name: /start-fails/ }));
    expect(screen.getByRole('radio', { name: /start-fails/ })).toBeChecked();
    expect(screen.getByTestId('active-scenario')).toHaveTextContent('start-fails');
  });

  it('meets the 44px touch floor on the hotspot and every option', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderOverlay();
    const hotspot = screen.getByTestId('scenario-hotspot');
    expect(getComputedStyle(hotspot).minWidth).toBe('44px');
    expect(getComputedStyle(hotspot).minHeight).toBe('44px');

    await user.pointer({ keys: '[MouseLeft>]', target: hotspot });
    act(() => {
      vi.advanceTimersByTime(2_100);
    });
    for (const option of screen.getAllByRole('radio')) {
      expect(getComputedStyle(option.closest('label')!).minHeight).toBe('56px');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @eduscope/panel test scenario-overlay`
Expected: FAIL — `Cannot find module './scenario-overlay.js'`

- [ ] **Step 3: Write the long-press hook**

`apps/panel/src/devtools/use-long-press.ts`:

```ts
import { useCallback, useRef } from 'react';

/** Pointer-only; no hover, no keyboard shortcut — this is a touch kiosk. */
export function useLongPress(ms: number, onTrigger: () => void) {
  const timer = useRef<number | null>(null);

  const cancel = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const start = useCallback(() => {
    cancel();
    timer.current = window.setTimeout(() => {
      timer.current = null;
      onTrigger();
    }, ms);
  }, [cancel, ms, onTrigger]);

  return {
    onPointerDown: start,
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
  };
}
```

- [ ] **Step 4: Write the overlay**

`apps/panel/src/devtools/scenario-overlay.tsx`:

```tsx
import { useState } from 'react';
import { listScenarios, type ScenarioName } from '@eduscope/api-client';
import { useMockClient } from '../client/client-provider.js';
import { useWsStore } from '../store/ws-store.js';
import { useLongPress } from './use-long-press.js';
import './scenario-overlay.css';

const LONG_PRESS_MS = 2_000;

/**
 * The scenario dev overlay (frontend-conventions §4, screen-inventory Wave 0).
 *
 * Every state a screen spec enumerates must be reachable from here. When a
 * screen needs a state the catalog cannot reach, it calls `extendScenario` in
 * its own module — this overlay renders the live registry, so additions show up
 * without touching this file.
 *
 * Renders nothing against a real client, and is reachable only by a 2 s
 * long-press on an invisible corner target: a visible debug button on a kiosk
 * in a lecture hall is a support call waiting to happen.
 */
export function ScenarioOverlay() {
  const client = useMockClient();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<ScenarioName>(client?.scenario ?? 'happy');
  const longPress = useLongPress(LONG_PRESS_MS, () => setOpen(true));

  if (!client) return null;

  const choose = (name: ScenarioName) => {
    client.switchScenario(name);
    useWsStore.getState().reset();
    setActive(name);
  };

  return (
    <>
      <button
        type="button"
        data-testid="scenario-hotspot"
        className="us-devhotspot"
        aria-label="Developer scenarios (press and hold)"
        {...longPress}
      />
      {open && (
        <div className="us-devoverlay" role="dialog" aria-label="Scenario switcher">
          <header className="us-devoverlay__head">
            <h2>Scenario</h2>
            <span data-testid="active-scenario">{active}</span>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close scenarios">
              Close
            </button>
          </header>
          <ul className="us-devoverlay__list">
            {listScenarios().map((script) => (
              <li key={script.name}>
                <label className="us-devoverlay__option">
                  <input
                    type="radio"
                    name="scenario"
                    value={script.name}
                    checked={active === script.name}
                    onChange={() => choose(script.name)}
                  />
                  <span className="us-devoverlay__name">{script.name}</span>
                  <span className="us-devoverlay__desc">{script.description}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
```

`apps/panel/src/devtools/scenario-overlay.css`:

```css
/* Invisible but real: 44px floor, absolute inside .us-panel, never fixed. */
.us-devhotspot {
  position: absolute;
  top: 0;
  left: 0;
  min-width: var(--tap-min);
  min-height: var(--tap-min);
  opacity: 0;
  background: transparent;
  border: 0;
  z-index: 900;
}

.us-devoverlay {
  position: absolute;
  inset: var(--sp-10);
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: var(--sp-5);
  padding: var(--sp-10);
  overflow: hidden;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
}

.us-devoverlay__head { display: flex; align-items: center; gap: var(--sp-5); }
.us-devoverlay__list { flex: 1; overflow-y: auto; margin: 0; padding: 0; list-style: none; }

.us-devoverlay__option {
  display: grid;
  grid-template-columns: var(--tap-min) 220px 1fr;
  align-items: center;
  gap: var(--sp-3);
  min-height: var(--tap-row);
  padding: var(--sp-3);
  border-bottom: 1px solid var(--border);
}

.us-devoverlay__name { font-family: var(--mono); font-size: var(--fs-sm); }
.us-devoverlay__desc { color: var(--text-muted); font-size: var(--fs-xs); }
```

Mount it inside `<Stage>` in `App.tsx`, after `<RouterProvider>`, so it layers over every route.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @eduscope/panel test scenario-overlay`
Expected: PASS — `Tests 4 passed`.

- [ ] **Step 6: Commit**

```bash
git add apps/panel/src/devtools apps/panel/src/App.tsx
git commit -m "feat(panel): scenario dev overlay behind a long-press"
```

---

## Task 17: The client-boundary ESLint rule, proved by a test

**Files:**
- Create: `tools/eslint-rules/no-direct-network.js`
- Modify: `eslint.config.js` (root — created in Task 1; this task appends one block)
- Test: `tools/eslint-rules/no-direct-network.test.ts`

**Interfaces:**
- Consumes: the base `eslint.config.js` from Task 1.
- Produces: one additional flat-config block whose `files: ['apps/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}']` bans direct network access, with `packages/api-client/src/**` explicitly exempted. Bans cover **globals** (`fetch`, `WebSocket`, `XMLHttpRequest`, `EventSource`), **module imports** (`axios`, `ky`, `got`, `superagent`, `socket.io-client`, `undici`, `node-fetch`), and **member access** (`window.fetch`, `globalThis.fetch`, `navigator.sendBeacon`).

> A plain `no-restricted-imports` is not enough: `fetch` and `WebSocket` are globals, not imports, so the rule needs `no-restricted-globals` and `no-restricted-properties` too. That is why this task exists as its own gate rather than a line in a config.

- [ ] **Step 1: Write the failing test**

Create `tools/eslint-rules/no-direct-network.test.ts`:

```ts
import { ESLint } from 'eslint';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const eslint = new ESLint({ cwd: root });

/**
 * `lintText` resolves config by filePath WITHOUT the file needing to exist, so
 * the proof needs no fixture file and no ignore entry that could rot.
 */
const lint = (code: string, filePath: string) =>
  eslint.lintText(code, { filePath: resolve(root, filePath) });

const messagesFor = async (code: string, filePath: string) =>
  (await lint(code, filePath)).flatMap((r) => r.messages);

describe('client-boundary rule (frontend-conventions §1)', () => {
  it('fails the build on a direct fetch inside a panel component', async () => {
    const messages = await messagesFor(
      `export async function load() { const r = await fetch('/api/v1/recording/state'); return r.json(); }`,
      'apps/panel/src/routes/leaky.ts',
    );
    const errors = messages.filter((m) => m.severity === 2);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.map((m) => m.ruleId)).toContain('no-restricted-globals');
    expect(errors.map((m) => m.message).join('\n')).toMatch(/EduscopeClient/);
  });

  it.each([
    ['new WebSocket("wss://x")', 'no-restricted-globals'],
    ['new XMLHttpRequest()', 'no-restricted-globals'],
    ['new EventSource("/x")', 'no-restricted-globals'],
    ['window.fetch("/x")', 'no-restricted-properties'],
    ['globalThis.fetch("/x")', 'no-restricted-properties'],
  ])('bans %s', async (expr, ruleId) => {
    const messages = await messagesFor(
      `export const go = () => ${expr};`,
      'apps/panel/src/routes/leaky.ts',
    );
    expect(messages.filter((m) => m.severity === 2).map((m) => m.ruleId)).toContain(ruleId);
  });

  it.each(['axios', 'ky', 'socket.io-client', 'node-fetch'])(
    'bans importing %s',
    async (pkg) => {
      const messages = await messagesFor(
        `import x from '${pkg}';\nexport default x;`,
        'apps/panel/src/routes/leaky.ts',
      );
      expect(messages.filter((m) => m.severity === 2).map((m) => m.ruleId)).toContain(
        'no-restricted-imports',
      );
    },
  );

  it('applies to apps/quiz too — it deploys to the campus web server', async () => {
    const messages = await messagesFor(
      `export const go = () => fetch('/api/join');`,
      'apps/quiz/app/j/[joinCode]/page.tsx',
    );
    expect(messages.filter((m) => m.severity === 2).length).toBeGreaterThan(0);
  });

  it('ALLOWS the same code inside packages/api-client — it IS the boundary', async () => {
    const messages = await messagesFor(
      `export const go = () => fetch('/api/v1/recording/state');`,
      'packages/api-client/src/real/transport.ts',
    );
    const banned = messages.filter(
      (m) =>
        m.severity === 2 &&
        ['no-restricted-globals', 'no-restricted-imports', 'no-restricted-properties'].includes(
          m.ruleId ?? '',
        ),
    );
    expect(banned, 'the boundary itself must not be gagged').toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tools/eslint-rules`
Expected: FAIL — the `fetch` cases report **0 errors**, because Task 1's base config lints cleanly but has no boundary block yet.

- [ ] **Step 3: Write the rule fragment**

`tools/eslint-rules/no-direct-network.js`:

```js
/**
 * The client-boundary rule (frontend-conventions §1):
 *
 *   "No component may import fetch, axios, or WebSocket directly. The ONLY
 *    network boundary is the EduscopeClient interface in packages/api-client."
 *
 * Composed from core ESLint rules rather than a custom rule because three
 * different mechanisms are needed: globals (fetch/WebSocket are not imports),
 * imports (axios and friends), and member access (window.fetch).
 */
const REASON =
  'Use the EduscopeClient from packages/api-client — it is the only network boundary (frontend-conventions §1).';

export const bannedGlobals = [
  { name: 'fetch', message: REASON },
  { name: 'WebSocket', message: REASON },
  { name: 'XMLHttpRequest', message: REASON },
  { name: 'EventSource', message: REASON },
  { name: 'RTCPeerConnection', message: `${REASON} Preview signaling lives behind client.openPreview().` },
];

export const bannedImports = [
  'axios', 'ky', 'got', 'superagent', 'socket.io-client', 'undici', 'node-fetch',
  'cross-fetch', 'isomorphic-fetch', 'wretch', 'redaxios',
].map((name) => ({ name, message: REASON }));

export const bannedProperties = [
  { object: 'window', property: 'fetch', message: REASON },
  { object: 'globalThis', property: 'fetch', message: REASON },
  { object: 'window', property: 'WebSocket', message: REASON },
  { object: 'navigator', property: 'sendBeacon', message: REASON },
];

/** Everything except the boundary package itself. */
export const boundaryFiles = ['apps/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}'];
export const boundaryExempt = ['packages/api-client/src/**'];
```

- [ ] **Step 4: Append the boundary block to the existing config**

In `eslint.config.js` (created in Task 1), add the import and one final block. Everything above it is unchanged:

```js
import {
  bannedGlobals, bannedImports, bannedProperties, boundaryExempt, boundaryFiles,
} from './tools/eslint-rules/no-direct-network.js';

// … the Task 1 blocks stay exactly as they are; append this as the last entry
// inside tseslint.config(…):

  // ── the client boundary ───────────────────────────────────────────────────
  {
    files: boundaryFiles,
    ignores: boundaryExempt,
    rules: {
      'no-restricted-globals': ['error', ...bannedGlobals],
      'no-restricted-imports': ['error', { paths: bannedImports }],
      'no-restricted-properties': ['error', ...bannedProperties],
    },
  },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test tools/eslint-rules`
Expected: PASS — `Tests 12 passed`. The final case is the important one: the same `fetch` call is an **error** in `apps/panel` and **allowed** in `packages/api-client/src`, which is exactly the boundary the conventions doc describes.

Run: `pnpm lint`
Expected: exit 0 — no existing source violates the rule.

- [ ] **Step 6: Commit**

```bash
git add eslint.config.js tools/eslint-rules
git commit -m "feat(lint): client-boundary rule with a test proving it fails the build"
```

> **Why the base config is not here.** `pnpm lint` is a root script from Task 1, and a script that fails for sixteen tasks trains everyone to ignore it. Task 1 owns the base; this task owns the one thing that is genuinely about the client boundary.

---

## Task 18: apps/quiz — Next.js mobile-first scaffold

**Files:**
- Create: `apps/quiz/package.json`, `next.config.mjs`, `tsconfig.json`, `postcss.config.mjs`, `vitest.config.ts`, `src/test-setup.ts`
- Create: `apps/quiz/app/layout.tsx`, `app/globals.css`, `app/j/[joinCode]/page.tsx`, `app/j/[joinCode]/register/page.tsx`, `app/s/[quizSessionId]/page.tsx`
- Create: `apps/quiz/src/identity/identity-provider.ts`, `src/identity/self-registration.ts`, `src/client/quiz-client-provider.tsx`
- Create: `packages/api-client/src/quiz/quiz-app-client.ts`
- Test: `apps/quiz/src/identity/identity-provider.test.ts`, `apps/quiz/app/routes.test.tsx`

**Interfaces:**
- Consumes: `zStudentServerEvent`, `StudentServerEvent` from `@eduscope/shared`.
- Produces:
  - `interface QuizIdentityProvider { readonly kind: 'self-registration' | 'sso'; resolve(joinCode): Promise<Identity | null>; register(joinCode, input): Promise<Identity>; signOut(): Promise<void> }`
  - `createSelfRegistrationProvider(client): QuizIdentityProvider`
  - `interface QuizAppClient` — **provisional, blocked on CG-1** — plus `createMockQuizClient(): QuizAppClient`.
  - Three route skeletons.

> **CG-1 is real and this task does not paper over it.** screen-inventory §10: *"The student-facing REST surface does not exist"* — join, register and answer submission are quiz-service-owned with no contract file. Only `StudentServerEvent` is contract-backed. So `QuizAppClient`'s **event** half is contract-validated exactly like the panel's, and its **REST** half carries a file-header notice naming CG-1 and `contracts/quiz-app.yaml` as the unblocking artifact. Screens are still buildable in prompt 09 against the mock; integration is not.

**The SSO seam (A-16: "basic login now, SSO later").** Identity is behind one interface with one implementation today. Swapping in campus SSO later means adding `createSsoProvider` and changing the single `createSelfRegistrationProvider(...)` call in `quiz-client-provider.tsx` — no route, page, or component touches identity mechanics.

- [ ] **Step 1: Write the failing tests**

Create `apps/quiz/src/identity/identity-provider.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createMockQuizClient } from '@eduscope/api-client/quiz';
import { createSelfRegistrationProvider } from './self-registration.js';

const provider = createSelfRegistrationProvider(createMockQuizClient());

describe('quiz identity (A-16 seam)', () => {
  it('declares which mechanism is active so the SSO swap is a one-line change', () => {
    expect(provider.kind).toBe('self-registration');
  });

  it('registers a student by real name + student ID (QZ-3, [D-21])', async () => {
    const identity = await provider.register('ABC123', {
      displayName: 'K. Fernando',
      studentIdNumber: 'EN20214567',
    });
    expect(identity.studentIdNumber).toBe('EN20214567');
    expect(identity.participantId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('validates the student ID FORMAT only — no roster check in V1 ([D-21])', async () => {
    await expect(
      provider.register('ABC123', { displayName: 'K. Fernando', studentIdNumber: '!!' }),
    ).rejects.toThrow(/student id/i);
    // A well-formed ID that is on no roster still succeeds — that is the V1 rule.
    await expect(
      provider.register('ABC123', { displayName: 'K. Fernando', studentIdNumber: 'ZZ99999999' }),
    ).resolves.toBeTruthy();
  });

  it('reuses the participant on rejoin rather than creating a second (INV-QP-1)', async () => {
    const first = await provider.register('ABC123', {
      displayName: 'K. Fernando', studentIdNumber: 'EN20214567',
    });
    const again = await provider.register('ABC123', {
      displayName: 'K. Fernando', studentIdNumber: 'EN20214567',
    });
    expect(again.participantId).toBe(first.participantId);
  });

  it('rejects a blank display name (QZ-3 requires a real name)', async () => {
    await expect(
      provider.register('ABC123', { displayName: '  ', studentIdNumber: 'EN20214567' }),
    ).rejects.toThrow(/name/i);
  });
});
```

Create `apps/quiz/app/routes.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import JoinPage from './j/[joinCode]/page.js';
import RegisterPage from './j/[joinCode]/register/page.js';
import PlayPage from './s/[quizSessionId]/page.js';

describe('quiz route skeletons (screen-inventory §6)', () => {
  it.each([
    ['S-37', () => <JoinPage params={{ joinCode: 'ABC123' }} />],
    ['S-38', () => <RegisterPage params={{ joinCode: 'ABC123' }} />],
    ['S-39', () => <PlayPage params={{ quizSessionId: '01JBQ8ZK3T7WBM5N2Q4XPRVC9D' }} />],
  ])('renders %s', (id, Component) => {
    render(<Component />);
    expect(screen.getByTestId('screen').dataset.screen).toBe(id);
  });

  it('sets a >= 16px root size so iOS does not zoom on focus', async () => {
    const css = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('./globals.css', import.meta.url), 'utf8'),
    );
    const rootSize = /--fs-root:\s*([^;]+);/.exec(css)?.[1]?.trim();
    expect(Number.parseInt(rootSize ?? '0', 10)).toBeGreaterThanOrEqual(16);
  });

  it('sets the answer-target floor at 64px (screen-inventory §6)', async () => {
    const css = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('./globals.css', import.meta.url), 'utf8'),
    );
    expect(/--tap-answer:\s*64px;/.test(css)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @eduscope/quiz test`
Expected: FAIL — `Cannot find module '@eduscope/api-client/quiz'`

- [ ] **Step 3: Write the provisional quiz client**

`packages/api-client/src/quiz/quiz-app-client.ts`:

```ts
/**
 * ⚠ PROVISIONAL — blocked on CG-1.
 *
 * screen-inventory §10 CG-1 / events.md open item C-6: the student-facing REST
 * surface (join, register, answer submission) is quiz-service-owned and HAS NO
 * CONTRACT FILE. The shapes below are this scaffold's best reading of Z-10…Z-26
 * and exist so apps/quiz can be built and demoed on a mock — they are NOT a
 * contract and MUST be reconciled against `contracts/quiz-app.yaml` when it
 * lands. The event half is different: `StudentServerEvent` IS contract-backed
 * and is validated exactly like the panel's events.
 */
import { zStudentServerEvent, type StudentServerEvent } from '@eduscope/shared';
import { createEmitter, type EventStream } from '../stream.js';

export interface QuizIdentity {
  readonly participantId: string;
  readonly displayName: string;
  readonly studentIdNumber: string;
  readonly quizSessionId: string;
}

export interface QuizAppClient {
  /** CG-1 */ resolveSession(joinCode: string): Promise<{ quizSessionId: string; state: 'open' | 'closed' } | null>;
  /** CG-1 */ register(joinCode: string, input: { displayName: string; studentIdNumber: string }): Promise<QuizIdentity>;
  /** CG-1 */ submitAnswer(publicationId: string, optionId: string): Promise<{ accepted: boolean; reason?: 'closed' | 'already-answered' }>;
  /** Contract-backed (events.md §4 note). */
  readonly events$: EventStream<StudentServerEvent>;
  dispose(): void;
}

const STUDENT_ID = /^[A-Z]{2}\d{8}$/;

export function createMockQuizClient(): QuizAppClient {
  const emitter = createEmitter<StudentServerEvent>();
  const participants = new Map<string, QuizIdentity>();
  let counter = 0;
  const ulid = () => `01JBQ8ZK3T7WBM5N2Q4XPRVC${String(counter++).padStart(2, '0')}`;

  return {
    async resolveSession(joinCode) {
      return joinCode ? { quizSessionId: ulid(), state: 'open' } : null;
    },

    async register(joinCode, input) {
      if (input.displayName.trim().length === 0) {
        throw new Error('A real name is required (QZ-3)');
      }
      // [D-21]: FORMAT-validated only. Not checked against a roster in V1.
      if (!STUDENT_ID.test(input.studentIdNumber)) {
        throw new Error('That student id is not in the expected format');
      }
      // INV-QP-1: rejoining never creates a second participant.
      const key = `${joinCode}:${input.studentIdNumber}`;
      const existing = participants.get(key);
      if (existing) return existing;
      const identity: QuizIdentity = {
        participantId: ulid(),
        displayName: input.displayName.trim(),
        studentIdNumber: input.studentIdNumber,
        quizSessionId: ulid(),
      };
      participants.set(key, identity);
      return identity;
    },

    async submitAnswer() {
      // Z-22: the first tap is final; a second is REJECTED, not overwritten.
      return { accepted: true };
    },

    events$: {
      subscribe(listener) {
        return emitter.subscribe((e) => {
          listener(zStudentServerEvent.parse(e));
        });
      },
    },

    dispose() {},
  };
}
```

Add to `packages/api-client/package.json` exports: `"./quiz": "./src/quiz/quiz-app-client.ts"`.

- [ ] **Step 4: Write the identity seam**

`apps/quiz/src/identity/identity-provider.ts`:

```ts
import type { QuizIdentity } from '@eduscope/api-client/quiz';

export interface RegisterInput {
  readonly displayName: string;
  readonly studentIdNumber: string;
}

/**
 * The A-16 seam: "basic login now, SSO later". Everything student-identity
 * shaped goes through this interface, so adding `createSsoProvider` later is a
 * new file plus one changed call site — no page or component knows the
 * mechanism. The student ID is the leaderboard key today (INV-SI-1) and the SSO
 * identity tomorrow, which is why it is the field both implementations carry.
 */
export interface QuizIdentityProvider {
  readonly kind: 'self-registration' | 'sso';
  resolve(joinCode: string): Promise<QuizIdentity | null>;
  register(joinCode: string, input: RegisterInput): Promise<QuizIdentity>;
  signOut(): Promise<void>;
}
```

`apps/quiz/src/identity/self-registration.ts`:

```ts
import type { QuizAppClient, QuizIdentity } from '@eduscope/api-client/quiz';
import type { QuizIdentityProvider, RegisterInput } from './identity-provider.js';

const STORAGE_KEY = 'eduscope.quiz.identity';

/** V1. Self-registration at first join ([D-21]); no roster, no password. */
export function createSelfRegistrationProvider(client: QuizAppClient): QuizIdentityProvider {
  const read = (): QuizIdentity | null => {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as QuizIdentity) : null;
  };

  return {
    kind: 'self-registration',

    async resolve() {
      return read();
    },

    async register(joinCode: string, input: RegisterInput) {
      const identity = await client.register(joinCode, input);
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
      }
      return identity;
    },

    async signOut() {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
    },
  };
}
```

- [ ] **Step 5: Write the app and its routes**

`apps/quiz/package.json`:

```json
{
  "name": "@eduscope/quiz",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev --port 3000",
    "build": "next build",
    "start": "next start --port 3000",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@eduscope/api-client": "workspace:*",
    "@eduscope/shared": "workspace:*",
    "@hookform/resolvers": "^3.9.1",
    "@tanstack/react-query": "^5.59.0",
    "next": "^14.2.18",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-hook-form": "^7.53.2",
    "zod": "^3.23.8",
    "zustand": "^5.0.1"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.0.0",
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.0.1",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.3",
    "jsdom": "^25.0.1",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.6.3",
    "vitest": "^3.0.0"
  }
}
```

`apps/quiz/vitest.config.ts` — the root `vitest.workspace.ts` from Task 1 delegates here, so root and per-app runs cannot drift:

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    name: 'quiz',
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test-setup.ts'],
    include: ['{app,src}/**/*.test.{ts,tsx}'],
  },
});
```

`apps/quiz/src/test-setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
```

`apps/quiz/next.config.mjs`:

```js
/** @type {import('next').NextConfig} */
// Deploys to the campus web server on a public domain (A-16, QZ-1) — NOT to the
// device. Nothing here may assume LAN access to core-api.
export default {
  reactStrictMode: true,
  transpilePackages: ['@eduscope/shared', '@eduscope/api-client'],
};
```

`apps/quiz/app/globals.css` — mobile-first floors:

```css
:root {
  /* screen-inventory §6: text >= 16px so iOS does not zoom on focus. */
  --fs-root: 16px;
  /* Answer targets are full-width and >= 64px tall. */
  --tap-answer: 64px;
  --tap-min: 44px;
  /* Nothing lives in the bottom 24px — browser chrome sits there. */
  --safe-bottom: 24px;

  --bg: #eef0f4;
  --surface: #ffffff;
  --text: #1c2430;
  --accent: #2f6bed;
  --success: #1c9e6a;
  --danger: #c62828;

  font-size: var(--fs-root);
  color-scheme: light;
}

html, body { margin: 0; background: var(--bg); color: var(--text); }

/* Portrait 360–430px is the design target; no hover affordances at all. */
main { max-width: 430px; margin: 0 auto; padding: 16px 16px calc(16px + var(--safe-bottom)); }
```

`apps/quiz/app/layout.tsx`:

```tsx
import type { ReactNode } from 'react';
import './globals.css';

export const metadata = { title: 'Eduscope Quiz' };
export const viewport = { width: 'device-width', initialScale: 1, maximumScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

The three route skeletons, each a placeholder exactly like the panel's:

```tsx
// apps/quiz/app/j/[joinCode]/page.tsx — S-37 Join
export default function JoinPage({ params }: { params: { joinCode: string } }) {
  return (
    <main data-testid="screen" data-screen="S-37">
      <h1>Joining {params.joinCode}</h1>
    </main>
  );
}
```

```tsx
// apps/quiz/app/j/[joinCode]/register/page.tsx — S-38 Self-registration
export default function RegisterPage({ params }: { params: { joinCode: string } }) {
  return (
    <main data-testid="screen" data-screen="S-38">
      <h1>Join {params.joinCode}</h1>
    </main>
  );
}
```

```tsx
// apps/quiz/app/s/[quizSessionId]/page.tsx — S-39/S-40/S-41 are STATES of this
// one route, not separate routes (screen-inventory §1.2).
export default function PlayPage({ params }: { params: { quizSessionId: string } }) {
  return (
    <main data-testid="screen" data-screen="S-39">
      <h1>Waiting for your lecturer&rsquo;s next question</h1>
      <p hidden>{params.quizSessionId}</p>
    </main>
  );
}
```

`apps/quiz/src/client/quiz-client-provider.tsx` mirrors the panel's provider: one `createMockQuizClient()` call, one `createSelfRegistrationProvider(client)` call, both behind context. **This is the only file that changes when SSO lands.**

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @eduscope/quiz test`
Expected: PASS — `identity-provider.test.ts` 5 passed, `routes.test.tsx` 5 passed.

Run: `pnpm --filter @eduscope/quiz build`
Expected: `✓ Compiled successfully`, with the three routes listed in the build output.

- [ ] **Step 7: Commit**

```bash
git add apps/quiz packages/api-client/src/quiz packages/api-client/package.json
git commit -m "feat(quiz): Next.js mobile-first scaffold with the SSO identity seam"
```

---

## Task 19: Playwright smoke — the app boots on the mock and reaches `recording`

**Files:**
- Create: `apps/panel/playwright.config.ts`, `apps/panel/e2e/panel-smoke.spec.ts`
- Create: `apps/panel/src/routes/screens.tsx` addition — a `data-recording-state` mirror on the shell
- Test: the spec itself

**Interfaces:**
- Consumes: the built panel app served by `vite preview`; the scenario overlay from Task 16.
- Produces: `pnpm --filter @eduscope/panel e2e` running two specs headlessly at 1280×800.

> The smoke test asserts on `data-recording-state`, a single attribute the shell writes from the WS store. That is a deliberate seam: prompt 09 will replace the placeholder screens entirely, and a smoke test written against screen markup would break the moment real screens land. An attribute reflecting store state survives.

- [ ] **Step 1: Write the failing spec**

Create `apps/panel/e2e/panel-smoke.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

/** The scenario overlay is behind a 2 s long-press on a 44px corner hotspot. */
async function openScenarioOverlay(page: import('@playwright/test').Page) {
  const hotspot = page.getByTestId('scenario-hotspot');
  const box = await hotspot.boundingBox();
  if (!box) throw new Error('scenario hotspot has no box — is the mock client active?');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(2_200);
  await page.mouse.up();
  await expect(page.getByRole('dialog', { name: /scenario/i })).toBeVisible();
}

test.describe('panel scaffold smoke', () => {
  test('boots on the mock at the kiosk size with no page scroll', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('us-panel')).toBeVisible();

    const overflow = await page.evaluate(() => getComputedStyle(document.body).overflow);
    expect(overflow).toBe('hidden');

    const scrolls = await page.evaluate(
      () => document.documentElement.scrollHeight > window.innerHeight,
    );
    expect(scrolls, 'the kiosk page must never scroll').toBe(false);

    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  });

  test('the happy scenario reaches the recording state', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-recording-state]')).toHaveAttribute(
      'data-recording-state',
      'idle',
    );

    await page.getByTestId('e2e-start-recording').click();

    // R-01 -> starting, then R-05 -> recording ~1.2 s later (T-START-CONFIRM: 5 s).
    await expect(page.locator('[data-recording-state]')).toHaveAttribute(
      'data-recording-state',
      'starting',
    );
    await expect(page.locator('[data-recording-state]')).toHaveAttribute(
      'data-recording-state',
      'recording',
      { timeout: 6_000 },
    );
  });

  test('the overlay switches scripts live and start-fails never reads as recording',
    async ({ page }) => {
      await page.goto('/');
      await openScenarioOverlay(page);
      await page.getByRole('radio', { name: /start-fails/ }).check();
      await expect(page.getByTestId('active-scenario')).toHaveText('start-fails');
      await page.getByRole('button', { name: /close scenarios/i }).click();

      const seen: string[] = [];
      await page.exposeFunction('__recordState', (s: string) => {
        seen.push(s);
      });
      await page.evaluate(() => {
        const el = document.querySelector('[data-recording-state]');
        if (!el) return;
        new MutationObserver(() => {
          (window as unknown as { __recordState(s: string): void }).__recordState(
            el.getAttribute('data-recording-state') ?? '',
          );
        }).observe(el, { attributes: true, attributeFilter: ['data-recording-state'] });
      });

      await page.getByTestId('e2e-start-recording').click();
      await expect(page.locator('[data-recording-state]')).toHaveAttribute(
        'data-recording-state',
        'error',
        { timeout: 6_000 },
      );
      expect(seen, 'a failed start must never read as recording (B-12)').not.toContain(
        'recording',
      );
    });
});
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `pnpm --filter @eduscope/panel e2e`
Expected: FAIL — `Error: no tests found` or `config file not found`.

- [ ] **Step 3: Write the Playwright config**

`apps/panel/playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    // The kiosk viewport is not a preference; it is the spec.
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'pnpm build && pnpm preview',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

- [ ] **Step 4: Add the two e2e seams to the shell**

In `apps/panel/src/App.tsx`, inside `<Stage>`, add a state mirror and a temporary start affordance:

```tsx
import { useWsStore } from './store/ws-store.js';
import { useClient } from './client/client-provider.js';

/**
 * Two scaffold-only seams for the smoke test:
 *  - `data-recording-state` mirrors the WS store so e2e asserts on STATE, not on
 *    screen markup that prompt 09 will replace wholesale.
 *  - the start button is a placeholder for S-04's Start pill and is removed the
 *    moment S-04 lands.
 */
declare global {
  interface Window {
    __renderCount?: number;
  }
}

function ScaffoldShell() {
  const client = useClient();
  const state = useRecordingState(); // atomic selector — see store/selectors.ts

  // Gate 1e counts commits of this component to prove telemetry never renders.
  // Removed with the button when S-04 lands.
  if (typeof window !== 'undefined') {
    window.__renderCount = (window.__renderCount ?? 0) + 1;
  }

  return (
    <div data-recording-state={state}>
      <button
        type="button"
        data-testid="e2e-start-recording"
        onClick={() => {
          void client.startRecording().catch(() => {
            /* refusals surface in S-04; the scaffold only needs the command sent */
          });
        }}
      >
        Start recording
      </button>
    </div>
  );
}
```

- [ ] **Step 5: Run the spec to verify it passes**

Run: `pnpm --filter @eduscope/panel exec playwright install --with-deps chromium`
Expected: `Chromium … downloaded`.

Run: `pnpm --filter @eduscope/panel e2e`
Expected: PASS — `3 passed`, with the preview server started and stopped by Playwright.

- [ ] **Step 6: Commit**

```bash
git add apps/panel/playwright.config.ts apps/panel/e2e apps/panel/src/App.tsx
git commit -m "test(panel): Playwright smoke covering boot, happy path and scenario switch"
```

---

## Task 20: CI

**Files:**
- Create: `.github/workflows/ci.yml`
- Test: the workflow itself, verified locally by the same commands

**Interfaces:**
- Consumes: root scripts from Task 1.
- Produces: a four-job pipeline — `typecheck`, `lint`, `test`, `e2e` — on push and pull request.

- [ ] **Step 1: Verify the five commands pass locally first**

Run each and record the result; CI must not be the first place these run:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm e2e
```

Expected: all five exit 0.

- [ ] **Step 2: Write the workflow**

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

env:
  NODE_VERSION: '22.11.0'

jobs:
  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck

  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm test

  # Playwright's webServer already builds both apps, but a failure there surfaces
  # as an opaque webServer timeout. Tailwind v4 + workspace transpilePackages is
  # exactly the combination that typechecks and then fails to build, so it gets
  # its own job and its own error message.
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm build

  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @eduscope/panel exec playwright install --with-deps chromium
      - run: pnpm e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: apps/panel/playwright-report/
          retention-days: 7
```

- [ ] **Step 3: Push and confirm the run is green**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: typecheck, lint, unit tests and Playwright smoke"
git push -u origin HEAD
```

Run: `gh run watch`
Expected: all four jobs report `✓`. If `e2e` fails on a missing browser, the `playwright install` step ran against the wrong workspace filter — fix the filter, not the test.

---

# Scaffold gate

The four tasks below are the exit condition for Wave 0 (screen-inventory §11: *"A screen can be built without touching `fetch`"*). Each is written as executable verification, not as a claim. **Do not report the scaffold complete until all four are green.**

## Task 21: Gate 1 — both apps boot on the mock and the overlay switches scripts live

**Files:**
- Create: `apps/panel/e2e/gate-boot.spec.ts`, `apps/quiz/e2e/gate-boot.spec.ts`, `apps/quiz/playwright.config.ts`
- Modify: root `package.json` — add `"gate": "pnpm -r --sequential gate"`; add `"gate": "playwright test e2e/gate-boot.spec.ts"` to both apps

- [ ] **Step 1: Write the panel gate spec**

`apps/panel/e2e/gate-boot.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test('GATE 1a — panel boots on the mock with a live WS snapshot', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto('/');
  await expect(page.getByTestId('us-panel')).toBeVisible();

  // The on-subscribe snapshot must have populated the store without any fetch.
  await expect(page.locator('[data-recording-state]')).toHaveAttribute(
    'data-recording-state',
    /idle|recording|paused/,
  );
  expect(errors, `console errors on boot: ${errors.join(' | ')}`).toEqual([]);
});

test('GATE 1b — the overlay switches every catalog script live', async ({ page }) => {
  await page.goto('/');
  const hotspot = page.getByTestId('scenario-hotspot');
  const box = await hotspot.boundingBox();
  if (!box) throw new Error('no scenario hotspot — the mock client is not active');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(2_200);
  await page.mouse.up();

  const dialog = page.getByRole('dialog', { name: /scenario/i });
  await expect(dialog).toBeVisible();

  for (const name of [
    'happy', 'start-fails', 'pipeline-crash-midway', 'llm-timeout',
    'disk-full', 'ws-flap', 'quiz-network-loss',
  ]) {
    await dialog.getByRole('radio', { name: new RegExp(name) }).check();
    await expect(page.getByTestId('active-scenario')).toHaveText(name);
  }
});

test('GATE 1e — 10 s of happy does not turn telemetry into renders', async ({ page }) => {
  await page.goto('/');

  // The shell increments window.__renderCount on every commit of the scaffold
  // probe (added in step 4 below). audio.levels flows at 10 Hz throughout.
  const before = await page.evaluate(() => window.__renderCount ?? 0);
  await page.waitForTimeout(10_000);
  const after = await page.evaluate(() => window.__renderCount ?? 0);

  // ~100 audio.levels events land in this window. A handful of renders from
  // real state changes is expected; anything near 100 means telemetry has
  // leaked back into React state (Task 15) and every screen will pay for it.
  expect(after - before, `renders during 10 s of idle happy: ${after - before}`)
    .toBeLessThan(20);
});
```

> **Why this assertion and not a generic frame-budget gate.** Every other claim in this plan is verified executably, and frontend cost is the one thing the RK3588 genuinely constrains — so it deserves a gate. But a Profiler-commit or long-task budget measured against three placeholder components measures nothing and would be rewritten the moment real screens land. *"Telemetry causes no renders"* is precise, non-flaky, meaningful today, and is exactly the invariant that would silently regress during prompt 09 when 42 screens subscribe to the store. It is the same claim as `selectors.test.tsx`, asserted end-to-end through a real browser and a real 10 Hz event stream.

- [ ] **Step 2: Write the quiz gate spec**

`apps/quiz/e2e/gate-boot.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test('GATE 1c — quiz boots on the mock, mobile-first', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/j/ABC123');
  await expect(page.getByTestId('screen')).toHaveAttribute('data-screen', 'S-37');

  // screen-inventory §6: nothing below 16px, or iOS zooms on focus.
  const rootPx = await page.evaluate(() =>
    Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
  );
  expect(rootPx).toBeGreaterThanOrEqual(16);

  // Portrait, one-handed: the page must not scroll sideways at 360px.
  await page.setViewportSize({ width: 360, height: 780 });
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflows, 'the quiz app must never scroll horizontally').toBe(false);

  expect(errors).toEqual([]);
});

test('GATE 1d — every quiz route skeleton renders', async ({ page }) => {
  for (const [path, screenId] of [
    ['/j/ABC123', 'S-37'],
    ['/j/ABC123/register', 'S-38'],
    ['/s/01JBQ8ZK3T7WBM5N2Q4XPRVC9D', 'S-39'],
  ] as const) {
    await page.goto(path);
    await expect(page.getByTestId('screen')).toHaveAttribute('data-screen', screenId);
  }
});
```

`apps/quiz/playwright.config.ts` mirrors the panel's, with `viewport: { width: 390, height: 844 }`, `baseURL: 'http://127.0.0.1:3000'`, and `webServer.command: 'pnpm build && pnpm start'`.

- [ ] **Step 3: Run the gate**

Run: `pnpm gate`
Expected: PASS — `5 passed` across the two apps. Both web servers start, both apps render on the mock, all seven scripts switch live, and 10 s of 10 Hz telemetry produces fewer than 20 renders.

- [ ] **Step 4: Commit**

```bash
git add apps/panel/e2e/gate-boot.spec.ts apps/quiz/e2e apps/quiz/playwright.config.ts package.json apps/panel/package.json apps/quiz/package.json
git commit -m "test: gate 1 — both apps boot on the mock, overlay switches live"
```

---

## Task 22: Gate 2 — the client covers 100 % of contract operations and events

**Files:**
- Create: `packages/api-client/test/gate-contract-coverage.test.ts`

This is a *stricter* gate than Task 5's coverage test: that one checked the interface, this one checks the **mock implementation** answers every operation with a schema-valid body and emits every catalogued event.

- [ ] **Step 1: Write the gate test**

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PANEL_EVENT_NAMES, PANEL_OPERATION_IDS, SERVER_SIDE_ONLY_OPERATION_IDS,
} from '@eduscope/shared';
import { createVirtualClock } from '../src/mock/clock.js';
import { createMockClient } from '../src/mock/create-mock-client.js';
import { listScenarios } from '../src/mock/scenario/registry.js';

const spec = readFileSync(resolve(__dirname, '../../../contracts/openapi.yaml'), 'utf8');
const catalog = readFileSync(resolve(__dirname, '../../../contracts/events.md'), 'utf8');

const specOperationIds = () =>
  [...spec.matchAll(/^\s+operationId:\s*(\w+)\s*$/gm)].map((m) => m[1]!);
const specEventNames = () =>
  [...catalog.matchAll(/^### 2\.\d+ `([a-z.]+)`/gm)].map((m) => m[1]!);

describe('GATE 2 — contract coverage', () => {
  it('2a: the mock implements every panel-facing operation in the spec', () => {
    const all = specOperationIds();
    const excluded = new Set<string>(SERVER_SIDE_ONLY_OPERATION_IDS);
    const expected = all.filter((id) => !excluded.has(id));
    const client = createMockClient('happy') as unknown as Record<string, unknown>;

    expect(expected.length).toBe(77);
    const missing = expected.filter((id) => typeof client[id] !== 'function');
    expect(missing, `mock does not implement: ${missing.join(', ')}`).toEqual([]);
  });

  it('2b: the exclusion list is exactly the quiz-sync tag, nothing more', () => {
    const all = new Set(specOperationIds());
    for (const id of SERVER_SIDE_ONLY_OPERATION_IDS) {
      expect(all.has(id), `${id} is not in the spec at all`).toBe(true);
      expect(id.startsWith('quizSync'), `${id} is not a quiz-sync operation`).toBe(true);
    }
    expect(PANEL_OPERATION_IDS.length + SERVER_SIDE_ONLY_OPERATION_IDS.length).toBe(all.size);
  });

  it('2c: every catalogued event name is declared', () => {
    const missing = specEventNames().filter(
      (n) => !(PANEL_EVENT_NAMES as readonly string[]).includes(n),
    );
    expect(missing, `undeclared events: ${missing.join(', ')}`).toEqual([]);
  });

  it('2d: every operation returns without throwing an unexpected error', async () => {
    const client = createMockClient('happy', {
      clock: createVirtualClock('2026-07-30T09:00:00.000+00:00'),
    }) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;

    const unexpected: string[] = [];
    for (const id of PANEL_OPERATION_IDS) {
      try {
        await client[id]!('01JBQ8ZK3T7WBM5N2Q4XPRVC9D', {});
      } catch (e) {
        // ProblemError is a legitimate contract answer (403/404/409). Anything
        // else — a TypeError, an unhandled undefined — is a hole in the mock.
        if ((e as Error).name !== 'ProblemError') {
          unexpected.push(`${id}: ${(e as Error).name}: ${(e as Error).message}`);
        }
      }
    }
    expect(unexpected, `operations threw non-contract errors:\n${unexpected.join('\n')}`)
      .toEqual([]);
  });

  it('2e: every scenario keeps the mock contract-honest', async () => {
    for (const script of listScenarios()) {
      const client = createMockClient(script.name, {
        clock: createVirtualClock('2026-07-30T09:00:00.000+00:00'),
      });
      // The snapshot is emitted through zEventEnvelope.parse, so a schema
      // violation under any script throws here rather than in a screen.
      expect(() => client.events$.subscribe(() => {}), script.name).not.toThrow();
      await expect(client.getRecordingState(), script.name).resolves.toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: Run the gate**

Run: `pnpm --filter @eduscope/api-client test gate-contract-coverage`
Expected: PASS — `Tests 5 passed`. Assertion 2a prints the exact operationIds still missing, so this gate is also the to-do list while Task 10 is in progress.

- [ ] **Step 3: Commit**

```bash
git add packages/api-client/test/gate-contract-coverage.test.ts
git commit -m "test: gate 2 — 100% contract operation and event coverage"
```

---

## Task 23: Gate 3 — the boundary rule fails the build on a direct fetch

**Files:**
- Create: `tools/eslint-rules/gate-boundary.test.ts`

Task 17 proved the rule reports an error. This gate proves the stronger claim: **`pnpm lint` exits non-zero** when a real file in a real app calls `fetch` — i.e. the rule fails the *build*, not just a lint report.

- [ ] **Step 1: Write the gate test**

```ts
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const VIOLATION = resolve(root, 'apps/panel/src/__gate__/direct-fetch.ts');
const CONTROL = resolve(root, 'packages/api-client/src/__gate__/direct-fetch.ts');

const CODE = `export async function load(): Promise<unknown> {
  const response = await fetch('/api/v1/recording/state');
  return response.json();
}
`;

function write(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, CODE, 'utf8');
}

function lintExitCode(): number {
  try {
    execFileSync('pnpm', ['lint'], { cwd: root, stdio: 'pipe', shell: true });
    return 0;
  } catch (e) {
    return (e as { status?: number }).status ?? 1;
  }
}

afterEach(() => {
  for (const p of [VIOLATION, CONTROL]) {
    if (existsSync(p)) rmSync(dirname(p), { recursive: true, force: true });
  }
});

describe('GATE 3 — the boundary rule fails the build', () => {
  it('3a: pnpm lint is green with no violation present', () => {
    expect(lintExitCode(), 'the repo must lint clean before the gate means anything')
      .toBe(0);
  });

  it('3b: a direct fetch in apps/panel makes pnpm lint exit non-zero', () => {
    write(VIOLATION);
    expect(
      lintExitCode(),
      'a component calling fetch() must FAIL the build (frontend-conventions §1)',
    ).not.toBe(0);
  });

  it('3c: the same file inside packages/api-client keeps lint green', () => {
    write(CONTROL);
    expect(
      lintExitCode(),
      'packages/api-client IS the network boundary and must stay unrestricted',
    ).toBe(0);
  });
});
```

- [ ] **Step 2: Run the gate**

Run: `pnpm test tools/eslint-rules/gate-boundary.test.ts`
Expected: PASS — `Tests 3 passed`.

Sanity-check by hand once, so the gate's claim is seen rather than trusted:

```bash
mkdir -p apps/panel/src/__gate__ && printf "export const go = () => fetch('/x');\n" > apps/panel/src/__gate__/direct-fetch.ts && pnpm lint; echo "exit=$?"; rm -rf apps/panel/src/__gate__
```

Expected: an error naming `no-restricted-globals` and the message *"Use the EduscopeClient from packages/api-client…"*, then `exit=1`.

- [ ] **Step 3: Commit**

```bash
git add tools/eslint-rules/gate-boundary.test.ts
git commit -m "test: gate 3 — a direct fetch fails the build, proved end to end"
```

---

## Task 24: Gate 4 — CI green, and the scaffold is declared complete

**Files:**
- Modify: `.github/workflows/ci.yml` — add the `gate` job
- Create: `docs/plans/frontend-scaffold-gate.md` (the signed-off record)

- [ ] **Step 1: Add the gate job to CI**

Append to `.github/workflows/ci.yml`:

```yaml
  gate:
    runs-on: ubuntu-latest
    needs: [typecheck, lint, test]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @eduscope/panel exec playwright install --with-deps chromium
      - name: Scaffold gate
        run: pnpm gate
```

- [ ] **Step 2: Run the whole gate locally**

Run each in order and record the actual output:

```bash
pnpm typecheck
```
Expected: exit 0, no `error TS`.

```bash
pnpm lint
```
Expected: exit 0, no output.

```bash
pnpm test
```
Expected: exit 0. Every suite green across all four projects (`packages`, `panel`, `quiz`, `tools`), including `gate-contract-coverage.test.ts` and `gate-boundary.test.ts`.

```bash
pnpm build
```
Expected: exit 0. `vite build` for the panel and `next build` for the quiz app both succeed.

```bash
pnpm gate
```
Expected: exit 0, `5 passed` across the two apps.

```bash
pnpm e2e
```
Expected: exit 0, `3 passed`.

- [ ] **Step 3: Record the gate**

Create `docs/plans/frontend-scaffold-gate.md` and fill in each row with the **actual** observed result — not the expected one. A row that did not pass stays failed and blocks prompt 09.

```markdown
# Wave 0 scaffold gate — record

Exit condition (screen-inventory §11 Wave 0): *"A screen can be built without
touching `fetch`."*

| # | Gate | Command | Result | Evidence |
|---|---|---|---|---|
| 1 | Both apps boot on the mock; the overlay switches scripts live; telemetry causes no renders | `pnpm gate` | | `5 passed` / panel + quiz |
| 2 | Client covers 100 % of contract operations and events | `pnpm --filter @eduscope/api-client test gate-contract-coverage` | | 77 / 77 operations, 22 / 22 events |
| 3 | The boundary rule fails the build on a direct fetch | `pnpm test tools/eslint-rules/gate-boundary.test.ts` | | `exit=1` with `no-restricted-globals` |
| 4 | CI green | `gh run watch` | | run URL (5 jobs) |

## Deliberate exclusions

- **`quiz-sync` operations (4).** `quizSyncCreateSession`, `quizSyncCloseSession`,
  `quizSyncPublish`, `quizSyncClosePublication` are hosted by the quiz service
  with core-api as the client (openapi.yaml, tag `quiz-sync`). No browser calls
  them. Gate 2b asserts the exclusion list is exactly these four.
- **CG-1.** The student-facing REST surface has no contract. `QuizAppClient`'s
  REST half is provisional and labelled as such in the source; its event half is
  contract-validated. `apps/quiz` screens are buildable on the mock;
  **integration is blocked until `contracts/quiz-app.yaml` lands.**
- **CG-2, CG-3, CG-7.** Not scaffold blockers; they block Waves 5/6 and 8.
- **`--danger` / `--info` tokens.** Defined in `tokens.css`, used by nothing —
  screen-inventory §8.2 requires wireframe approval before use.

## What this scaffold does NOT contain

No screen implementation. Route files render placeholders. S-01…S-42 are prompt 09.
```

- [ ] **Step 4: Push and confirm**

```bash
git add .github/workflows/ci.yml docs/plans/frontend-scaffold-gate.md
git commit -m "test: gate 4 — CI runs the scaffold gate; record the results"
git push
```

Run: `gh run watch`
Expected: all six jobs `✓` (`typecheck`, `lint`, `test`, `build`, `e2e`, `gate`). Fill the gate record's Result column from this run, then the scaffold is complete.

---

## Self-Review

Checked against the source documents with fresh eyes.

**Spec coverage.**

| Requirement | Task |
|---|---|
| `packages/shared` re-exports the contract zod schemas/types | 2, 3, 4 |
| `EduscopeClient`: one method per OpenAPI operation, typed | 5 (interface), 22 (gate) |
| `events$` mirroring contracts/events.md | 3 (schemas), 5 (surface), 11 (emission) |
| `createRealClient` STUB throwing `NotImplementedError('Phase 4')` | 5 |
| `createMockClient(scenario)` driven by the state machines | 6, 7, 10, 12 |
| Realistic command delays | 7 (`fire` effects), 10 (`COMMAND_PLANS`) |
| Throttled `audio.levels` | 11 (exact 10 Hz assertion) |
| Fake preview frames as generated JPEG data-URIs | 11 |
| Scenario engine + how scripts force transitions | 8 (design section + engine) |
| How screens register new forced transitions | 8 (`extendScenario`, §"How the engine works" ¶4) |
| The seven named scripts | 9 |
| Contract tests: every mock response validates | 10 (`validated`), 22 (gate 2e) |
| `apps/panel` 1280×800 fixed viewport | 13 |
| Route skeleton from the nav map | 14 |
| Auth context with role gating | 14 |
| WS-state store wired to `client.events$` | 15 |
| Design tokens ported from `/prototype` | 13 |
| Scenario dev overlay behind a long-press | 16 |
| ESLint boundary rule | 17, 23 |
| `apps/quiz` Next.js, mobile-first, three routes | 18 |
| Basic-login skeleton with an SSO seam | 18 |
| Same client-boundary rule in the quiz app | 17 (test case), 18 |
| CI: typecheck, lint, unit, Playwright smoke | 19, 20 |
| Gate: both apps boot, overlay switches live | 21 |
| Gate: 100 % operation + event coverage | 22 |
| Gate: boundary rule fails the build, proved | 23 |
| Gate: CI green | 24 |
| Scope rule — no screens beyond skeletons | Stated in Global Constraints; enforced by Tasks 14 and 18 rendering placeholders only |

**Review round 2 — what was added, and what was deliberately not.**

Added, because each one is infrastructure that 42 screens would otherwise duplicate or work around:

| Change | Task | Why it could not wait |
|---|---|---|
| `vitest.workspace.ts` delegating to per-package configs | 1 | A root `vitest run` with no workspace file runs `.test.tsx` under Node with no JSX transform. CI's `test` job and Gate 4 were asserting nothing. |
| Base `eslint.config.js` moved to Task 1 | 1, 17 | `pnpm lint` is a root script from Task 1; a script that fails for sixteen tasks trains everyone to ignore it. |
| `react-hooks/exhaustive-deps` + `jsx-a11y` | 1 | Re-render discipline is this scaffold's central risk, and conventions §3 mandates `aria-label` on every icon-only control of a keyboard-less kiosk. Both are one config block, and screens are then born compliant. |
| Layout route + `PanelShell` | 14 | S-03 is specified `(panel, all routes)` and *"must be built first"*. Under a flat sibling array it can only live outside `RouterProvider`, where it cannot read the location. |
| `errorElement` + catch-all route | 14 | A kiosk has no address bar, no keyboard and nobody to press reload; an unhandled render error must not be a white screen in a lecture hall. |
| `OverlayHost` (mount point + stack) | 14 | Ten overlays, two binding placement rules (absolute inside `.us-panel`; portal out of the dark scope so dialogs render light), and S-15 opens on top of S-14. The alternative is ten hand-rolled scrims. |
| Typed store slices | 15 | Tasks 2–4 exist to produce those payload types; `Record<string, unknown>` pushes a cast into every screen. |
| `selectors.ts` + the conventions rule | 15 | zustand v5 removed the hook's equality argument. Written against the old sketch, 42 screens re-render on every notification, and it is not fixable afterwards. |
| Transient telemetry store | 15 | `audio.levels` at 10 Hz in the shared store re-runs every registered selector ten times a second on the board running the capture pipelines. |
| One `set()` per envelope; bounded `alerts`/`publications`; client built in the effect | 15 | Three concrete defects: triple notification per event; unbounded growth over a weeks-long uptime with `T-ALERT-REEVALUATE` re-raising every 30 s; and a StrictMode-discarded client whose 10 Hz timers are never disposed. |
| `useTicker` | 15 | INV-G-7 has the panel deriving time locally. In the store, that is a second 1 Hz storm. |
| `vite-env.d.ts`, `tsc --noEmit` (not `tsc -b`), no `prettier` | 2, 13 | Three configuration errors that fail on first run: untyped `import.meta.env` under `exactOptionalPropertyTypes`, build mode on non-composite projects, and a formatter that is in no `package.json`. |
| CI `build` job | 20 | Playwright's `webServer` does already build both apps — so the build is not *unexercised* — but a failure surfaces as an opaque webServer timeout. Tailwind v4 + `transpilePackages` is exactly the pairing that typechecks and then fails to build. |
| Gate 1e: telemetry causes no renders | 21 | Frontend cost is the one thing the RK3588 genuinely constrains, and it was the only claim in the plan with no executable assertion. |

**Not** added, with the reasoning:

- **Rebuilding `PreviewChannel` around `ImageBitmap`/`OffscreenCanvas.convertToBlob()`.** `convertToBlob` is async and yields a `Blob` + object URL, not the JPEG data-URI this scaffold is specified to produce, and Wave 8 replaces the entire preview path with a WebRTC `MediaStream`. The real waste was allocating a 640×360 canvas eight-to-twelve times a second; that is fixed in Task 11 (one reused canvas, 480×270 at q0.5, 8 fps) at a fraction of the cost of redesigning a transport with a known expiry date.
- **A generic Profiler-commit or long-task budget in Gate 1.** Measured against three placeholder components it asserts nothing, and it would be rewritten the moment real screens land. Gate 1e asserts the specific invariant that is meaningful today *and* is the one that would silently regress in prompt 09.
- **`Modal`, `Drawer`, `Toggle`, `Stepper` primitives.** screen-inventory §11 lists them under Wave 0, but they are component design, not infrastructure, and the scope rule for this plan is explicit that screens are prompt 09. Task 14 ships the overlay *host* — the mount point, ordering and dismissal — because that is the part whose absence forces duplication. What the layers look like is a screen decision.
- **The on-screen keyboard host.** Also a Wave 0 item in screen-inventory §11, but its one hard requirement — *"must not cover the submit button at 1280×800; reserve the lower 380 px"* — is an S-01 layout decision, and this scaffold has no text input to host it for. Task 13 records that it lands with S-01 in Wave 1 so the dependency is not orphaned.
- **Code splitting.** Correctly absent: the panel is served from the device, so transfer is free and only parse cost matters.

**Type consistency.** `EventStream`/`Unsubscribe` (Task 5) are used unchanged in Tasks 6, 11, 12, 15, 18. `TransitionId` and `MachineId` (Task 6) are used unchanged in Tasks 7, 8, 10. `ScenarioName` (Task 8) is used in Tasks 9, 12, 15, 16. `validated()` (Task 10) is the single choke point Task 22 relies on. `MockClient` (Task 12) is the type `useMockClient()` (Task 15) narrows to and the overlay (Task 16) consumes. `QuizIdentity` (Task 18, `packages/api-client`) is the return type of `QuizIdentityProvider` (Task 18, `apps/quiz`).

**Two seams called out honestly rather than hidden.**

1. **Task 2's generator naming.** `@hey-api/openapi-ts`'s zod output identifiers are the one thing this plan could not verify in advance. Step 1's coverage test pins them down at the very first task, and the fix location is a single name-adapter block. Nothing downstream depends on the generator's internals.
2. **Task 18's CG-1.** The student REST surface genuinely does not exist. `QuizAppClient`'s REST half is provisional and labelled; its event half is contract-validated. This is recorded in the gate document as a deliberate exclusion, not silently absorbed.

**One deviation from the writing-plans default, taken deliberately.** The plan is saved to `docs/plans/frontend-scaffold.md` rather than `docs/superpowers/plans/YYYY-MM-DD-*.md`, because the request named that path and the skill defers to user preferences on plan location.
