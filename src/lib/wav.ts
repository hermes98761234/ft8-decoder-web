export interface WavData {
  sampleRate: number
  /** First channel (or the mix of all channels) as floats in -1..1. */
  samples: Float32Array
}

/** Parses RIFF/WAVE PCM 8/16/24/32-bit or 32-bit float; multichannel audio is averaged to mono. */
export function parseWav(bytes: Uint8Array): WavData {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3])
  if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a WAV file')
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null
  let pos = 12
  while (pos + 8 <= bytes.length) {
    const id = tag(pos)
    let size = view.getUint32(pos + 4, true)
    const body = pos + 8
    if (id === 'fmt ') {
      let format = view.getUint16(body, true)
      const bits = view.getUint16(body + 14, true)
      if (format === 0xfffe && size >= 26) format = view.getUint16(body + 24, true)
      fmt = { format, channels: view.getUint16(body + 2, true), rate: view.getUint32(body + 4, true), bits }
    } else if (id === 'data') {
      if (!fmt) throw new Error('WAV data before fmt chunk')
      size = Math.min(size, bytes.length - body)
      const { format, channels, rate, bits } = fmt
      const bps = bits / 8
      const frames = Math.floor(size / (bps * channels))
      const samples = new Float32Array(frames)
      for (let i = 0; i < frames; i++) {
        let sum = 0
        for (let c = 0; c < channels; c++) {
          const o = body + (i * channels + c) * bps
          let v: number
          if (format === 3 && bits === 32) v = view.getFloat32(o, true)
          else if (format === 1 && bits === 16) v = view.getInt16(o, true) / 32768
          else if (format === 1 && bits === 8) v = (bytes[o] - 128) / 128
          else if (format === 1 && bits === 24) v = ((bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16)) << 8 >> 8) / 8388608
          else if (format === 1 && bits === 32) v = view.getInt32(o, true) / 2147483648
          else throw new Error(`Unsupported WAV format (${format}, ${bits} bit)`)
          sum += v
        }
        samples[i] = sum / channels
      }
      return { sampleRate: rate, samples }
    }
    pos = body + size + (size & 1)
  }
  throw new Error('WAV has no data chunk')
}

/** Mono 16-bit PCM WAV. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2)
  const view = new DataView(out.buffer)
  const put = (o: number, s: string) => [...s].forEach((c, i) => (out[o + i] = c.charCodeAt(0)))
  put(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  put(8, 'WAVE')
  put(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  put(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), true)
  }
  return out
}
