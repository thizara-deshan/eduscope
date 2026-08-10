# Eduscope Panel UI Modernization Design

**Date:** 2026-08-10  
**Status:** Approved  
**Scope:** Visual modernization and usability fixes for the lecturer and administrator panel, with one explicitly requested confirmation step before stopping a recording.

## 1. Goals

- Preserve existing workflows, data contracts, routes, permissions, and command behavior.
- Improve legibility and touch usability for lecturers of any age without making the interface decorative or visually busy.
- Apply a consistent visual language across session controls and administrator screens.
- Resolve the known keyboard, layout, empty-state, notification, header, and switch presentation issues.
- Add a confirmation dialog before the existing stop-recording command is sent.

## 2. Constraints

- Continue using the existing React/Vite application, CSS design tokens, `us-*` class naming, overlay host, and fixed 1280×800 kiosk model.
- Keep the current Eduscope light palette, dark header, brand red, and semantic success/warning/danger colors.
- Do not add a new component framework, icon package, backend endpoint, persistence mechanism, route, or business rule.
- Maintain a minimum 44×44px interactive target and visible keyboard focus.
- Internal regions may scroll; the kiosk page itself must remain non-scrolling.
- Existing unrelated untracked files are outside this work.

## 3. Visual Direction

The implementation will use a restrained system refresh rather than a visual rebrand. Existing tokens remain authoritative, with reusable patterns for screen headers, grouped section cards, status rows, compact badges, input groups, primary actions, and danger zones. Typography will use the current system font with clearer hierarchy: approximately 19–24px screen and dialog headings, 16–17px primary content, and 13–15px supporting metadata. Borders, shadows, and radii remain subtle.

Three approaches were considered:

1. **Recommended: shared-system refresh.** Standardize the affected surfaces using the existing tokens and a small set of reusable CSS patterns. This provides consistency with controlled scope.
2. **CSS-only local patches.** Faster initially, but preserves inconsistent component anatomy and creates repeated one-off rules.
3. **Full visual redesign.** Offers maximum freedom, but changes recognizable structure and exceeds the request to preserve functionality and avoid excessive styling.

The approved approach is the shared-system refresh.

## 4. On-Screen Keyboard

### Layout and appearance

- Keep the keyboard docked inside `.us-panel` at the bottom.
- Replace the fixed oversized black shell with content-driven height plus safe internal padding.
- Remove unused black space above and below the keys while retaining a clear close control.
- Add a number row to the normal alphanumeric layout so password requirements can be satisfied without mode switching.
- Retain a dedicated numeric layout for strongly numeric fields.
- Give IP and camera address inputs a numeric-oriented layout that includes digits, dot, backspace, clear, and completion controls as supported by the existing keyboard host.
- Keep keys large, high contrast, and separated enough for touch use.

### Field coverage

Connect the existing `useOskField` mechanism to currently omitted editable fields, including:

- Administrator network IP address fields.
- Camera address fields.
- Local Storage Volume UUID entry.
- Add User dialog fields.
- Edit User dialog editable fields.
- Recording Library recording search and administrator owner search where those controls are editable text fields.
- Any closely shared field component used by the same workflows when omission would make keyboard behavior inconsistent.

Password fields will continue to use their existing secure behavior while gaining access to numbers through the default layout.

### Behavior preservation

Focus opens the keyboard, blur/commit behavior remains compatible with the existing store, and no input validation rules change. Opening the keyboard must not obscure the active dialog action area; affected overlays will use the existing keyboard-open sizing hook or an equivalent shared rule.

## 5. Toggle Switches

- Preserve the semantic `button`/`role="switch"` behavior and existing callbacks.
- Keep the overall interactive hit area at least 44px high.
- Visually reduce the track to a conventional slim capsule and center it inside the hit area.
- Use a proportionate thumb with clear on/off position, disabled state, and focus ring.
- Apply the corrected switch anatomy consistently to Live Meeting, lecturer microphone, and live-streaming controls rather than overriding each screen independently.

## 6. Questions, Previous Questions, and Leaderboard

### Questions dialog

- Use a centered, clearly bounded dialog surface with a readable title, short supporting text where already present, and an obvious close action.
- Increase question prompt and answer text modestly, with stronger contrast and comfortable line height.
- Give each answer option a distinct row, predictable spacing, and a clear selected/correct state using both color and a non-color indicator.
- Keep primary and secondary actions anchored in a stable footer so they remain easy to find.
- Preserve existing tabs, question generation, editing, sending, and projector behavior.

