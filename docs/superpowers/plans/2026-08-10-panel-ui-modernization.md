# Eduscope Panel UI Modernization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modernize the requested lecturer and administrator UI surfaces, correct keyboard/switch/layout defects, replace blocking banners with persistent notifications, and confirm user-initiated recording stops without changing other behavior.

**Architecture:** Extend the existing token-driven `us-*` CSS system and reuse the current keyboard, overlay, danger-confirmation, query, and live-state layers. Cross-cutting controls are fixed once, screen components retain their existing hooks/data contracts, and each visual area receives focused component tests before browser QA at the 1280×800 kiosk viewport.

**Tech Stack:** React 18, TypeScript 5.6, Vite 7, Vitest, Testing Library, Playwright, Zustand, TanStack Query, `react-simple-keyboard`, plain CSS custom properties.

## Global Constraints

- Continue using the existing React/Vite application, CSS design tokens, `us-*` class naming, overlay host, and fixed 1280×800 kiosk model.
- Keep the current Eduscope light palette, dark header, brand red, and semantic success/warning/danger colors.
- Do not add a new component framework, icon package, backend endpoint, persistence mechanism, route, or business rule.
- Maintain a minimum 44×44px interactive target and visible keyboard focus.
- Internal regions may scroll; the kiosk page itself must remain non-scrolling.
- Preserve all existing routes, hooks, commands, authorization rules, data contracts, and websocket behavior.
- The only new workflow step is confirmation before the existing user-initiated Stop Recording command.
- Leave `feedback.json`, `heatmap.json`, and `projects/` untouched.

---

## File Structure and Responsibility Map

- `apps/panel/src/keyboard/*`: OSK layouts, height publication, touch geometry, and field bindings.
- `apps/panel/src/controls/toggle-switch.tsx` and `toggle-switch.css`: one accessible visual switch used by meeting, streaming, and microphone controls.
- `apps/panel/src/screens/ai/*` and `apps/panel/src/ai/ai.css`: questions, previous-question history, and leaderboard presentation.
- `apps/panel/src/screens/session/*`: sidebar sizing and Live Meeting/Insights accordion containment.
- `apps/panel/src/screens/advanced/advanced.css`: shared administrator headers, cards, inputs, actions, and empty-state vocabulary.
- Feature-local administrator CSS/component directories: content-specific layouts only.
- `apps/panel/src/shell/notification-center.tsx`: existing active-alert aggregation presented as a header notification panel.
- `apps/panel/src/shell/*`: notification placement and recording-notch-aware clock spacing.
- `apps/panel/src/screens/transport/*`: Stop Recording confirmation between the button and existing transport command.

---

### Task 1: Compact Alphanumeric and IP-Capable On-Screen Keyboard

**Files:**
- Modify: `apps/panel/src/keyboard/use-keyboard.ts`
- Modify: `apps/panel/src/keyboard/keyboard-host.tsx`
- Modify: `apps/panel/src/keyboard/keyboard.css`
- Modify: `apps/panel/src/keyboard/keyboard-host.test.tsx`

**Interfaces:**
- Produces: `OskLayout = 'default' | 'numeric' | 'ip'`.
- Produces: `OSK_OPEN_PX` matching the compact rendered dock height.
- Preserves: `useOskField({ value, onChange, layout }): OskFieldBinding` and `--osk-h` publication on `.us-panel`.

- [ ] **Step 1: Add failing layout and height tests**

```tsx
it('the default keyboard includes digits and letters', () => {
  render(<Panel><TextField /></Panel>);
  fireEvent.focus(screen.getByLabelText('field'));
  expect(document.querySelector('[data-skbtn="7"]')).not.toBeNull();
  expect(document.querySelector('[data-skbtn="q"]')).not.toBeNull();
});

it('an IP field includes digits and dot but not letters', async () => {
  render(<Panel><TextField layout="ip" /></Panel>);
  fireEvent.focus(screen.getByLabelText('field'));
  await pressKey('1');
  await pressKey('.');
  expect((screen.getByLabelText('field') as HTMLInputElement).value).toBe('1.');
  expect(document.querySelector('[data-skbtn="q"]')).toBeNull();
});

it('publishes the compact keyboard reserve', () => {
  render(<Panel><TextField /></Panel>);
  fireEvent.focus(screen.getByLabelText('field'));
  expect(OSK_OPEN_PX).toBeLessThan(380);
  expect(oskHeight()).toBe(`${OSK_OPEN_PX}px`);
});
```

- [ ] **Step 2: Run the keyboard tests and verify they fail**

Run: `pnpm --filter @eduscope/panel test -- src/keyboard/keyboard-host.test.tsx`

Expected: FAIL because `ip` is not an `OskLayout`, default has no digit row, and the reserve is still 380px.

- [ ] **Step 3: Implement layouts and compact geometry**

