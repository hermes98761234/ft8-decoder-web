import { describe, expect, it } from 'vitest'
import { bearingDeg, distanceKm, gridToLatLon, latLonToGrid } from './grid'
import { msToNextSlot, slotParity, slotStart, utcClock, utcStamp } from './clock'
import { encodeWav, parseWav } from './wav'
import { resample } from './resample'
import { decodeLand } from './topo'
import { charn, nchar } from './text'
import land from 'world-atlas/land-110m.json'

describe('grid squares', () => {
  it('converts locators to the centre of the square', () => {
    expect(gridToLatLon('JN58')).toEqual({ lat: 48.5, lon: 11 })
    expect(gridToLatLon('FN31')).toEqual({ lat: 41.5, lon: -73 })
    expect(gridToLatLon('KO50')!.lon).toBe(31)
    const six = gridToLatLon('JN58td')!
    expect(six.lon).toBeCloseTo(11.625, 3)
    expect(six.lat).toBeCloseTo(48.1458, 3)
    expect(gridToLatLon('ZZ99')).toBeNull()
    expect(gridToLatLon('RR73')).not.toBeNull()
    expect(gridToLatLon('hello')).toBeNull()
  })

  it('round-trips positions', () => {
    expect(latLonToGrid({ lat: 48.5, lon: 11 })).toBe('JN58')
    expect(latLonToGrid({ lat: 41.5, lon: -73 })).toBe('FN31')
    expect(latLonToGrid({ lat: -90, lon: -180 })).toBe('AA00')
  })

  it('computes great-circle distance and bearing', () => {
    // London to New York is about 5570 km
    const london = { lat: 51.5074, lon: -0.1278 }
    const nyc = { lat: 40.7128, lon: -74.006 }
    expect(distanceKm(london, nyc)).toBeGreaterThan(5540)
    expect(distanceKm(london, nyc)).toBeLessThan(5600)
    expect(bearingDeg(london, nyc)).toBeGreaterThan(285)
    expect(bearingDeg(london, nyc)).toBeLessThan(295)
    expect(distanceKm({ lat: 0, lon: 0 }, { lat: 0, lon: 180 })).toBeCloseTo(Math.PI * 6371, 0)
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: 10, lon: 0 })).toBeCloseTo(0, 5)
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: 10 })).toBeCloseTo(90, 5)
  })
})

describe('slot clock', () => {
  const t0 = Date.UTC(2026, 0, 1, 12, 30, 0)
  it('aligns to 15 second boundaries', () => {
    expect(slotStart(t0 + 14999)).toBe(t0)
    expect(slotStart(t0 + 15000)).toBe(t0 + 15000)
    expect(msToNextSlot(t0 + 1000)).toBe(14000)
    expect(msToNextSlot(t0)).toBe(15000)
  })
  it('knows even and odd slots', () => {
    expect(slotParity(t0)).toBe('even')
    expect(slotParity(t0 + 15000)).toBe('odd')
    expect(slotParity(t0 + 30000)).toBe('even')
  })
  it('formats UTC time', () => {
    expect(utcStamp(t0 + 5000)).toBe('123005')
    expect(utcClock(t0 + 5000)).toBe('12:30:05')
  })
})

describe('WAV and resampling', () => {
  it('round-trips 16-bit mono audio', () => {
    const x = Float32Array.from({ length: 1000 }, (_, i) => Math.sin(i / 7) * 0.5)
    const w = parseWav(encodeWav(x, 12000))
    expect(w.sampleRate).toBe(12000)
    expect(w.samples.length).toBe(1000)
    for (let i = 0; i < 1000; i += 37) expect(w.samples[i]).toBeCloseTo(x[i], 3)
  })
  it('rejects non-WAV data', () => {
    expect(() => parseWav(new Uint8Array(100))).toThrow()
  })
  it('averages stereo to mono', () => {
    const bytes = encodeWav(new Float32Array(4), 8000)
    const view = new DataView(bytes.buffer)
    view.setUint16(22, 2, true) // channels
    view.setUint16(32, 4, true) // block align
    view.setUint32(40, 16, true)
    const stereo = new Uint8Array(44 + 16)
    stereo.set(bytes.subarray(0, 44))
    const sv = new DataView(stereo.buffer)
    sv.setUint32(40, 16, true)
    for (let i = 0; i < 4; i++) {
      sv.setInt16(44 + i * 4, 16384, true)
      sv.setInt16(46 + i * 4, -16384, true)
    }
    const w = parseWav(stereo)
    expect(w.samples.length).toBe(4)
    expect(Math.abs(w.samples[0])).toBeLessThan(1e-6)
  })
  it('resamples a tone without changing its frequency or amplitude', () => {
    const sr = 48000
    const x = Float32Array.from({ length: sr }, (_, i) => Math.sin((2 * Math.PI * 1000 * i) / sr))
    const y = resample(x, sr, 12000)
    expect(y.length).toBe(12000)
    let peak = 0
    for (let i = 2000; i < 10000; i++) peak = Math.max(peak, Math.abs(y[i]))
    expect(peak).toBeGreaterThan(0.97)
    expect(peak).toBeLessThan(1.03)
    // zero crossings: 1000 Hz -> 2000 per second
    let zc = 0
    for (let i = 2001; i < 10000; i++) if (y[i - 1] < 0 !== y[i] < 0) zc++
    expect(Math.abs(zc - 1333)).toBeLessThan(4)
  })
  it('suppresses content above the new Nyquist frequency', () => {
    const sr = 48000
    const x = Float32Array.from({ length: sr }, (_, i) => Math.sin((2 * Math.PI * 9000 * i) / sr))
    const y = resample(x, sr, 12000)
    let peak = 0
    for (let i = 2000; i < 10000; i++) peak = Math.max(peak, Math.abs(y[i]))
    expect(peak).toBeLessThan(0.05)
  })
})

describe('text tables', () => {
  it('maps characters both ways', () => {
    for (const table of ['full', 'alnumSpaceSlash', 'alnumSpace', 'lettersSpace', 'alnum', 'numeric'] as const) {
      for (let i = 0; i < 80; i++) {
        const c = charn(i, table)
        if (c === '_') break
        expect(nchar(c, table)).toBe(i)
      }
    }
    expect(nchar('a', 'full')).toBe(-1)
    expect(charn(0, 'full')).toBe(' ')
    expect(charn(37, 'full')).toBe('+')
  })
})

describe('land outline', () => {
  it('decodes world-atlas TopoJSON into closed lon/lat rings', () => {
    const rings = decodeLand(land as never)
    expect(rings.length).toBeGreaterThan(50)
    for (const ring of rings.slice(0, 20)) {
      for (const [lon, lat] of ring) {
        expect(lon).toBeGreaterThanOrEqual(-180.01)
        expect(lon).toBeLessThanOrEqual(180.01)
        expect(lat).toBeGreaterThanOrEqual(-90.01)
        expect(lat).toBeLessThanOrEqual(90.01)
      }
    }
  })
})