### Previous Questions

- Increase question titles and answer summaries modestly.
- Use cleaner separation between entries, visible status metadata, and consistent action placement.
- Keep dense information readable without introducing decorative card grids.

### Leaderboard

- Increase names, ranks, and primary score figures modestly.
- Improve row alignment and contrast, with restrained medal/rank emphasis.
- Keep supporting accuracy and response details secondary but readable.
- Preserve all existing selection, refresh, student detail, and live update behavior.

## 7. Live Meeting and Sidebar Layout

- Keep Live Meeting and the AI/leaderboard sections in normal sidebar flex flow.
- Expanded Live Meeting content receives a bounded flexible height and internal scrolling where required.
- Collapsed sections retain their full header height and cannot be covered by adjacent content.
- The sidebar remains the only vertical scrolling region for the stack.
- Avoid absolute positioning or negative spacing between the Live Meeting and leaderboard sections.
- Verify off, starting, on, failed, collapsed, and expanded states at the fixed kiosk height.

## 8. Administrator Screen System

The following screens will share a restrained administrator layout vocabulary:

- Local Storage.
- Firmware Update.
- User Management.
- System Logs.
- Recording Library.
- Upload Queue.
- Device & Identity.

Each screen will use, where appropriate:

- A consistent header with title, concise description, and primary action.
- Grouped section surfaces with clear headings and predictable padding.
- Summary/status regions that emphasize the most important state first.
- Consistent inputs, filters, tables/rows, empty states, and button hierarchy.
- Internal scrolling that preserves page headers and search/filter controls.
- Responsive reduction of multi-column groups without changing the fixed kiosk-first design.

### Local Storage

- Present capacity, drive health, retention policy, and registered volumes in clearly separated sections.
- Improve progress and health visualization while retaining existing values and semantics.
- Place disk formatting in an explicitly labeled danger zone separated from routine actions.
- Style **Format** as a destructive action using the existing danger color and retain the current confirmation workflow.

### Firmware Update

- Present current version, available version, lifecycle status, and actions in a clear status card.
- Make recording-related refusal and update errors readable inline without recreating the global blocking banner.
- Preserve check, download/apply, progress, restart, and refusal behavior.

### User Management

- Keep search, role filters, import, add, edit, disable/delete, and last-administrator protections unchanged.
- Improve table hierarchy, status badges, empty state, row actions, and dialog form spacing.
- Ensure Add User and Edit User dialog fields invoke the on-screen keyboard.

### System Logs

- Keep filters and export controls visible above a dedicated scrolling log table.
- Improve timestamp, severity, source, and message hierarchy with appropriate monospace use for technical values.
- Preserve filtering, tailing, stale state, and export behavior.

### Upload Queue

- Clarify overall queue state and individual recording-job progress.
- Use consistent progress bars, state labels, error details, and retry/requeue action placement.
- Preserve live updates and all job actions.

### Device & Identity

- Group identity, provisioning, health, time/clock, publishers, feature flags, and alerts into clearly labeled sections.
- Keep identifiers copyable and technical values readable without allowing metadata to dominate the page.
- Preserve all existing actions and alert acknowledgement behavior.

## 9. Recording Library Search and Empty States

- Keep the screen header and `LibraryFilters` mounted regardless of loading, zero-device-recording, or zero-filter-result state.
- Render the empty state only in the results region.
- Distinguish between:
  - No recordings exist on the device.
  - No recordings match the active search or filters.
- Preserve the typed recording and owner search values while results update.
- Provide a clear-filters action only through existing filter state; it must not introduce a new data operation.
- Preserve selection mode, pagination/load-more behavior, deletion, playback, and live refresh.

## 10. Notification Center

### Replacement for full-width banners

- Replace interaction-blocking firmware and error banners below the header with a compact notification control in the header.
- Display an unread/severity indicator and accessible label on the control.
- Opening the control shows a bounded notification panel anchored below the header, with persistent cards for current firmware information and system errors.
- Each card includes severity, concise message, relevant existing action, timestamp/count when available, and the existing acknowledgement/close behavior.
- Notifications remain available until acknowledged or resolved according to current state; they are not transient toasts.
- The panel closes on its close action, Escape, or outside interaction and restores focus to the trigger.

