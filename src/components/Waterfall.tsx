import { useEffect, useRef } from 'react'
import { LUT } from './colormap'
import type { SlotResult } from '../lib/slot'
import { FT8_SLOT_TIME, FT8_TX_TIME } from '../lib/constants'
import { utcClock } from '../lib/clock'

export const F_MAX = 3000
const W = 1000
const H = 360
/** Seconds per history row while listening. */
const ROW_SEC = 0.08

export interface Marker {
  id: string
  freq: number
  /** Start of the signal: epoch seconds (live) or seconds into the slot (static). */
  start: number
  label: string
  kind: 'cq' | 'me' | 'other'
}

export interface StaticWaterfall extends Pick<SlotResult, 'rows' | 'numRows' | 'numBins' | 'rowSeconds' | 'fMin' | 'binHz'> {
  slotStart: number
}

interface Props {
  analyser: AnalyserNode | null
  data: StaticWaterfall | null
  markers: Marker[]
  selected: string | null
  clockOffsetMs: number
  txFreq: number
  emptyText: string
  onSelect: (id: string) => void
}

const COLORS = { cq: '#4ade80', me: '#f87171', other: '#fbbf24' }

function percentile(sorted: ArrayLike<number>, p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
}

/** Scrolling live spectrogram (from an AnalyserNode) or a rendered slot, with decode markers on top. */
export default function Waterfall({ analyser, data, markers, selected, clockOffsetMs, txFreq, emptyText, onSelect }: Props) {
  const view = useRef<HTMLCanvasElement>(null)
  const hist = useRef<HTMLCanvasElement | null>(null)
  const state = useRef({ bottom: 0, lastRow: 0, floor: -90, has: false })
  const props = useRef({ markers, selected, clockOffsetMs, txFreq, data, live: false })
  const rects = useRef<{ id: string; x: number; y: number; w: number; h: number }[]>([])
  const redraw = useRef<() => void>(() => {})
  useEffect(() => {
    props.current = { markers, selected, clockOffsetMs, txFreq, data, live: analyser !== null }
  })

  useEffect(() => {
    if (!hist.current) {
      const c = document.createElement('canvas')
      c.width = W
      c.height = H
      hist.current = c
      const g = c.getContext('2d')!
      g.fillStyle = '#060718'
      g.fillRect(0, 0, W, H)
    }
    const canvas = view.current!
    const draw = () => {
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      const dw = Math.max(1, Math.round(rect.width * dpr))
      const dh = Math.max(1, Math.round(rect.height * dpr))
      if (canvas.width !== dw || canvas.height !== dh) {
        canvas.width = dw
        canvas.height = dh
      }
      const g = canvas.getContext('2d')!
      g.imageSmoothingEnabled = true
      g.drawImage(hist.current!, 0, 0, W, H, 0, 0, dw, dh)
      const p = props.current
      const sx = dw / F_MAX
      const font = Math.round(11 * dpr)
      g.font = `${font}px system-ui, sans-serif`
      g.textBaseline = 'top'
      // time grid
      const tPerPx = p.live ? ROW_SEC : FT8_SLOT_TIME / H
      const yOf = (t: number, bottom: number) => ((H - 1 - (bottom - t) / tPerPx) / H) * dh
      g.lineWidth = Math.max(1, dpr)
      if (p.live) {
        const bottom = state.current.bottom
        const first = Math.ceil((bottom - (H * ROW_SEC)) / FT8_SLOT_TIME) * FT8_SLOT_TIME
        for (let t = first; t <= bottom; t += FT8_SLOT_TIME) {
          const y = yOf(t, bottom)
          g.strokeStyle = 'rgba(255,255,255,0.55)'
          g.beginPath()
          g.moveTo(0, y)
          g.lineTo(dw, y)
          g.stroke()
          g.fillStyle = 'rgba(255,255,255,0.85)'
          g.fillText(utcClock(t * 1000), 4 * dpr, y + 2 * dpr)
        }
      } else if (p.data) {
        g.fillStyle = 'rgba(255,255,255,0.85)'
        g.fillText(p.data.slotStart ? utcClock(p.data.slotStart) + ' UTC' : '', 4 * dpr, 2 * dpr)
      }
      // frequency axis
      g.fillStyle = 'rgba(255,255,255,0.85)'
      g.strokeStyle = 'rgba(255,255,255,0.25)'
      for (let f = 500; f < F_MAX; f += 500) {
        const x = f * sx
        g.beginPath()
        g.moveTo(x, 0)
        g.lineTo(x, dh)
        g.stroke()
        g.fillText(String(f), x + 3 * dpr, dh - font - 3 * dpr)
      }
      // Tx marker
      g.strokeStyle = 'rgba(248,113,113,0.9)'
      g.setLineDash([4 * dpr, 3 * dpr])
      g.beginPath()
      g.moveTo(p.txFreq * sx, 0)
      g.lineTo(p.txFreq * sx, dh)
      g.stroke()
      g.setLineDash([])
      // decode markers
      rects.current = []
      const bottom = state.current.bottom
      for (const m of p.markers) {
        const y0 = p.live ? yOf(m.start, bottom) : (m.start / FT8_SLOT_TIME) * dh
        const y1 = y0 + (FT8_TX_TIME / (p.live ? ROW_SEC : FT8_SLOT_TIME / H) / H) * dh
        if (y1 < 0 || y0 > dh) continue
        const x0 = m.freq * sx
        const w = 50 * sx
        const sel = m.id === p.selected
        g.strokeStyle = COLORS[m.kind]
        g.lineWidth = (sel ? 2.5 : 1.2) * dpr
        g.strokeRect(x0, y0, w, y1 - y0)
        const tw = g.measureText(m.label).width
        const lx = Math.min(x0, dw - tw - 4 * dpr)
        g.fillStyle = 'rgba(0,0,0,0.65)'
        g.fillRect(lx, y0 - font - 3 * dpr, tw + 4 * dpr, font + 3 * dpr)
        g.fillStyle = COLORS[m.kind]
        g.fillText(m.label, lx + 2 * dpr, y0 - font - 2 * dpr)
        rects.current.push({ id: m.id, x: x0 / dpr, y: y0 / dpr, w: w / dpr, h: (y1 - y0) / dpr })
      }
    }
    redraw.current = draw
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [])

  // Static slot: render the rows into the history canvas.
  useEffect(() => {
    if (analyser || !data || !hist.current) {
      if (!analyser && !data && hist.current) {
        const g = hist.current.getContext('2d')!
        g.fillStyle = '#060718'
        g.fillRect(0, 0, W, H)
      }
      redraw.current()
      return
    }
    const g = hist.current.getContext('2d')!
    const img = g.createImageData(W, H)
    const sorted = Float32Array.from(data.rows.length > 4096 ? data.rows.filter((_, i) => i % 7 === 0) : data.rows).sort()
    const lo = percentile(sorted, 0.25)
    const hi = lo + 80
    const rowsExact = FT8_SLOT_TIME / data.rowSeconds
    for (let y = 0; y < H; y++) {
      const row = Math.min(data.numRows - 1, Math.floor((y / H) * rowsExact))
      for (let x = 0; x < W; x++) {
        const f = (x / W) * F_MAX
        const bin = Math.round((f - data.fMin) / data.binHz)
        let v = 0
        if (bin >= 0 && bin < data.numBins && row < data.numRows) v = data.rows[row * data.numBins + bin]
        const idx = Math.max(0, Math.min(255, Math.round(((v - lo) / (hi - lo)) * 255)))
        const o = (y * W + x) * 4
        img.data[o] = LUT[idx * 4]
        img.data[o + 1] = LUT[idx * 4 + 1]
        img.data[o + 2] = LUT[idx * 4 + 2]
        img.data[o + 3] = 255
      }
    }
    g.putImageData(img, 0, 0)
    state.current.bottom = 0
    redraw.current()
  }, [data, analyser])

  // Live: pull a spectrum row from the analyser every ROW_SEC.
  useEffect(() => {
    if (!analyser || !hist.current) return
    const hg = hist.current.getContext('2d')!
    hg.fillStyle = '#060718'
    hg.fillRect(0, 0, W, H)
    const bins = new Float32Array(analyser.frequencyBinCount)
    const binHz = analyser.context.sampleRate / analyser.fftSize
    const lut = LUT
    let raf = 0
    const st = state.current
    st.lastRow = 0
    st.floor = -90
    const frame = () => {
      raf = requestAnimationFrame(frame)
      const now = (Date.now() + props.current.clockOffsetMs) / 1000
      if (st.lastRow === 0) st.lastRow = now
      let n = Math.floor((now - st.lastRow) / ROW_SEC)
      if (n >= 1) {
        n = Math.min(n, H)
        analyser.getFloatFrequencyData(bins)
        const row = new Float32Array(W)
        for (let x = 0; x < W; x++) {
          const f0 = (x / W) * F_MAX
          const f1 = ((x + 1) / W) * F_MAX
          const b0 = Math.floor(f0 / binHz)
          const b1 = Math.max(b0, Math.floor(f1 / binHz))
          let m = -200
          for (let b = b0; b <= b1; b++) if (bins[b] > m) m = bins[b]
          row[x] = m
        }
        const sorted = Float32Array.from(row).sort()
        const p30 = percentile(sorted, 0.3)
        if (Number.isFinite(p30)) st.floor += 0.1 * (Math.max(-130, p30) - st.floor)
        const img = hg.createImageData(W, n)
        for (let y = 0; y < n; y++) {
          for (let x = 0; x < W; x++) {
            const idx = Math.max(0, Math.min(255, Math.round(((row[x] - st.floor + 6) / 40) * 255)))
            const o = (y * W + x) * 4
            img.data[o] = lut[idx * 4]
            img.data[o + 1] = lut[idx * 4 + 1]
            img.data[o + 2] = lut[idx * 4 + 2]
            img.data[o + 3] = 255
          }
        }
        hg.drawImage(hist.current!, 0, -n)
        hg.putImageData(img, 0, H - n)
        st.lastRow += n * ROW_SEC
        st.bottom = st.lastRow
        st.has = true
      }
      redraw.current()
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [analyser])

  useEffect(() => redraw.current(), [markers, selected, txFreq])

  const click = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    for (let i = rects.current.length - 1; i >= 0; i--) {
      const m = rects.current[i]
      if (x >= m.x && x <= m.x + m.w && y >= m.y - 14 && y <= m.y + m.h) {
        onSelect(m.id)
        return
      }
    }
  }

  return (
    <div className="wf">
      <canvas ref={view} className="wf-canvas" onClick={click} role="img" aria-label="Waterfall" />
      {!analyser && !data && <div className="wf-empty">{emptyText}</div>}
    </div>
  )
}
