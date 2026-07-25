import { useState } from 'react'
import { Radio, Save, Tv } from 'lucide-react'
import { STREAMING_PLATFORMS } from '../../../mock/admin'
import { presetName } from '../../../mock/session'
import { useRecording } from '../../../context/RecordingContext'
import { Toggle } from '../../ui/Toggle'
import { LayoutPresetPicker } from '../../outputs/LayoutPresetPicker'
import { LayoutPreview } from '../../outputs/LayoutPreview'
import { cn } from '../../ui/cn'

type Platform = (typeof STREAMING_PLATFORMS)[number]

export function StreamingConfig() {
  const { channels, toggleChannel, setChannelPreset } = useRecording()
  const streaming = channels.find((c) => c.id === 'streaming')!
  const [platform, setPlatform] = useState<Platform>('YouTube Live')
  const [saved, setSaved] = useState<Platform[]>([])

  return (
    <>
      <section className="us-adm__card">
        <div className="us-adm__streamhead">
          <div>
            <h2 className="us-adm__cardtitle">
              <Radio size={19} /> Live Streaming
            </h2>
            <p className="us-adm__note">
              {streaming.enabled ? 'Broadcasting to your configured platform.' : 'Currently off.'}
            </p>
          </div>
          <Toggle
            checked={streaming.enabled}
            onChange={() => toggleChannel('streaming')}
            label="Live Streaming"
          />
        </div>

        <div className="us-adm__streamlayout">
          <div className="us-adm__streampreview">
            <span className="us-adm__field">
              <span>Layout preview · {presetName(streaming.preset)}</span>
            </span>
            <LayoutPreview preset={streaming.preset} large />
          </div>
          <LayoutPresetPicker
            channelId="streaming"
            value={streaming.preset}
            onChange={(p) => setChannelPreset('streaming', p)}
          />
        </div>
      </section>

      <section className="us-adm__card">
        <h2 className="us-adm__cardtitle">
          <Tv size={19} /> Select Streaming Platform
        </h2>
        <div className="us-adm__platforms">
          {STREAMING_PLATFORMS.map((p) => (
            <button
              key={p}
              className={cn('us-adm__platform', p === platform && 'us-adm__platform--active')}
              onClick={() => setPlatform(p)}
              aria-pressed={p === platform}
            >
              <Radio size={19} />
              {p}
            </button>
          ))}
        </div>
      </section>

      <section className="us-adm__card">
        <h2 className="us-adm__cardtitle">Stream Credentials</h2>
        <div className="us-adm__grid2">
          <label className="us-adm__field">
            <span>Server URL</span>
            <input className="us-input" defaultValue="rtmp://a.rtmp.youtube.com/live2" />
          </label>
          <label className="us-adm__field">
            <span>Stream Key</span>
            <input className="us-input" type="password" defaultValue="mock-stream-key-1234" />
          </label>
        </div>
        <button
          className="us-adm__primary us-adm__primary--right"
          onClick={() => setSaved((prev) => (prev.includes(platform) ? prev : [...prev, platform]))}
        >
          <Save size={15} />
          Save Config
        </button>
      </section>

      <section className="us-adm__card">
        <h2 className="us-adm__cardtitle us-adm__cardtitle--small">Active configurations</h2>
        {saved.length === 0 ? (
          <p className="us-adm__note">No active configurations saved.</p>
        ) : (
          <div className="us-adm__savedlist">
            {saved.map((p) => (
              <span key={p} className="us-adm__chip">
                {p}
              </span>
            ))}
          </div>
        )}
      </section>
    </>
  )
}