```ts
export type OskLayout = 'default' | 'numeric' | 'ip';
```

```tsx
export const OSK_OPEN_PX = 320;

const DEFAULT_LAYOUT = {
  default: [
    '1 2 3 4 5 6 7 8 9 0',
    'q w e r t y u i o p',
    'a s d f g h j k l',
    '{shift} z x c v b n m {bksp}',
    '{space}',
  ],
  shift: [
    '1 2 3 4 5 6 7 8 9 0',
    'Q W E R T Y U I O P',
    'A S D F G H J K L',
    '{shift} Z X C V B N M {bksp}',
    '{space}',
  ],
};

const IP_LAYOUT = {
  default: ['1 2 3', '4 5 6', '7 8 9', '. 0 {bksp}'],
};
```

Select `IP_LAYOUT` when `layout === 'ip'`. Update `.us-osk` to `height: var(--osk-h)`, reduce outer padding to the 4–10px token range, place the close action in the keyboard’s top-right without a full empty row, and style `.hg-button` with readable labels and at least 44px height.

- [ ] **Step 4: Run keyboard tests**

Run: `pnpm --filter @eduscope/panel test -- src/keyboard/keyboard-host.test.tsx src/auth/password-field.test.tsx`

Expected: PASS; default accepts a number and password-field behavior remains unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/panel/src/keyboard
git commit -m "fix(panel): improve on-screen keyboard layouts"
```

---

### Task 2: Bind the Keyboard to Missing Administrator Inputs

**Files:**
- Modify: `apps/panel/src/screens/advanced/network/ip-input.tsx`
- Modify: `apps/panel/src/screens/advanced/storage/register-drive-form.tsx`
- Modify: `apps/panel/src/screens/advanced/users/add-user-dialog.tsx`
- Modify: `apps/panel/src/screens/advanced/users/edit-user-dialog.tsx`
- Modify: `apps/panel/src/screens/advanced/users/user-search.tsx`
- Modify: `apps/panel/src/screens/library/library-filters.tsx`
- Modify: `apps/panel/src/screens/advanced/network/network-screen.test.tsx`
- Modify: `apps/panel/src/screens/advanced/storage/storage-screen.test.tsx`
- Modify: `apps/panel/src/screens/advanced/users/user-management-screen.test.tsx`
- Modify: `apps/panel/src/screens/library/library-filters.test.tsx`

**Interfaces:**
- Consumes: `useOskField` and the new `'ip'` layout from Task 1.
- Produces: focusable IP octets, UUID/label, username/display-name/password, user search, recording search, and owner search fields that set the correct `data-osk` and open the shared host.

- [ ] **Step 1: Add failing field-binding assertions**

```tsx
it('binds every IPv4 octet to the IP keyboard', () => {
  render(<IpInput label="Camera address" value="10.0.0.1" onChange={vi.fn()} />);
  for (const input of screen.getAllByRole('textbox')) {
    expect(input).toHaveAttribute('data-osk', 'ip');
  }
});

