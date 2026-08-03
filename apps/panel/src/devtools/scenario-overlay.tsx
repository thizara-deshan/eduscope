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
                    aria-label={script.name}
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
