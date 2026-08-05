import { useEffect, useState } from 'react';
import { listScenarios, type ScenarioName, type WorldSeed } from '@eduscope/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useMockClient } from '../client/client-provider.js';
import { useRecordingState } from '../store/selectors.js';
import { useWsStore } from '../store/ws-store.js';
import { useLongPress } from './use-long-press.js';
import './scenario-overlay.css';

const LONG_PRESS_MS = 2_000;

/**
 * Two scaffold-only seams (W1-D-5, moved here from `App.tsx`'s `ScaffoldShell`):
 *  - `data-recording-state` mirrors the WS store so e2e asserts on STATE, not
 *    on screen markup that later waves replace wholesale.
 *  - `window.__renderCount` counts commits so Gate 1e can prove telemetry
 *    never renders.
 * Moving both here (rather than leaving them unconditional in App.tsx) means
 * they inherit this overlay's MOCK_ADAPTER gate — neither reaches a kiosk build.
 */
declare global {
  interface Window {
    __renderCount?: number;
  }
}

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
  const queryClient = useQueryClient();
  const recordingState = useRecordingState();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<ScenarioName>(client?.scenario ?? 'happy');
  const [seed, setSeed] = useState<Partial<WorldSeed>>({});
  const longPress = useLongPress(LONG_PRESS_MS, () => setOpen(true));

  // Gate 1e counts COMMITS of this component to prove telemetry never
  // renders. It lives in an effect, not the render body: StrictMode renders
  // twice and throws one away, so a counter incremented during render reports
  // 2x per commit and mutates module state from a function that must stay pure.
  useEffect(() => {
    window.__renderCount = (window.__renderCount ?? 0) + 1;
  });

  if (!client) return null;

  const rebuild = (name: ScenarioName, nextSeed: Partial<WorldSeed>) => {
    // reset() BEFORE switchScenario(): the new world's bootstrap (seeded
    // storage pressure, etc.) emits its events SYNCHRONOUSLY inside
    // switchScenario() itself, and the panel's events$ subscription ingests
    // them just as synchronously. Resetting afterward wiped out exactly the
    // alerts the new scenario had just raised (found live — disk-full's
    // storage.critical alert never reached the banner host).
    useWsStore.getState().reset();
    client.switchScenario(name, nextSeed);
    // REST-backed rows (provisioning, presets, roles, storage) belong to the
    // disposable world too. Without invalidation a World-strip change updated
    // WS truth but left screens rendering the previous world's query cache.
    void queryClient.invalidateQueries();
    setActive(name);
    setSeed(nextSeed);
  };

  const choose = (name: ScenarioName) => rebuild(name, seed);

  // Dev tool only — refusals are caught and ignored; S-04 renders them for
  // real once the wave that owns it lands.
  const swallow = (p: Promise<unknown>) => void p.catch(() => {});

  return (
    <>
      <div data-recording-state={recordingState} className="us-devoverlay__mirror" />
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
                    aria-label={script.name}
                  />
                  <span className="us-devoverlay__name">{script.name}</span>
                  <span className="us-devoverlay__desc">{script.description}</span>
                </label>
              </li>
            ))}
          </ul>
          <fieldset className="us-devoverlay__world">
            <legend>World</legend>
            <label>
              <input
                type="checkbox"
                checked={!client.worldSeed.aiEnabled}
                onChange={(event) => rebuild(active, { ...seed, aiEnabled: !event.target.checked })}
                aria-label="AI disabled (INT-10 go-live default)"
              />
              AI disabled (INT-10 go-live default)
            </label>
            <label>
              <input
                type="checkbox"
                checked={client.worldSeed.recordingOwnedByOtherUser}
                onChange={(event) => rebuild(active, {
                  ...seed,
                  recordingOwnedByOtherUser: event.target.checked,
                })}
                aria-label="Recorder owned by another user"
              />
              Recorder owned by another user
            </label>
            <label>
              <input
                type="checkbox"
                checked={client.worldSeed.audioApplyFails}
                onChange={(event) => rebuild(active, {
                  ...seed,
                  audioApplyFails: event.target.checked,
                })}
                aria-label="Mic changes fail to apply"
              />
              Mic changes fail to apply
            </label>
            {(['ok', 'warning', 'critical'] as const).map((pressure) => {
              const label = `Storage: ${pressure}`;
              return (
                <label key={pressure}>
                  <input
                    type="radio"
                    name="world-storage-pressure"
                    checked={client.worldSeed.storagePressure === pressure}
                    onChange={() => rebuild(active, { ...seed, storagePressure: pressure })}
                    aria-label={label}
                  />
                  {label}
                </label>
              );
            })}
            <label>
              <input
                type="checkbox"
                checked={!client.worldSeed.quizAvailable}
                onChange={(event) => rebuild(active, {
                  ...seed,
                  quizAvailable: !event.target.checked,
                })}
                aria-label="Quiz server unavailable"
              />
              Quiz server unavailable
            </label>
          </fieldset>
          <div className="us-devoverlay__transport">
            <button
              type="button"
              data-testid="e2e-start-recording"
              onClick={() => swallow(client.startRecording())}
            >
              Start
            </button>
            <button type="button" data-testid="dev-pause" onClick={() => swallow(client.pauseRecording())}>
              Pause
            </button>
            <button type="button" data-testid="dev-resume" onClick={() => swallow(client.resumeRecording())}>
              Resume
            </button>
            <button type="button" data-testid="dev-stop" onClick={() => swallow(client.stopRecording())}>
              Stop
            </button>
            <button
              type="button"
              data-testid="dev-meeting-on"
              onClick={() => swallow(client.enableChannel('meeting'))}
            >
              Meeting on
            </button>
            <button
              type="button"
              data-testid="dev-meeting-off"
              onClick={() => swallow(client.disableChannel('meeting'))}
            >
              Meeting off
            </button>
          </div>
        </div>
      )}
    </>
  );
}
