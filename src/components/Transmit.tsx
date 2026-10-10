import { useMemo, useRef, useState } from 'react'
import type { T } from '../i18n'
import type { Settings } from '../settings'
import type { DecodeDone } from '../useDecoder'
import { ft8Tones, generateSlot, synthGfsk } from '../lib/encode'
import { packMessage, unpackMessage } from '../lib/message'
import { FT8_NN, FT8_TX_START, SAMPLE_RATE } from '../lib/constants'
import { msToNextSlot } from '../lib/clock'
import { encodeWav } from '../lib/wav'
import { addCrc, extractCrc } from '../lib/crc'
import type { Decode } from '../lib/slot'

interface Props {
  settings: Settings
  t: T
  update: (patch: Partial<Settings>) => void
  decode: (samples: Float32Array, sampleRate: number, tag: number) => Promise<DecodeDone>
}

function download(name: string, bytes: Uint8Array, type: string) {
  const url = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const COSTAS_AT = (i: number) => i < 7 || (i >= 36 && i < 43) || i >= 72

/** Encoder: message -> 77 bits -> LDPC -> 79 tones -> GFSK audio that can be played, saved or decoded back. */
export default function Transmit({ settings, t, update, decode }: Props) {
  const call = settings.myCall || 'K1ABC'
  const grid = settings.myGrid.slice(0, 4) || 'FN42'
  const [text, setText] = useState(() => `CQ ${settings.myCall || 'K1ABC'} ${settings.myGrid.slice(0, 4) || 'FN42'}`)
  const [snr, setSnr] = useState(-12)
  const [sync, setSync] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [loop, setLoop] = useState<{ ok: boolean; d?: Decode; ms?: number; error?: string } | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const srcRef = useRef<AudioBufferSourceNode | null>(null)
  const timerRef = useRef(0)

  const packed = useMemo(() => packMessage(text), [text])
  const info = useMemo(() => {
    if (!packed.ok) return null
    const tones = ft8Tones(packed.payload)
    const un = unpackMessage(packed.payload)
    const a91 = addCrc(packed.payload)
    return { tones, un, crc: extractCrc(a91), hex: [...packed.payload].map((b) => b.toString(16).padStart(2, '0')).join('') }
  }, [packed])

  const stop = () => {
    window.clearTimeout(timerRef.current)
    try {
      srcRef.current?.stop()
    } catch {
      // not started yet
    }
    srcRef.current = null
    setPlaying(false)
  }

  const play = async () => {
    if (!packed.ok || !info) return
    stop()
    const wave = synthGfsk(info.tones, settings.txFreq, SAMPLE_RATE)
    for (let i = 0; i < wave.length; i++) wave[i] *= 0.8
    const ctx = (ctxRef.current ??= new AudioContext())
    await ctx.resume()
    const buf = ctx.createBuffer(1, wave.length, SAMPLE_RATE)
    buf.copyToChannel(wave as Float32Array<ArrayBuffer>, 0)
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(ctx.destination)
    src.onended = () => setPlaying(false)
    srcRef.current = src
    setPlaying(true)
    // Optionally start at the next slot boundary (+0.5 s), like a real transmission.
    const delay = sync ? msToNextSlot(Date.now() + settings.clockOffsetMs) + FT8_TX_START * 1000 : 0
    if (delay > 0) timerRef.current = window.setTimeout(() => src.start(), delay)
    else src.start()
  }

  const saveWav = () => {
    if (!packed.ok || !info) return
    const wave = synthGfsk(info.tones, settings.txFreq, SAMPLE_RATE)
    const slot = new Float32Array(15 * SAMPLE_RATE)
    const off = Math.round(FT8_TX_START * SAMPLE_RATE)
    for (let i = 0; i < wave.length; i++) slot[off + i] = wave[i] * 0.8
    download(`ft8_${settings.txFreq}Hz.wav`, encodeWav(slot, SAMPLE_RATE), 'audio/wav')
  }

  const loopback = async () => {
    if (!packed.ok) return
    setLoop(null)
    try {
      const slot = generateSlot([{ payload: packed.payload, freq: settings.txFreq, snr, start: FT8_TX_START }], Date.now() & 0xffff)
      const r = await decode(slot, SAMPLE_RATE, 0)
      const d = r.result.decodes[0]
      setLoop(d ? { ok: true, d, ms: r.ms } : { ok: false, ms: r.ms })
    } catch (e) {
      setLoop({ ok: false, error: e instanceof Error ? e.message : String(e) })
    }
  }

  const templates = [
    `CQ ${call} ${grid}`,
    `CQ DX ${call} ${grid}`,
    `K1ABC ${call} ${grid}`,
    `K1ABC ${call} -10`,
    `K1ABC ${call} R-08`,
    `K1ABC ${call} RR73`,
    `K1ABC ${call} 73`,
    'TNX BOB 73 GL',
  ]
  const errorText = !packed.ok
    ? packed.error === 'empty'
      ? t('Type a message.')
      : packed.error === 'tooLong'
        ? t('Too long: free text is limited to 13 characters (0-9 A-Z + - . / ?).')
        : t('Not a valid FT8 message.')
    : ''

  return (
    <section className="box" aria-labelledby="tx-h">
      <h3 id="tx-h">{t('Encoder')}</h3>
      <p className="hint">{t('Builds a real FT8 signal: 77-bit message, CRC-14, LDPC(174,91), 8-FSK with Gaussian shaping.')}</p>
      <div className="field">
        <label htmlFor="tx-msg">{t('Message')}</label>
        <input
          id="tx-msg"
          className={packed.ok ? '' : 'bad'}
          value={text}
          maxLength={40}
          spellCheck={false}
          autoCapitalize="characters"
          onChange={(e) => setText(e.target.value.toUpperCase())}
        />
      </div>
      <div className="chips">
        {templates.map((m) => (
          <button key={m} className="small" onClick={() => setText(m)}>
            {m}
          </button>
        ))}
      </div>
      <div className="field">
        <label htmlFor="tx-f">
          {t('Audio frequency')}: {settings.txFreq} Hz
        </label>
        <input id="tx-f" type="range" min={200} max={2900} step={10} value={settings.txFreq} onChange={(e) => update({ txFreq: +e.target.value })} />
      </div>
      {errorText && <p className="err-text">{errorText}</p>}
      {info && (
        <>
          <p className="hint">
            {t('Packs as')}: <b>{info.un?.text}</b> ({t(info.un ? KIND[info.un.kind] : 'Unsupported')})
            <br />
            77 bit: <code>{info.hex}</code> · CRC-14: <code>{info.crc.toString(16).toUpperCase().padStart(4, '0')}</code>
          </p>
          <svg className="tones" viewBox={`0 0 ${FT8_NN * 4} 40`} role="img" aria-label={t('Tone sequence')}>
            {[...info.tones].map((tone, i) => (
              <rect key={i} x={i * 4} y={36 - tone * 5} width={3.4} height={4} fill={COSTAS_AT(i) ? 'var(--ref-line)' : 'var(--accent)'} />
            ))}
          </svg>
          <p className="hint mono">{[...info.tones].join('')}</p>
        </>
      )}
      <div className="row">
        {playing ? (
          <button onClick={stop}>{t('Stop')}</button>
        ) : (
          <button className="primary" onClick={play} disabled={!packed.ok}>
            {t('Play')}
          </button>
        )}
        <button onClick={saveWav} disabled={!packed.ok}>
          {t('Save WAV')}
        </button>
        <label className="check">
          <input type="checkbox" checked={sync} onChange={(e) => setSync(e.target.checked)} /> {t('Start at next slot')}
        </label>
      </div>
      <div className="row">
        <button onClick={loopback} disabled={!packed.ok}>
          {t('Decode it back')}
        </button>
        <label htmlFor="tx-snr">{t('with noise at SNR')}</label>
        <input id="tx-snr" type="number" min={-24} max={20} value={snr} onChange={(e) => setSnr(Math.max(-24, Math.min(20, +e.target.value || 0)))} style={{ width: 64 }} />
        <span>dB</span>
      </div>
      {loop && (
        <p className={loop.ok ? 'ok-text' : 'err-text'}>
          {loop.error
            ? loop.error
            : loop.ok && loop.d
              ? t('Decoded: {0} (SNR {1} dB, DT {2} s, {3} Hz) in {4} ms', loop.d.text, loop.d.snr, loop.d.dt.toFixed(1), Math.round(loop.d.freq), loop.ms ?? 0)
              : t('Not decoded at this SNR.')}
        </p>
      )}
      <p className="hint warn-text">{t('Radio transmission needs an amateur licence. This tool only produces audio; you feed it to your own rig.')}</p>
    </section>
  )
}

const KIND = {
  standard: 'Standard message',
  nonstandard: 'Non-standard callsign',
  free: 'Free text',
  telemetry: 'Telemetry',
  unsupported: 'Unsupported',
} as const
