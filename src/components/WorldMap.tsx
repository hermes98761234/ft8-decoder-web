import { useEffect, useRef, useState } from 'react'
import { gridToLatLon } from '../lib/grid'
import { decodeLand, type Ring } from '../lib/topo'

export interface MapPoint {
  call: string
  grid: string
  snr?: number
  kind: 'cq' | 'other'
}

interface Props {
  /** Zoom to the stations (true) or show the whole world. */
  fit: boolean
  points: MapPoint[]
  myGrid: string
  selectedCall: string | null
  title: string
  onSelect: (call: string) => void
}

let landCache: Ring[] | null = null
async function loadLand(): Promise<Ring[]> {
  if (!landCache) {
    const mod = await import('world-atlas/land-110m.json')
    landCache = decodeLand(mod.default as never)
  }
  return landCache
}

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

/** Equirectangular world map with the Maidenhead field grid and decoded stations. */
export default function WorldMap({ fit, points, myGrid, selectedCall, title, onSelect }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [land, setLand] = useState<Ring[]>([])
  const hit = useRef<{ call: string; x: number; y: number }[]>([])

  useEffect(() => {
    let alive = true
    loadLand().then((l) => alive && setLand(l)).catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const canvas = ref.current!
    const draw = () => {
      const dpr = window.devicePixelRatio || 1
      const r = canvas.getBoundingClientRect()
      const w = Math.max(1, Math.round(r.width * dpr))
      const h = Math.max(1, Math.round(r.height * dpr))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      const g = canvas.getContext('2d')!
      // View window in degrees: the whole world, or the stations plus a margin.
      const me = gridToLatLon(myGrid)
      let lon0 = -180
      let lon1 = 180
      let lat0 = -90
      let lat1 = 90
      const pts = points.map((p) => gridToLatLon(p.grid)).filter((p): p is NonNullable<typeof p> => p !== null)
      if (me) pts.push(me)
      if (fit && pts.length > 0) {
        const lons = pts.map((p) => p.lon)
        const lats = pts.map((p) => p.lat)
        let spanLon = Math.max(60, (Math.max(...lons) - Math.min(...lons)) * 1.3)
        let spanLat = Math.max(30, (Math.max(...lats) - Math.min(...lats)) * 1.3)
        // keep the canvas aspect ratio
        const aspect = w / h
        if (spanLon / spanLat < aspect) spanLon = spanLat * aspect
        else spanLat = spanLon / aspect
        spanLon = Math.min(360, spanLon)
        spanLat = Math.min(180, spanLat)
        const cLon = (Math.max(...lons) + Math.min(...lons)) / 2
        const cLat = (Math.max(...lats) + Math.min(...lats)) / 2
        lon0 = Math.max(-180, Math.min(180 - spanLon, cLon - spanLon / 2))
        lon1 = lon0 + spanLon
        lat0 = Math.max(-90, Math.min(90 - spanLat, cLat - spanLat / 2))
        lat1 = lat0 + spanLat
      }
      const scale = Math.min(w / (lon1 - lon0), h / (lat1 - lat0))
      const ox = (w - (lon1 - lon0) * scale) / 2 - (lon0 + 180) * scale
      const oy = (h - (lat1 - lat0) * scale) / 2 - (90 - lat1) * scale
      const X = (lon: number) => ox + (lon + 180) * scale
      const Y = (lat: number) => oy + (90 - lat) * scale
      g.fillStyle = cssVar('--chart-bg') || '#0b0d11'
      g.fillRect(0, 0, w, h)
      g.fillStyle = cssVar('--panel2') || '#1f232c'
      g.fillRect(X(-180), Y(90), 360 * scale, 180 * scale)
      // Maidenhead fields (20 x 10 degrees), and squares (2 x 1) when zoomed in enough
      g.lineWidth = dpr
      const lines = (dLon: number, dLat: number) => {
        g.beginPath()
        for (let lon = -180; lon <= 180; lon += dLon) {
          g.moveTo(X(lon), Y(90))
          g.lineTo(X(lon), Y(-90))
        }
        for (let lat = -90; lat <= 90; lat += dLat) {
          g.moveTo(X(-180), Y(lat))
          g.lineTo(X(180), Y(lat))
        }
        g.stroke()
      }
      g.strokeStyle = cssVar('--grid') || '#333'
      if (scale >= 8 * dpr) {
        g.globalAlpha = 0.5
        lines(2, 1)
        g.globalAlpha = 1
      }
      g.strokeStyle = cssVar('--grid-strong') || '#555'
      lines(20, 10)
      // land
      g.fillStyle = cssVar('--land') || '#3a414e'
      g.beginPath()
      for (const ring of land) {
        ring.forEach(([lon, lat], i) => (i === 0 ? g.moveTo(X(lon), Y(lat)) : g.lineTo(X(lon), Y(lat))))
        g.closePath()
      }
      g.fill()
      g.strokeStyle = cssVar('--grid-strong') || '#555'
      g.lineWidth = 0.6 * dpr
      g.stroke()
      // field letters
      g.fillStyle = cssVar('--chart-fg') || '#aaa'
      g.globalAlpha = 0.5
      g.font = `${Math.round(Math.min(18, Math.max(9, scale * 2.5 / dpr)) * dpr)}px system-ui, sans-serif`
      g.textBaseline = 'middle'
      g.textAlign = 'center'
      for (let i = 0; i < 18; i++) {
        for (let j = 0; j < 18; j++) {
          g.fillText(String.fromCharCode(65 + i, 65 + j), X(-180 + i * 20 + 10), Y(-90 + j * 10 + 5))
        }
      }
      g.globalAlpha = 1
      // stations
      hit.current = []
      const font = Math.round(11 * dpr)
      g.font = `${font}px system-ui, sans-serif`
      g.textAlign = 'left'
      const used: [number, number, number, number][] = []
      for (const p of points) {
        const ll = gridToLatLon(p.grid)
        if (!ll) continue
        const x = X(ll.lon)
        const y = Y(ll.lat)
        const sel = p.call === selectedCall
        if (me) {
          g.strokeStyle = sel ? '#f87171' : 'rgba(96,165,250,0.35)'
          g.lineWidth = (sel ? 2 : 1) * dpr
          g.beginPath()
          // great-circle approximated by a straight line in plate carree
          g.moveTo(X(me.lon), Y(me.lat))
          g.lineTo(x, y)
          g.stroke()
        }
        // 2 x 1 degree locator square
        const sq = gridToLatLon(p.grid.slice(0, 4))!
        g.fillStyle = p.kind === 'cq' ? 'rgba(74,222,128,0.55)' : 'rgba(251,191,36,0.55)'
        g.fillRect(X(sq.lon - 1), Y(sq.lat + 0.5), Math.max(3 * dpr, 2 * scale), Math.max(3 * dpr, 1 * scale))
        g.fillStyle = sel ? '#f87171' : p.kind === 'cq' ? '#4ade80' : '#fbbf24'
        g.beginPath()
        g.arc(x, y, (sel ? 5 : 3.5) * dpr, 0, 2 * Math.PI)
        g.fill()
        const tw = g.measureText(p.call).width
        let lx = x + 6 * dpr
        if (lx + tw > w) lx = x - tw - 6 * dpr
        const box: [number, number, number, number] = [lx, y - font / 2, tw, font]
        const clash = used.some((u) => box[0] < u[0] + u[2] && box[0] + box[2] > u[0] && box[1] < u[1] + u[3] && box[1] + box[3] > u[1])
        if (!clash || sel) {
          used.push(box)
          g.fillStyle = cssVar('--fg') || '#eee'
          g.fillText(p.call, lx, y)
        }
        hit.current.push({ call: p.call, x: x / dpr, y: y / dpr })
      }
      if (me) {
        const x = X(me.lon)
        const y = Y(me.lat)
        g.fillStyle = '#60a5fa'
        g.strokeStyle = '#fff'
        g.lineWidth = 1.5 * dpr
        g.beginPath()
        for (let i = 0; i < 10; i++) {
          const rr = (i % 2 ? 3 : 7) * dpr
          const a = (i * Math.PI) / 5 - Math.PI / 2
          g.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a))
        }
        g.closePath()
        g.fill()
        g.stroke()
      }
    }
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(canvas)
    const mo = new MutationObserver(draw)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', draw)
    return () => {
      ro.disconnect()
      mo.disconnect()
      mq.removeEventListener('change', draw)
    }
  }, [land, points, myGrid, selectedCall, fit])

  const click = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    let best: string | null = null
    let bd = 14 * 14
    for (const p of hit.current) {
      const d = (p.x - x) ** 2 + (p.y - y) ** 2
      if (d < bd) {
        bd = d
        best = p.call
      }
    }
    if (best) onSelect(best)
  }

  return <canvas ref={ref} className="map-canvas" onClick={click} role="img" aria-label={title} />
}