### Layering

- The notification panel must not overlap the user-menu actions incorrectly, the recording notch, route error recovery controls, or modal overlays.
- Removing the full-width alert lane restores unobstructed interaction with page content and Back to Dashboard actions.

## 11. Header Clock and Recording State

- Retain the centered clock and date.
- When the recording notch is present, move the clock content down enough to create clear separation while keeping it within the header.
- Preserve the recording frame/notch colors, animation, paused/saving variants, and status text.
- Verify long hall names and user names do not collide with the adjusted clock.

## 12. Stop Recording Confirmation

- Intercept only the user-initiated Stop Recording action before invoking the existing stop command.
- Open an accessible destructive confirmation dialog with the message: **“Are you sure you want to stop recording?”**
- Actions are **Cancel** and **Stop Recording**, with Stop Recording visually destructive.
- Cancel and Escape close the dialog without sending a command.
- Confirmation invokes the existing stop-recording path once and preserves its pending, error, stale-state, and eventual saving behavior.
- Focus moves into the dialog on open, remains trapped while open, and returns to the Stop button on close.

## 13. Accessibility and Interaction Standards

- Use native buttons, inputs, headings, lists, and tables wherever appropriate.
- Dialogs expose `role="dialog"`, `aria-modal`, and labelled title/description relationships.
- Switches expose current state through `aria-checked`.
- Dynamic notification and empty-result changes use suitable live-region semantics without excessive announcements.
- Text and controls meet WCAG AA contrast targets.
- Primary text is resizable and remains usable at 200% zoom within the kiosk constraints through internal scrolling.
- Hover styling has equivalent focus-visible styling.
- Motion respects `prefers-reduced-motion`.

## 14. Architecture and Data Flow

- Visual changes remain within existing screen components and CSS modules/files.
- Shared behavior belongs in existing shared components: keyboard host/binding, switch component or switch class family, overlay/dialog primitives, and shell notification host.
- Screen hooks continue to own server commands and live state. Presentation components receive the same values and callbacks.
- The notification center consumes the existing alert and firmware state; it does not create a second source of truth.
- The stop confirmation sits between the Stop button event and the existing `useTransport` stop action; the transport hook and API client contract remain unchanged.

## 15. Error and Edge States

- Keyboard: switching fields updates layout and value without stale target bindings.
- Dialogs: keyboard-open layout, validation errors, pending actions, and long text remain visible.
- Sidebar: expanded Live Meeting cannot cover leaderboard content at minimum supported height.
- Recording Library: filters stay visible during loading and zero-result responses.
- Notifications: multiple alerts, long text, acknowledgement, and user-menu coexistence are supported through bounded scrolling and correct stacking.
- Stop recording: double confirmation cannot issue duplicate commands; stale or disabled states remain non-interactive.

## 16. Verification Plan

### Automated

- Update/add unit tests for keyboard layouts and new field bindings.
- Test switch semantics and corrected classes/states.
- Test Recording Library filters remain visible for filtered zero results and that the correct empty copy is rendered.
- Test notification trigger, panel, acknowledgement, focus return, and Escape behavior.
- Test Stop Recording cancel, Escape, confirm-once, pending, and disabled states.
- Preserve and run affected screen tests, full panel tests, TypeScript checks, and production build.

### Browser and visual QA

- Use the in-app browser at 1280×800 as the primary kiosk viewport and verify a smaller viewport for graceful containment.
- Exercise keyboard use in password, network, storage, user-management, and library search fields.
- Verify Live Meeting expansion with leaderboard collapsed and expanded.
- Inspect questions, previous questions, leaderboard, all seven modernized administrator screens, notification panel, recording header state, and stop confirmation.
- Check keyboard-only navigation, visible focus, text readability, touch target sizes, internal scrolling, and reduced-motion behavior.
- Capture final screenshots and visually inspect them before handoff.

## 17. Completion Criteria

The work is complete when all requested fields can summon a suitable on-screen keyboard, keyboard and switch geometry is corrected, the specified lecturer and administrator surfaces share the approved restrained design, no Live Meeting/leaderboard overlap remains, library filters survive zero-result searches, notifications no longer block page interaction, the header clock clears the recording notch, and stopping a recording requires explicit confirmation—without changing any other functionality.