it('binds owner search to the on-screen keyboard', () => {
  render(<LibraryFilters value={{}} isAdmin onChange={vi.fn()} />);
  expect(screen.getByLabelText('Filter by owner')).toHaveAttribute('data-osk', 'default');
});
```

Add these exact assertions in their owning screen tests: Volume UUID and Volume label use `data-osk="default"`; Add User username/display-name/password use `data-osk="default"`; Edit User display-name/new-password use `data-osk="default"`; and User Search uses `data-osk="default"`.

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `pnpm --filter @eduscope/panel test -- src/screens/advanced/network/network-screen.test.tsx src/screens/advanced/storage/storage-screen.test.tsx src/screens/advanced/users/user-management-screen.test.tsx src/screens/library/library-filters.test.tsx`

Expected: FAIL on missing `data-osk` attributes.

- [ ] **Step 3: Add bindings without changing validation**

```tsx
function IpOctetInput(props: {
  readonly label: string;
  readonly value: string;
  readonly disabled?: boolean;
  readonly onChange: (next: string) => void;
}): JSX.Element {
  const binding = useOskField({ value: props.value, onChange: props.onChange, layout: 'ip' });
  return (
    <input
      type="text"
      inputMode="numeric"
      value={props.value}
      disabled={props.disabled}
      aria-label={props.label}
      onChange={(event) => props.onChange(event.target.value)}
      {...binding}
    />
  );
}
```

Render `IpOctetInput` from the existing four-octet map so hooks are never called inside a loop. For every other controlled field, create a binding beside its state declaration and spread it onto the input; the binding does not replace native `onChange`. Preserve disabled/read-only behavior. Recording search is already bound, so only add the missing owner binding there.

- [ ] **Step 4: Run focused tests**

Run: `pnpm --filter @eduscope/panel test -- src/screens/advanced/network src/screens/advanced/storage src/screens/advanced/users src/screens/library/library-filters.test.tsx`

Expected: PASS with unchanged submit/apply payload assertions.

- [ ] **Step 5: Commit**

```bash
git add apps/panel/src/screens/advanced/network apps/panel/src/screens/advanced/storage/register-drive-form.tsx apps/panel/src/screens/advanced/users apps/panel/src/screens/library/library-filters.tsx apps/panel/src/screens/library/library-filters.test.tsx
git commit -m "fix(panel): open keyboard for admin text fields"
```

---

### Task 3: Standardize the Visual Switch Track

**Files:**
- Create: `apps/panel/src/controls/toggle-switch.tsx`
- Create: `apps/panel/src/controls/toggle-switch.css`
- Create: `apps/panel/src/controls/toggle-switch.test.tsx`
- Modify: `apps/panel/src/screens/session/meeting-channel-card.tsx`
- Modify: `apps/panel/src/screens/advanced/streaming-screen.tsx`
- Modify: `apps/panel/src/screens/room/mic-master-row.tsx`
- Modify: `apps/panel/src/screens/sources/mic-row.tsx`
- Modify: `apps/panel/src/screens/session/session.css`
- Modify: `apps/panel/src/screens/room/room.css`
- Modify: `apps/panel/src/screens/sources/sources.css`

**Interfaces:**
- Produces: `ToggleSwitch({ checked, label, disabled, failed, onChange }): JSX.Element`.
- Preserves: `role="switch"`, `aria-checked`, per-screen disabled conditions, and existing callbacks.

- [ ] **Step 1: Write the failing shared-switch test**

```tsx
it('keeps a 44px target while rendering a slim track', () => {
  render(<ToggleSwitch checked label="Live Meeting" onChange={vi.fn()} />);
  const control = screen.getByRole('switch', { name: 'Live Meeting' });
  expect(control).toHaveAttribute('aria-checked', 'true');
  expect(control.querySelector('.us-switch__track')).not.toBeNull();
  expect(control.querySelector('.us-switch__thumb')).not.toBeNull();
});

it('reports the next checked state once', async () => {
  const onChange = vi.fn();
  render(<ToggleSwitch checked={false} label="Lecturer Mic" onChange={onChange} />);
  await userEvent.click(screen.getByRole('switch'));
  expect(onChange).toHaveBeenCalledWith(true);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm --filter @eduscope/panel test -- src/controls/toggle-switch.test.tsx`

Expected: FAIL because the shared control does not exist.

- [ ] **Step 3: Implement the shared control and CSS**

```tsx
export interface ToggleSwitchProps {
  readonly checked: boolean | undefined;
  readonly label: string;
  readonly disabled?: boolean;
  readonly failed?: boolean;
  readonly describedBy?: string;
  readonly onChange: (checked: boolean) => void;
}

export function ToggleSwitch(props: ToggleSwitchProps): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      aria-describedby={props.describedBy}
      disabled={props.disabled}
      className="us-switch"
      data-failed={props.failed || undefined}
      onClick={() => {
        if (props.checked !== undefined) props.onChange(!props.checked);
      }}
    >
      <span className="us-switch__track" aria-hidden="true">
        <span className="us-switch__thumb" />
      </span>
    </button>
  );
}
```

Use a 54×44px transparent button, a centered 48×26px capsule track, a 20px thumb, and transform-based on/off movement. Retain failure/danger, described-by relationships, undefined/loading state, and disabled treatments. Remove obsolete `.us-toggle`, `.us-micswitch`, and `.us-micmaster__switch` geometry after replacing all four call sites.

- [ ] **Step 4: Run switch and consumer tests**

Run: `pnpm --filter @eduscope/panel test -- src/controls/toggle-switch.test.tsx src/screens/session/meeting-channel-card.test.tsx src/screens/advanced/streaming-screen.test.tsx src/screens/room/mic-master-row.test.tsx src/screens/sources/mic-row.test.tsx`

Expected: PASS with existing switch labels/states and command assertions unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/panel/src/controls apps/panel/src/screens/session apps/panel/src/screens/advanced/streaming-screen.tsx apps/panel/src/screens/room apps/panel/src/screens/sources
git commit -m "refactor(panel): standardize toggle switch geometry"
```

---

### Task 4: Modernize Questions, History, Leaderboard, and Fix Sidebar Overlap

**Files:**
- Modify: `apps/panel/src/screens/ai/questions-modal.tsx`
- Modify: `apps/panel/src/screens/ai/question-card.tsx`
- Modify: `apps/panel/src/screens/ai/previous-questions-tab.tsx`
- Modify: `apps/panel/src/screens/ai/leaderboard-tab.tsx`
- Modify: `apps/panel/src/screens/ai/insights-column.tsx`
- Modify: `apps/panel/src/screens/session/session-layout.tsx`
- Modify: `apps/panel/src/ai/ai.css`
- Modify: `apps/panel/src/screens/session/session.css`
- Modify: `apps/panel/src/screens/ai/questions-modal.test.tsx`
- Modify: `apps/panel/src/screens/ai/question-card.test.tsx`
- Modify: `apps/panel/src/screens/ai/previous-questions-tab.test.tsx`
- Modify: `apps/panel/src/screens/ai/leaderboard-tab.test.tsx`
- Modify: `apps/panel/src/screens/session/session-layout.test.tsx`

