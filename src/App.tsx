import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { tr, N, type T } from './i18n'
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from './settings'
import { useDecoder } from './useDecoder'
import { SlotCapture, type CapturedSlot } from './capture'
import { buildGridBook, entryKind, makeEntries, toDecodedText, type Entry } from './entries'
import { FT8_SLOT_TIME, FT8_TX_START, SAMPLE_RATE } from './lib/constants'
import { msToNextSlot, slotParity, slotStart, utcClock } from './lib/clock'
import { generateSlot } from './lib/encode'
import { packMessage } from './lib/message'
import { parseWav } from './lib/wav'
import { gridToLatLon } from './lib/grid'
import Waterfall, { type Marker, type StaticWaterfall } from './components/Waterfall'
import MessageList from './components/MessageList'
import WorldMap, { type MapPoint } from './components/WorldMap'
import Transmit from './components/Transmit'

const SAMPLES = [
  { file: '191111_110130.wav', label: N('Sample 1'), at: Date.UTC(2019, 10, 11, 11, 1, 30) },
  { file: '191111_110200.wav', label: N('Sample 2'), at: Date.UTC(2019, 10, 11, 11, 2, 0) },
]

const DEMO_MESSAGES: [string, number, number][] = [
  ['CQ DX JA1ABC PM95', 480, -3],
  ['CQ W1AW FN31', 860, -7],
  ['OH2XYZ K5ZD EM12', 1190, -9],
  ['K5ZD OH2XYZ -12', 1500, -12],
  ['VK3ABC UA9XYZ R-07', 1830, -10],
  ['CQ LU1ABC GF05', 2140, -14],
  ['ZS6ABC PY2XYZ RR73', 2410, -16],
  ['CQ UR5XXX KO50', 2700, -6],
  ['CQ 9A1ABC JN85', 1030, -17],
  ['TNX 73 GL', 2000, -5],
]

const MAX_ENTRIES = 600

