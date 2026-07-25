import { HardDrive, Lock } from 'lucide-react'
import { useRecording } from '../../../context/RecordingContext'
import { presetName } from '../../../mock/session'
import { LayoutPresetPicker } from '../../outputs/LayoutPresetPicker'
import { LayoutPreview } from '../../outputs/LayoutPreview'

/**
 * Local Capture layout selector — relocated here from the old dashboard drawer.
 * Local recording is always on; this only chooses how CAM/PC are arranged in
 * the saved file. Available to both lecturers and administrators.
 */
export function LocalCaptureLayout() {
  const { channels, setChannelPreset } = useRecording()
  const local = channels.find((c) => c.id === 'local')!

  return (
    <section className="us-adm__card">
      <div className="us-adm__streamhead">
        <div>
          <h2 className="us-adm__cardtitle">
            <HardDrive size={19} /> Local Capture Layout
          </h2>
          <p className="us-adm__note">
            Recorded to the rack device every session. Choose how it’s laid out.
          </p>
        </div>
        <span className="us-adm__alwayson">
          <Lock size={14} /> Always on
        </span>
      </div>

      <div className="us-adm__streamlayout">
        <div className="us-adm__streampreview">
          <span className="us-adm__field">
            <span>Layout preview · {presetName(local.preset)}</span>
          </span>
          <LayoutPreview preset={local.preset} large />
        </div>
        <LayoutPresetPicker
          channelId="local"
          value={local.preset}
          onChange={(p) => setChannelPreset('local', p)}
        />
      </div>
    </section>
  )
}