**Interfaces:**
- Preserves: all question/leaderboard hooks, overlay behavior, tabs, publication actions, and student drill-down.
- Produces: labelled dialog heading/description, readable option rows, and a sidebar whose collapsed Insights header stays in flow beneath expanded Live Meeting.

- [ ] **Step 1: Add failing semantic/layout tests**

```tsx
it('labels the questions dialog from its visible heading', () => {
  renderQuestionsModal();
  const dialog = screen.getByRole('dialog', { name: 'Questions' });
  expect(dialog).toHaveAttribute('aria-labelledby');
  expect(screen.getByRole('heading', { name: 'Questions' })).toHaveAttribute('id');
});

it('keeps collapsed insights mounted after meeting expansion', async () => {
  renderSession();
  await userEvent.click(screen.getByRole('switch', { name: 'Live Meeting' }));
  const insights = screen.getByTestId('insights-column');
  expect(insights).toBeInTheDocument();
  expect(insights).toHaveClass('us-insightswrap--collapsed');
  expect(screen.getByRole('tab', { name: 'Leaderboard' })).toBeVisible();
});
```

Retain existing content/action tests for QuestionCard, PreviousQuestionsTab, and LeaderboardTab.

- [ ] **Step 2: Run affected tests and verify new assertions fail**

Run: `pnpm --filter @eduscope/panel test -- src/screens/ai src/screens/session/session-layout.test.tsx`

Expected: FAIL on heading relationship and any geometry class assertions added for containment.

- [ ] **Step 3: Update dialog semantics and restrained visual hierarchy**

```tsx
const titleId = useId();
const descriptionId = useId();

<div role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}>
  <header className="us-qmodal__head">
    <div>
      <h2 id={titleId}>Questions</h2>
      <p id={descriptionId}>Review, edit, or send a question to students.</p>
    </div>
    {/* existing Close button */}
  </header>
</div>
```

In `ai.css`, use 21px modal heading, 16–17px prompt/option/name text, ≥1.45 line-height, stronger borders, stable footer, clear correct-answer marker, roomier previous-question cards, and aligned leaderboard columns. Keep the existing dark `.us-assistant` token scope.

- [ ] **Step 4: Fix sidebar sizing in normal flow**

```css
.us-sessionlayout__sidebar {
  overflow: hidden;
}

.us-chcard--open {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

.us-chcard--open .us-mlayout--open {
  max-height: none;
  overflow-y: auto;
}

.us-insightswrap--collapsed {
  flex: 0 0 var(--tap-row);
  min-height: var(--tap-row);
  overflow: hidden;
}
```

The tabs remain rendered while only `.us-insightswrap__body` is omitted. Do not use absolute positioning or negative margins.

- [ ] **Step 5: Run AI/session tests**

Run: `pnpm --filter @eduscope/panel test -- src/screens/ai src/screens/session`

Expected: PASS for modal focus, question actions, live leaderboard data, and meeting/insights states.

- [ ] **Step 6: Commit**

```bash
git add apps/panel/src/ai/ai.css apps/panel/src/screens/ai apps/panel/src/screens/session
git commit -m "style(panel): improve questions and session insights"
```

---

### Task 5: Establish the Shared Modern Administrator Surface

**Files:**
- Modify: `apps/panel/src/screens/advanced/advanced.css`
- Modify: `apps/panel/src/screens/advanced/storage/storage-screen.tsx`
- Modify: `apps/panel/src/screens/advanced/storage/storage.css`
- Modify: `apps/panel/src/screens/advanced/storage/format-danger-zone.tsx`
- Modify: `apps/panel/src/screens/advanced/firmware/firmware-screen.tsx`
- Modify: `apps/panel/src/screens/advanced/firmware/firmware.css`
- Modify: `apps/panel/src/screens/advanced/users/user-management-screen.tsx`
- Modify: `apps/panel/src/screens/advanced/users/users.css`
- Modify: `apps/panel/src/screens/advanced/storage/storage-screen.test.tsx`
- Modify: `apps/panel/src/screens/advanced/firmware/firmware-screen.test.tsx`
- Modify: `apps/panel/src/screens/advanced/users/user-management-screen.test.tsx`

**Interfaces:**
- Produces reusable classes: `.us-adm__pagehead`, `.us-adm__pagecopy`, `.us-adm__section`, `.us-adm__empty`, `.us-adm__dangerzone`, and `.us-adm__danger`.
- Preserves storage, firmware, and user-management hooks/actions.

