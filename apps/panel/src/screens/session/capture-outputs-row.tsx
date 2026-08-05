import { useQuery } from '@tanstack/react-query';
import type { ChannelId, ChannelRuntimeState } from '@eduscope/shared';
import { useClient } from '../../client/client-provider.js';
import { useWsShallow } from '../../store/selectors.js';

const CHANNEL_LABELS: Record<ChannelId, string> = {
  local: 'This device',
  meeting: 'Live Meeting',
  streaming: 'Live Stream',
};

// S-05's approved two-row evidence set. Live Stream remains on its dedicated
// configuration surface so the 388 px density never hides or scrolls a fact.
const CAPTURE_ASSURANCE_CHANNELS = new Set<ChannelId>(['local', 'meeting']);

function channelStateWord(channelId: ChannelId, state: ChannelRuntimeState): string {
  if (channelId === 'local' && state === 'on') return 'Recording';
  switch (state) {
    case 'on': return 'On';
    case 'off': return 'Off';
    case 'preflight':
    case 'starting': return 'Starting';
    case 'stopping': return 'Off';
    case 'failed': return 'Stopped';
  }
}

export function CaptureOutputsRow({ dense }: { readonly dense: boolean }): JSX.Element {
  const client = useClient();
  const liveChannels = useWsShallow((state) => state.channels);
  const channelsQuery = useQuery({
    queryKey: ['channels'],
    queryFn: () => client.listChannels(),
  });
  const presetsQuery = useQuery({
    queryKey: ['layout-presets'],
    queryFn: () => client.listLayoutPresets(),
  });

  return (
    <section className="us-captureblock" data-testid="capture-outputs" aria-labelledby="capture-outputs-label">
      <h2 className="us-captureblock__label" id="capture-outputs-label">SAVING TO</h2>
      {!channelsQuery.data || !presetsQuery.data ? (
        <div className="us-captureoutputs__skeleton" data-testid="capture-outputs-skeleton" />
      ) : (
        <div className="us-captureoutputs__rows" data-density={dense ? 'dense' : 'comfortable'}>
          {channelsQuery.data.filter((configured) => (
            CAPTURE_ASSURANCE_CHANNELS.has(configured.channelId)
          )).map((configured) => {
            const channel = liveChannels[configured.channelId] ?? configured;
            const preset = presetsQuery.data.find((row) => row.id === channel.presetId);
            return (
              <div className="us-captureoutput" key={channel.channelId}>
                <span className="us-captureoutput__name">
                  {CHANNEL_LABELS[channel.channelId]}{preset ? ` — ${preset.displayName}` : ''}
                </span>
                <span className={`us-captureoutput__state us-captureoutput__state--${channel.state}`}>
                  {channelStateWord(channel.channelId, channel.state)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