type Status = { kind: 'idle' } | { kind: 'busy'; what: string } | { kind: 'error'; message: string }

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const t: T = useCallback((s, ...a) => tr(settings.lang, s, ...a), [settings.lang])
  const update = useCallback((patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch })), [])
  const [entries, setEntries] = useState<Entry[]>([])
  const [staticWf, setStaticWf] = useState<StaticWaterfall | null>(null)
  const [staticMarkers, setStaticMarkers] = useState<Marker[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [info, setInfo] = useState<{ ms: number; candidates: number } | null>(null)
  const [capture, setCapture] = useState<SlotCapture | null>(null)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [now, setNow] = useState(() => Date.now())
  const decode = useDecoder()
  const settingsRef = useRef(settings)
  useEffect(() => {
    settingsRef.current = settings
  })
  const started = useRef(false)
  const captureRef = useRef<SlotCapture | null>(null)

  useEffect(() => saveSettings(settings), [settings])
  useEffect(() => {
    const root = document.documentElement
    if (settings.theme === 'auto') delete root.dataset.theme
    else root.dataset.theme = settings.theme
    root.lang = settings.lang
  }, [settings.theme, settings.lang])
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 200)
    return () => window.clearInterval(id)
  }, [])

  const addEntries = useCallback((list: Entry[]) => {
    setEntries((old) => [...list.sort((a, b) => a.freq - b.freq), ...old].slice(0, MAX_ENTRIES))
  }, [])

  /** Decode one slot of audio and publish the result. */
  const runDecode = useCallback(
    async (samples: Float32Array, rate: number, start: number, source: Entry['source'], opts: { label?: string; show: boolean }) => {
      setStatus({ kind: 'busy', what: 'Decoding…' })
      try {
        const r = await decode(samples, rate, start)
        const list = makeEntries(r.result.decodes, start, source, opts.label)
        addEntries(list)
        setInfo({ ms: r.ms, candidates: r.result.candidates })
        if (opts.show) {
          setStaticWf({ ...r.result, slotStart: source === 'file' ? 0 : start })
          setStaticMarkers(
            list.map((e) => ({
              id: e.key,
              freq: e.freq,
              start: e.dt + FT8_TX_START,
              label: e.text,
              kind: entryKind(e, settingsRef.current.myCall),
            })),
          )
        }
        setStatus({ kind: 'idle' })
        return list
      } catch (e) {
        setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
        return []
      }
    },
    [decode, addEntries],
  )

  const stopLive = useCallback(() => {
    captureRef.current?.stop()
    captureRef.current = null
    setCapture(null)
  }, [])

  const loadSample = useCallback(
    async (i: number) => {
      stopLive()
      const s = SAMPLES[i]
      setStatus({ kind: 'busy', what: 'Decoding…' })
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}samples/${s.file}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const wav = parseWav(new Uint8Array(await res.arrayBuffer()))
        await runDecode(wav.samples, wav.sampleRate, s.at, 'sample', { show: true })
      } catch (e) {
        setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
      }
    },
    [runDecode, stopLive],
  )

  const loadDemo = useCallback(async () => {
    stopLive()
    const sigs = DEMO_MESSAGES.map(([m, freq, snr], i) => {
      const p = packMessage(m)
      if (!p.ok) throw new Error(m)
      return { payload: p.payload, freq, snr, start: FT8_TX_START + ((i * 37) % 100) / 100 - 0.3 }
    })
    const samples = generateSlot(sigs, 20260101 + Math.floor(Date.now() / 15000))
    await runDecode(samples, SAMPLE_RATE, slotStart(Date.now()), 'demo', { show: true })
  }, [runDecode, stopLive])

  const loadFile = useCallback(
    async (file: File) => {
      stopLive()
      setStatus({ kind: 'busy', what: 'Decoding…' })
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        let samples: Float32Array
        let rate: number
        try {
          const w = parseWav(bytes)
          samples = w.samples
          rate = w.sampleRate
        } catch {
          const ac = new AudioContext()
          const buf = await ac.decodeAudioData(bytes.buffer.slice(0) as ArrayBuffer)
          void ac.close()
          rate = buf.sampleRate
          samples = new Float32Array(buf.length)
          for (let c = 0; c < buf.numberOfChannels; c++) {
            const ch = buf.getChannelData(c)
            for (let i = 0; i < buf.length; i++) samples[i] += ch[i] / buf.numberOfChannels
          }
        }
        const n = Math.round(rate * FT8_SLOT_TIME)
        const total = Math.max(1, Math.floor(samples.length / n + 0.34))
        let first = true
        for (let k = 0; k < total; k++) {
          const chunk = new Float32Array(n)
          chunk.set(samples.subarray(k * n, Math.min(samples.length, (k + 1) * n)))
          const m = Math.floor((k * FT8_SLOT_TIME) / 60)
          const s = (k * FT8_SLOT_TIME) % 60
          await runDecode(chunk, rate, 0, 'file', { label: `${file.name.slice(0, 18)} ${m}:${String(s).padStart(2, '0')}`, show: first })
          first = false
        }
      } catch (e) {
        setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
      }
    },
    [runDecode, stopLive],
  )

  const startLive = useCallback(
    async (deviceId?: string) => {
      stopLive()
      try {
        const cap = await SlotCapture.start({
          deviceId: deviceId ?? settingsRef.current.deviceId,
          clockOffsetMs: () => settingsRef.current.clockOffsetMs,
          onSlot: (slot: CapturedSlot) => {
            void runDecode(slot.samples, slot.sampleRate, slot.start, 'live', { show: false })
          },
          onSkip: () => setStatus({ kind: 'idle' }),
        })
        captureRef.current = cap
        setCapture(cap)
        setStaticWf(null)
        setStaticMarkers([])
        setStatus({ kind: 'idle' })
        const list = await navigator.mediaDevices.enumerateDevices()
        setDevices(list.filter((d) => d.kind === 'audioinput'))
      } catch (e) {
        const name = e instanceof DOMException ? e.name : ''
        setStatus({
          kind: 'error',
          message:
            name === 'NotAllowedError'
              ? 'Microphone access was denied.'
              : name === 'NotFoundError'
                ? 'No audio input device found.'
                : e instanceof Error
                  ? e.message
                  : String(e),
        })
      }
    },
    [runDecode, stopLive],
  )

  useEffect(() => () => captureRef.current?.stop(), [])
  // First visit: show a real decode right away.
  useEffect(() => {
    if (started.current) return
    started.current = true
    void loadSample(0)
  }, [loadSample])

  const gridBook = useMemo(() => buildGridBook(entries), [entries])
  const shown = useMemo(() => (settings.cqOnly ? entries.filter((e) => e.text.startsWith('CQ')) : entries), [entries, settings.cqOnly])

  // `now` only decides which slots count as recent; refreshing every few seconds is plenty.
  const nowBucket = Math.floor(now / 5000)
  const liveMarkers: Marker[] = useMemo(() => {
    if (!capture) return staticMarkers
    const cutoff = slotStart(nowBucket * 5000) - 2 * FT8_SLOT_TIME * 1000
    return entries
      .filter((e) => e.source === 'live' && e.slotStart >= cutoff)
      .map((e) => ({ id: e.key, freq: e.freq, start: e.slotStart / 1000 + FT8_TX_START + e.dt, label: e.text, kind: entryKind(e, settings.myCall) }))
  }, [capture, entries, staticMarkers, settings.myCall, nowBucket])

  const points: MapPoint[] = useMemo(() => {
    const out: MapPoint[] = []
    const snrOf = new Map<string, number>()
    const cq = new Set<string>()
    for (const e of [...entries].reverse()) {
      if (e.from) {
        const c = e.from.replace(/^<|>$/g, '')
        snrOf.set(c, e.snr)
        if (e.text.startsWith('CQ')) cq.add(c)
      }
    }
    for (const [call, grid] of gridBook) if (gridToLatLon(grid)) out.push({ call, grid, snr: snrOf.get(call), kind: cq.has(call) ? 'cq' : 'other' })
    return out
  }, [entries, gridBook])

  const selectedEntry = entries.find((e) => e.key === selected) ?? null
  const selectedCall = selectedEntry?.from?.replace(/^<|>$/g, '') ?? null

  const selectCall = (call: string) => {
    const e = entries.find((x) => x.from?.replace(/^<|>$/g, '') === call)
    if (e) setSelected(e.key)
  }

  const corrected = now + settings.clockOffsetMs
  const intoSlot = (corrected - slotStart(corrected)) / 1000
  const statusText =
    status.kind === 'busy'
      ? t(status.what)
      : status.kind === 'error'
        ? t(status.message)
        : capture
          ? t('Listening. Next decode in {0} s.', Math.ceil(msToNextSlot(corrected) / 1000))
          : t('Not listening.')

  const myGridOk = gridToLatLon(settings.myGrid) !== null

  return (
    <div className="app">
      <header className="toolbar">
        <span className="brand">{t('FT8 Decoder')}</span>
        <span className="hint">{t('Decode FT8 amateur radio signals from your microphone, in the browser.')}</span>
        <span className="spacer" />
        <label className="inline">
          {t('Language')}
          <select value={settings.lang} onChange={(e) => update({ lang: e.target.value as Settings['lang'] })} aria-label={t('Language')}>
            <option value="en">English</option>
            <option value="uk">Українська</option>
          </select>
        </label>
        <label className="inline">
          {t('Theme')}
          <select value={settings.theme} onChange={(e) => update({ theme: e.target.value as Settings['theme'] })} aria-label={t('Theme')}>
            <option value="auto">{t('System')}</option>
            <option value="light">{t('Light')}</option>
            <option value="dark">{t('Dark')}</option>
          </select>
        </label>
      </header>
      <div className="body">
        <aside className="side rx">
          <div className="panel">
            <section className="box" aria-labelledby="rx-h">
              <h3 id="rx-h">{t('Receiver')}</h3>
              <div className="clock">
                <span className="utc">{utcClock(corrected)}</span>
                <span className="hint">
                  UTC · {t('slot')} {slotParity(corrected) === 'even' ? t('even (:00/:30)') : t('odd (:15/:45)')}
                </span>
              </div>
              <div className="slotbar" role="progressbar" aria-valuemin={0} aria-valuemax={15} aria-valuenow={Math.round(intoSlot)} aria-label={t('Time within the 15 s slot')}>
                <div style={{ width: `${(intoSlot / FT8_SLOT_TIME) * 100}%` }} />
                <i style={{ left: `${((FT8_TX_START + 79 * 0.16) / FT8_SLOT_TIME) * 100}%` }} />
              </div>
              <div className="row">
                {capture ? (
                  <button className="danger" onClick={stopLive}>
                    {t('Stop listening')}
                  </button>
                ) : (
                  <button className="primary" onClick={() => startLive()} disabled={!navigator.mediaDevices?.getUserMedia}>
                    {t('Start listening')}
                  </button>
                )}
              </div>
              {devices.length > 1 && (
                <div className="field">
                  <label htmlFor="dev">{t('Input device')}</label>
                  <select
                    id="dev"
                    value={settings.deviceId}
                    onChange={(e) => {
                      update({ deviceId: e.target.value })
                      void startLive(e.target.value)
                    }}
                  >
                    <option value="">{t('Default')}</option>
                    {devices.map((d, i) => (
                      <option key={d.deviceId || i} value={d.deviceId}>
                        {d.label || `${t('Input')} ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <p className={status.kind === 'error' ? 'err-text' : 'hint'} role="status">
                {statusText}
              </p>
              {info && (
                <p className="hint">
                  {t('Last slot: {0} candidates, decoded in {1} ms.', info.candidates, info.ms)}
                </p>
              )}
              <h4>{t('Or decode without a radio')}</h4>
              <div className="row">
                {SAMPLES.map((s, i) => (
                  <button key={s.file} className="small" onClick={() => loadSample(i)}>
                    {t(s.label)}
                  </button>
                ))}
                <button className="small" onClick={loadDemo}>
                  {t('Synthetic busy band')}
                </button>
                <label className="small button">
                  {t('Open audio file…')}
                  <input
                    type="file"
                    accept="audio/*,.wav"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) void loadFile(f)
                      e.target.value = ''
                    }}
                  />
                </label>
              </div>
              <p className="hint">{t('Sample recordings are real 20 m FT8 off-air audio from the ft8_lib test set.')}</p>
            </section>
          </div>
        </aside>

        <main className="main">
          <section className="box" aria-labelledby="wf-h">
            <h3 id="wf-h">{t('Waterfall')}</h3>
            <Waterfall
              analyser={capture?.analyser ?? null}
              data={staticWf}
              markers={liveMarkers}
              selected={selected}
              clockOffsetMs={settings.clockOffsetMs}
              txFreq={settings.txFreq}
              emptyText={t('Start listening or pick a sample to see the signals.')}
              onSelect={setSelected}
            />
            <p className="hint">{t('0 to 3000 Hz. Boxes mark decoded signals (green CQ, yellow other, red involving you). Dashed line: encoder frequency.')}</p>
          </section>
          <section className="box" aria-labelledby="msg-h">
            <div className="row">
              <h3 id="msg-h">
                {t('Decoded messages')} ({shown.length})
              </h3>
              <span className="spacer" />
              <label className="check">
                <input type="checkbox" checked={settings.cqOnly} onChange={(e) => update({ cqOnly: e.target.checked })} /> {t('CQ only')}
              </label>
              <button className="small" disabled={entries.length === 0} onClick={() => download('ft8-decodes.txt', toDecodedText(shown))}>
                {t('Download')}
              </button>
              <button className="small danger" disabled={entries.length === 0} onClick={() => setEntries([])}>
                {t('Clear')}
              </button>
            </div>
            <MessageList entries={shown} gridBook={gridBook} settings={settings} selected={selected} onSelect={setSelected} t={t} />
          </section>

          <section className="box" aria-labelledby="map-h">
            <div className="row">
              <h3 id="map-h">
                {t('Map of grid squares')} ({points.length})
              </h3>
              <span className="spacer" />
              <label className="check">
                <input type="checkbox" checked={settings.mapFit} onChange={(e) => update({ mapFit: e.target.checked })} /> {t('Zoom to stations')}
              </label>
            </div>
            <WorldMap fit={settings.mapFit} points={points} myGrid={settings.myGrid} selectedCall={selectedCall} title={t('Map of decoded stations by Maidenhead grid square')} onSelect={selectCall} />
            <p className="hint">{t('Stations are placed at the centre of the grid square they sent. Lines are drawn from your grid on a flat map, not along the great circle.')}</p>
          </section>
        </main>

        <aside className="side set">
          <div className="panel">
            <section className="box" aria-labelledby="set-h">
              <h3 id="set-h">{t('Settings')}</h3>
              <div className="grid2">
                <div className="field">
                  <label htmlFor="call">{t('My callsign')}</label>
                  <input id="call" value={settings.myCall} maxLength={12} placeholder="K1ABC" spellCheck={false} onChange={(e) => update({ myCall: e.target.value.toUpperCase().trim() })} />
                </div>
                <div className="field">
                  <label htmlFor="grid">{t('My grid square')}</label>
                  <input id="grid" className={myGridOk ? '' : 'bad'} value={settings.myGrid} maxLength={6} placeholder="KO50" spellCheck={false} onChange={(e) => update({ myGrid: e.target.value.toUpperCase().trim() })} />
                </div>
              </div>
              <div className="grid2">
                <div className="field">
                  <label htmlFor="unit">{t('Distance')}</label>
                  <select id="unit" value={settings.unit} onChange={(e) => update({ unit: e.target.value as Settings['unit'] })}>
                    <option value="km">{t('km')}</option>
                    <option value="mi">{t('mi')}</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="off">{t('Clock correction (ms)')}</label>
                  <input id="off" type="number" step={50} min={-5000} max={5000} value={settings.clockOffsetMs} onChange={(e) => update({ clockOffsetMs: Math.max(-5000, Math.min(5000, +e.target.value || 0)) })} />
                </div>
              </div>
              <p className="hint">{t('FT8 slots start at :00, :15, :30 and :45 UTC. Keep your device clock synchronised (NTP); an error of up to about a second is tolerated.')}</p>
              <button className="small" onClick={() => setSettings({ ...DEFAULT_SETTINGS, lang: settings.lang, theme: settings.theme })}>
                {t('Reset settings')}
              </button>
            </section>

            <Transmit settings={settings} t={t} update={update} decode={decode} />
          </div>
        </aside>
      </div>
      <p className="hint foot">
        {t('Runs entirely in your browser: audio is never uploaded. Decoder is a TypeScript port of ft8_lib (MIT).')}{' '}
        <a href="https://github.com/hermes98761234/ft8-decoder-web">{t('Source on GitHub')}</a>
      </p>
    </div>
  )
}
