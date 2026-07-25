import { useState } from 'react'

export function EncoderSettings() {
  const [bitrate, setBitrate] = useState(4000)

  return (
    <section className="us-adm__card">
      <h2 className="us-adm__cardtitle">Stream &amp; Encoding</h2>

      <div className="us-adm__field">
        <div className="us-adm__sliderhead">
          <span>Target Bitrate (kbps)</span>
          <span className="us-adm__slidervalue">{bitrate} kbps</span>
        </div>
        <input
          type="range"
          className="us-range"
          min={2000}
          max={8000}
          step={250}
          value={bitrate}
          onChange={(e) => setBitrate(Number(e.target.value))}
          aria-label="Target bitrate"
        />
        <div className="us-adm__sliderscale">
          <span>2000 kbps</span>
          <span>8000 kbps</span>
        </div>
      </div>

      <label className="us-adm__field">
        <span>Video Compression Standard</span>
        <select className="us-select" defaultValue="H.264 (AVC)">
          <option>H.264 (AVC)</option>
          <option>H.265 (HEVC)</option>
          <option>AV1</option>
        </select>
      </label>

      <label className="us-adm__field">
        <span>Video Format</span>
        <select className="us-select" defaultValue="MP4">
          <option>MP4</option>
          <option>MKV</option>
          <option>MOV</option>
        </select>
      </label>
    </section>
  )
}