- [ ] **Step 1: Add failing structure and destructive-action tests**

```tsx
expect(screen.getByRole('heading', { name: 'Local Storage' }).closest('.us-adm__pagehead')).not.toBeNull();
expect(screen.getByRole('button', { name: /Format/ })).toHaveClass('us-adm__danger');
expect(screen.getByRole('heading', { name: 'Firmware Update' }).closest('.us-adm__pagehead')).not.toBeNull();
expect(screen.getByRole('heading', { name: 'User Management' }).closest('.us-adm__pagehead')).not.toBeNull();
```

- [ ] **Step 2: Run the three screen tests and verify failure**

Run: `pnpm --filter @eduscope/panel test -- src/screens/advanced/storage/storage-screen.test.tsx src/screens/advanced/firmware/firmware-screen.test.tsx src/screens/advanced/users/user-management-screen.test.tsx`

Expected: FAIL because shared page-header/danger classes are absent.

- [ ] **Step 3: Add shared administrator patterns**

```css
.us-adm__pagehead {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--sp-8);
}
.us-adm__pagehead h1 { margin: 0; font-size: var(--fs-3xl); line-height: 1.2; }
.us-adm__pagecopy { margin: var(--sp-2) 0 0; color: var(--text-muted); font-size: var(--fs-base); }
.us-adm__section { border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); box-shadow: var(--shadow-sm); }
.us-adm__dangerzone { border-color: color-mix(in srgb, var(--danger) 35%, var(--border)); background: var(--danger-soft); }
.us-adm__danger { min-height: var(--tap-min); border: 0; border-radius: var(--radius-md); background: var(--danger); color: #fff; font-weight: 700; }
```

Add visible `:hover` and `:focus-visible` counterparts, consistent input/select sizing, section headings, and status/empty treatment. Keep 20px content padding and existing sidebar dimensions.

- [ ] **Step 4: Apply the pattern to Storage, Firmware, and Users**

Add concise existing-scope descriptions below headings; group capacity/retention/volumes/registration, firmware status/actions, and user filters/table. Move only markup wrappers and class names. Keep every callback and conditional unchanged. Style Format through `us-adm__danger` inside the existing guarded `FormatDangerZone` confirmation.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @eduscope/panel test -- src/screens/advanced/storage src/screens/advanced/firmware src/screens/advanced/users`

Expected: PASS, including storage confirmation phrase, firmware refusal, and last-admin/self-delete protections.

- [ ] **Step 6: Commit**

```bash
git add apps/panel/src/screens/advanced/advanced.css apps/panel/src/screens/advanced/storage apps/panel/src/screens/advanced/firmware apps/panel/src/screens/advanced/users
git commit -m "style(panel): modernize core admin settings"
```

---

### Task 6: Modernize Logs, Recording Library, Upload Queue, and Device Identity

**Files:**
- Modify: `apps/panel/src/screens/advanced/logs/logs-screen.tsx`
- Modify: `apps/panel/src/screens/advanced/logs/logs.css`
- Modify: `apps/panel/src/screens/advanced/uploads/upload-queue-screen.tsx`
- Modify: `apps/panel/src/screens/advanced/uploads/uploads.css`
- Modify: `apps/panel/src/screens/advanced/device/device-identity-screen.tsx`
- Modify: `apps/panel/src/screens/advanced/device/device.css`
- Modify: `apps/panel/src/screens/library/library-screen.tsx`
- Modify: `apps/panel/src/screens/library/library.css`
- Modify: `apps/panel/src/screens/library/library-screen.test.tsx`
- Modify: `apps/panel/src/screens/advanced/logs/logs-screen.test.tsx`
- Modify: `apps/panel/src/screens/advanced/uploads/upload-queue-screen.test.tsx`
- Modify: `apps/panel/src/screens/advanced/device/device-identity-screen.test.tsx`

**Interfaces:**
- Consumes shared admin classes from Task 5.
- Preserves: server-side recording filtering, cursor reset, live log tail, CSV export, upload requeue, device alert acknowledgement, and all query keys.

- [ ] **Step 1: Add failing Recording Library empty-result tests**

```tsx
it('keeps filters visible when an active search returns no rows', async () => {
  renderLibrary({ listRecordings: vi.fn(() => Promise.resolve({ items: [], nextCursor: null })) });
  await userEvent.type(await screen.findByLabelText('Search recordings'), 'missing');
  expect(screen.getByLabelText('Search recordings')).toHaveValue('missing');
  expect(screen.getByText('No recordings match your search or filters.')).toBeInTheDocument();
});

