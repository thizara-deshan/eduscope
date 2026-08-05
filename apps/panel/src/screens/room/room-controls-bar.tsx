import { useState } from 'react';
import { useNavigate } from 'react-router';
import { MicMasterRow } from './mic-master-row.js';
import { NotConnectedRegion, ROOM_HARDWARE } from './not-connected-region.js';
import './room.css';

export function RoomControlsBar(): JSX.Element {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  return (
    <section
      className={`us-roombar${open ? ' us-roombar--open' : ''}`}
      data-testid="room-controls-bar"
      aria-label="Room controls"
    >
      <header className="us-roombar__head">
        <span className="us-roombar__title">ROOM CONTROLS</span>
        <div className="us-roombar__actions">
          <button type="button" className="us-roombar__action" onClick={() => navigate('/advanced')}>
            Advanced
          </button>
          <button type="button" className="us-roombar__action" onClick={() => setOpen((value) => !value)}>
            {open ? 'Collapse' : 'Show controls'}
          </button>
        </div>
      </header>
      {open ? (
        <div className="us-roomcontrols">
          <section className="us-roomregion us-roomregion--microphone" aria-labelledby="us-room-microphone-title">
            <h3 className="us-roomregion__title" id="us-room-microphone-title">MICROPHONE</h3>
            <MicMasterRow />
          </section>
          <section className="us-roomregion us-roomregion--power" aria-labelledby="us-room-power-title">
            <h3 className="us-roomregion__title" id="us-room-power-title">POWER</h3>
          </section>
          <NotConnectedRegion title="NOT CONNECTED" items={ROOM_HARDWARE} />
        </div>
      ) : null}
    </section>
  );
}