it('uses the device-empty copy only when no filter is active', async () => {
  renderLibrary({ listRecordings: emptyList });
  expect(await screen.findByText('No recordings on this device.')).toBeInTheDocument();
  expect(screen.getByLabelText('Search recordings')).toBeVisible();
});
```

- [ ] **Step 2: Add screen-structure assertions for Logs, Upload Queue, and Device**

```tsx
expect(screen.getByRole('heading', { name: 'System Logs' }).closest('.us-adm__pagehead')).not.toBeNull();
expect(screen.getByRole('heading', { name: 'Upload Queue' }).closest('.us-adm__pagehead')).not.toBeNull();
expect(screen.getByRole('heading', { name: 'Device & Identity' }).closest('.us-adm__pagehead')).not.toBeNull();
```

- [ ] **Step 3: Run affected tests and verify failure**

Run: `pnpm --filter @eduscope/panel test -- src/screens/library/library-screen.test.tsx src/screens/advanced/logs/logs-screen.test.tsx src/screens/advanced/uploads/upload-queue-screen.test.tsx src/screens/advanced/device/device-identity-screen.test.tsx`

Expected: FAIL on filter visibility/copy and new shared-header structure.

- [ ] **Step 4: Keep filters mounted and isolate empty results**

```tsx
const hasActiveFilters = Boolean(filters.q || filters.ownerUserId || filters.state || filters.includeDeleted);

<div className="us-library__header">
  <h1>Recordings</h1>
  <LibraryFilters value={filters} isAdmin={isAdmin} onChange={setFilters} />
  <button type="button" className="us-library__select" disabled={rows.length === 0}>Select</button>
</div>

{rows.length === 0 && removed.length === 0 ? (
  <div className="us-library__empty" role="status">
    <p>{hasActiveFilters ? 'No recordings match your search or filters.' : emptyCopy}</p>
  </div>
) : (
  <ul className="us-reclist">{/* existing RecordingRow mapping */}</ul>
)}
```

Render the same header during loading and put skeletons only in the result region. Do not change `useRecordings` or filtering semantics.

- [ ] **Step 5: Apply the shared page/section system**

Use a sticky/retained filter area and scrolling log result region; card-like upload job rows with readable progress/status; grouped identity, feature, time, health, publisher, and alert sections. Increase primary row text to 15–16px while leaving technical metadata 13–14px. Preserve list/table semantics.

- [ ] **Step 6: Run affected suites**

Run: `pnpm --filter @eduscope/panel test -- src/screens/library src/screens/advanced/logs src/screens/advanced/uploads src/screens/advanced/device`

Expected: PASS including loading, empty, filtered, pagination, export, requeue, stale, and acknowledgement cases.

- [ ] **Step 7: Commit**

```bash
git add apps/panel/src/screens/library apps/panel/src/screens/advanced/logs apps/panel/src/screens/advanced/uploads apps/panel/src/screens/advanced/device
git commit -m "style(panel): modernize admin status and library screens"
```

---

### Task 7: Replace Blocking Alert Banners with a Header Notification Center

**Files:**
- Create: `apps/panel/src/shell/notification-center.tsx`
- Create: `apps/panel/src/shell/notification-center.test.tsx`
- Modify: `apps/panel/src/shell/panel-header.tsx`
- Modify: `apps/panel/src/shell/panel-header.test.tsx`
- Modify: `apps/panel/src/routes/panel-shell.tsx`
- Modify: `apps/panel/src/routes/panel-shell.test.tsx`
- Modify: `apps/panel/src/shell/shell.css`
- Delete: `apps/panel/src/shell/alert-banners.tsx`
- Delete: `apps/panel/src/shell/alert-banners.test.tsx`

**Interfaces:**
- Produces: `NotificationCenter(): JSX.Element` mounted inside `PanelHeader`.
- Preserves: query/store alert merge, severity sorting, suppression, local dismissal, and `client.acknowledgeAlert(id)`.
- Removes: `.us-alertlane` and `.us-alertbanner*` interaction-blocking lane.

- [ ] **Step 1: Port existing alert tests to the notification interaction**

```tsx
it('shows a count and reveals all active alerts in severity order', async () => {
  renderNotifications([warningAlert, criticalAlert]);
  const trigger = await screen.findByRole('button', { name: 'Notifications, 2 active' });
  await userEvent.click(trigger);
  const cards = screen.getAllByTestId('notification-card');
  expect(cards[0]).toHaveTextContent(criticalAlert.title);
  expect(cards[1]).toHaveTextContent(warningAlert.title);
});

it('acknowledges and locally removes one notification', async () => {
  const acknowledgeAlert = vi.fn(() => Promise.resolve());
  renderNotifications([warningAlert], acknowledgeAlert);
  await userEvent.click(await screen.findByRole('button', { name: /Notifications/ }));
  await userEvent.click(screen.getByRole('button', { name: `Acknowledge ${warningAlert.title}` }));
  expect(acknowledgeAlert).toHaveBeenCalledWith(warningAlert.id);
  expect(screen.queryByTestId('notification-card')).toBeNull();
});

it('closes on Escape and restores focus to the trigger', async () => {
  renderNotifications([warningAlert]);
  const trigger = await screen.findByRole('button', { name: /Notifications/ });
  await userEvent.click(trigger);
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog', { name: 'Notifications' })).toBeNull();
  expect(trigger).toHaveFocus();
});
```

- [ ] **Step 2: Run notification tests and verify failure**

Run: `pnpm --filter @eduscope/panel test -- src/shell/notification-center.test.tsx src/routes/panel-shell.test.tsx`

Expected: FAIL because the notification center does not exist and the banner lane is still mounted.

- [ ] **Step 3: Extract existing alert aggregation into the header component**

```tsx
export function NotificationCenter(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Reuse AlertBanners query + WS merge + suppression + severity sort exactly.
  return (
    <div className="us-notifications">
      <button
        ref={triggerRef}
        type="button"
        className="us-notifications__trigger"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Notifications, ${active.length} active`}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">Notifications</span>
        {active.length > 0 ? <span className="us-notifications__count">{active.length}</span> : null}
      </button>
      {open ? <section role="dialog" aria-label="Notifications" className="us-notifications__panel">{/* active cards */}</section> : null}
    </div>
  );
}
```

Use document-level pointerdown only while open for outside close; clean it up in the effect. On Escape close and focus `triggerRef`. The panel has a max height and internal scroll. Severity is communicated by visible text/icon plus color.

- [ ] **Step 4: Mount in the header and remove the lane**

Place `<NotificationCenter />` between `<PanelClock />` and `<UserMenu />`. Remove `<AlertBanners />` from `PanelShell`, delete obsolete files and CSS, and keep the header below modal overlays but above page content.

- [ ] **Step 5: Adjust the clock around recording chrome**

```css
.us-header[data-recording-active='true'] .us-clock {
  top: calc(50% + var(--sp-3));
}
```

In `PanelHeader`, consume `useRecordingState()` and set `data-recording-active` for `recording`, `paused`, `stopping`, and `finalizing`. Use the same offset for all four states so header position never jumps. Add header tests for active and idle attribute values.

- [ ] **Step 6: Run shell and route tests**

Run: `pnpm --filter @eduscope/panel test -- src/shell src/routes/panel-shell.test.tsx`

Expected: PASS for cold-query alerts, WS deduplication, suppression, acknowledgement, focus restoration, authenticated-only chrome, and recording states.

- [ ] **Step 7: Commit**

```bash
git add apps/panel/src/shell apps/panel/src/routes/panel-shell.tsx apps/panel/src/routes/panel-shell.test.tsx
git commit -m "feat(panel): move system alerts into notification center"
```

---

### Task 8: Confirm User-Initiated Stop Recording

**Files:**
- Create: `apps/panel/src/screens/transport/stop-recording-confirm.tsx`
- Create: `apps/panel/src/screens/transport/stop-recording-confirm.test.tsx`
- Modify: `apps/panel/src/screens/transport/timer-card.tsx`
- Modify: `apps/panel/src/screens/transport/timer-card.test.tsx`
- Modify: `apps/panel/src/danger/danger-confirm.tsx`
- Modify: `apps/panel/src/danger/danger-confirm.test.tsx`

**Interfaces:**
- Produces: `StopRecordingConfirm({ disabled, onCancel, onConfirm }): JSX.Element` as a configured `DangerConfirm`.
- Preserves: `useTransport().run('stop')` as the only stop command path.

- [ ] **Step 1: Add failing TimerCard confirmation tests**

```tsx
it('asks before stopping and Cancel sends no command', async () => {
  const client = renderTimer({ state: 'recording' });
  await userEvent.click(screen.getByRole('button', { name: 'Stop' }));
  expect(screen.getByRole('alertdialog', { name: 'Stop recording?' })).toHaveTextContent(
    'Are you sure you want to stop recording?',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(client.stopRecording).not.toHaveBeenCalled();
});

it('confirmation sends the stop command once', async () => {
  const client = renderTimer({ state: 'recording' });
  await userEvent.click(screen.getByRole('button', { name: 'Stop' }));
  await userEvent.click(screen.getByRole('button', { name: 'Stop Recording' }));
  expect(client.stopRecording).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Add Escape and focus-return tests to DangerConfirm**

```tsx
it('cancels on Escape when not pending', async () => {
  const onCancel = vi.fn();
  renderConfirm({ onCancel });
  await userEvent.keyboard('{Escape}');
  expect(onCancel).toHaveBeenCalledOnce();
});
```

- [ ] **Step 3: Run tests and verify failure**

Run: `pnpm --filter @eduscope/panel test -- src/screens/transport/timer-card.test.tsx src/screens/transport/stop-recording-confirm.test.tsx src/danger/danger-confirm.test.tsx`

Expected: FAIL because Stop currently calls transport immediately.

- [ ] **Step 4: Implement confirmation through the existing overlay host**

```tsx
export function StopRecordingConfirm(props: StopRecordingConfirmProps): JSX.Element {
  return (
    <DangerConfirm
      title="Stop recording?"
      body="Are you sure you want to stop recording?"
      confirmLabel="Stop Recording"
      pendingLabel="Stopping…"
      state="confirm"
      confirmDisabled={props.disabled}
      onCancel={props.onCancel}
      onConfirm={props.onConfirm}
    />
  );
}
```

In `TimerCard`, keep a ref to the Stop button and an `overlayOpenRef` guard. Open one dismissible overlay on Stop; close it on cancel; on confirm close the overlay and call `transport.run('stop')` once. Existing TimerCard pending/failure UI continues to display command progress after the overlay closes. Restore Stop-button focus after cancel when it still exists.

Add Escape handling inside `DangerConfirm` only when `state !== 'pending'`; retain the existing focus trap and cancel-first focus.

- [ ] **Step 5: Run transport/danger tests**

Run: `pnpm --filter @eduscope/panel test -- src/screens/transport src/danger`

Expected: PASS for cancel, Escape, confirm-once, pending, failure, stale, authority, and pause/resume behavior.

- [ ] **Step 6: Commit**

```bash
git add apps/panel/src/screens/transport apps/panel/src/danger
git commit -m "feat(panel): confirm before stopping recordings"
```

---

### Task 9: Full Regression, Accessibility, and Browser Visual QA

**Files:**
- Create: `apps/panel/e2e/panel-ui-modernization.spec.ts`
- Modify only when a documented QA defect is found: files changed in Tasks 1–8.

**Interfaces:**
- Consumes all prior tasks.
- Produces a clean typecheck/build/test run and browser evidence at 1280×800 plus one smaller viewport.

- [ ] **Step 1: Run formatting-independent static checks**

Run: `pnpm --filter @eduscope/panel typecheck`

Expected: PASS with no TypeScript errors.

- [ ] **Step 2: Run the complete panel unit suite**

Run: `pnpm --filter @eduscope/panel test`

Expected: PASS with no failed or skipped modernization tests.

- [ ] **Step 3: Build the production panel**

Run: `pnpm --filter @eduscope/panel build`

Expected: PASS and Vite emits the production bundle.

- [ ] **Step 4: Start the panel and verify with the in-app Browser**

Run: `pnpm --filter @eduscope/panel dev -- --host 127.0.0.1`

Use the Browser plugin first. At 1280×800, verify:

- Default keyboard includes numbers and has no oversized black margins.
- Network/camera octets, Volume UUID, user dialogs, and owner search open the keyboard.
- All three requested switch contexts use the slim centered track.
- Questions, Previous Questions, and Leaderboard text is readable and actions remain available.
- Expanded Live Meeting never covers the collapsed Insights/Leaderboard tabs.
- Storage, Firmware, Users, Logs, Library, Upload Queue, and Device screens share the restrained layout.
- Format is clearly destructive and still guarded.
- Empty recording searches keep the typed query and filter controls visible.
- Notifications open from the header, persist until acknowledged, and do not cover page recovery actions.
- Recording notch and clock do not overlap.
- Stop opens confirmation; Cancel does nothing; confirmation stops once.

- [ ] **Step 5: Check smaller viewport, keyboard navigation, and zoom containment**

Verify a 1024×700 viewport, keyboard-only tab/shift-tab/Escape, visible focus, internal scrolling, 200% browser zoom, and reduced motion. Fix only layout/accessibility defects within plan scope.

- [ ] **Step 6: Capture and inspect final screenshots**

Capture representative screenshots for session sidebar, questions modal, storage, library filtered-empty state, notification panel, and stop confirmation. Inspect each with `view_image` for clipping, overlap, contrast, type scale, button hierarchy, and unfinished visual states.

- [ ] **Step 7: Re-run affected checks after visual fixes**

Run separately:

```bash
pnpm --filter @eduscope/panel typecheck
pnpm --filter @eduscope/panel test
pnpm --filter @eduscope/panel build
```

Expected: PASS.

- [ ] **Step 8: Commit final QA fixes**

```bash
git add apps/panel
git commit -m "test(panel): verify UI modernization journeys"
```

---

## Plan Self-Review Checklist

- Every requirement in design sections 4–12 maps to Tasks 1–8.
- Accessibility and interaction standards are exercised per task and in Task 9.
- No backend, API-client, shared-schema, route, or authorization change is planned.
- New interfaces are defined before consumers use them.
- Each task has a failing-test step, focused implementation, passing-test step, and isolated commit.
- Browser verification covers the fixed kiosk viewport, smaller containment viewport, keyboard navigation, zoom, reduced motion, and visual inspection.
