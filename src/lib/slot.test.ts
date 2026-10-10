import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeSlot } from './slot'
import { CallsignHashes, packMessage } from './message'
import { parseWav } from './wav'
import { generateSlot, ft8Tones, makeRng, synthGfsk } from './encode'
import { resample } from './resample'
import { SAMPLE_RATE } from './constants'

const sample = (name: string) => parseWav(new Uint8Array(readFileSync(new URL(`../../public/samples/${name}`, import.meta.url))))
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('')

// What WSJT-X decoded from the same recordings (ft8_lib test/wav/*.txt): SNR, DT, frequency, text.
const REFERENCE: Record<string, { snr: number; dt: number; freq: number; text: string }[]> = {
  '191111_110130.wav': [
    { snr: -6, dt: 0.7, freq: 683, text: 'CQ TA6CQ KN70' },
    { snr: -16, dt: 1.0, freq: 989, text: 'OH3NIV ZS6S -03' },
    { snr: -6, dt: 0.9, freq: 1291, text: 'CQ R7IW LN35' },
    { snr: -4, dt: 0.9, freq: 2096, text: 'CQ DX R6WA LN32' },
  ],
  '191111_110200.wav': [
    { snr: -4, dt: 0.7, freq: 683, text: 'CQ TA6CQ KN70' },
    { snr: -17, dt: 0.6, freq: 1031, text: 'CQ LZ1JZ KN22' },
    { snr: -12, dt: 0.9, freq: 1292, text: 'CQ R7IW LN35' },
    { snr: -7, dt: 0.9, freq: 2097, text: 'CQ DX R6WA LN32' },
  ],
}

describe('real off-air recordings', () => {
  for (const [file, expected] of Object.entries(REFERENCE)) {
    it(`decodes the WSJT-X messages from ${file}`, () => {
      const w = sample(file)
      expect(w.sampleRate).toBe(12000)
      const r = decodeSlot(w.samples, new CallsignHashes())
      for (const e of expected) {
        const d = r.decodes.find((x) => x.text === e.text)
        expect(d, e.text).toBeDefined()
        expect(Math.abs(d!.freq - e.freq), `${e.text} frequency`).toBeLessThanOrEqual(4)
        expect(Math.abs(d!.dt - e.dt), `${e.text} dt`).toBeLessThanOrEqual(0.4)
        expect(Math.abs(d!.snr - e.snr), `${e.text} snr`).toBeLessThanOrEqual(6)
      }
      // No wrong messages: everything decoded is a message WSJT-X also reported.
      for (const d of r.decodes) expect(expected.some((e) => e.text === d.text), d.text).toBe(true)
      expect(r.decodes.length).toBeGreaterThanOrEqual(3)
    })

    it(`re-packing the decoded text of ${file} gives the transmitted 77 bits`, () => {
      const r = decodeSlot(sample(file).samples, new CallsignHashes())
      for (const d of r.decodes) {
        const p = packMessage(d.text)
        expect(p.ok).toBe(true)
        if (p.ok) expect(hex(p.payload)).toBe(d.payloadHex)
      }
    })
  }

  it('also works after resampling from 48 kHz and 44.1 kHz', () => {
    const w = sample('191111_110130.wav')
    for (const rate of [48000, 44100]) {
      const up = resample(w.samples, 12000, rate)
      const down = resample(up, rate, SAMPLE_RATE)
      const r = decodeSlot(down, new CallsignHashes())
      expect(r.decodes.map((d) => d.text)).toContain('CQ R7IW LN35')
      expect(r.decodes.length).toBeGreaterThanOrEqual(3)
    }
  })
})

describe('synthetic signals', () => {
  const messages: [string, number][] = [
    ['CQ K1ABC FN42', 0],
    ['K1ABC W9XYZ -11', -5],
    ['W9XYZ K1ABC R-09', -8],
    ['CQ DX PA3XYZ JO22', -11],
    ['K1ABC UA3ABC RR73', -13],
    ['TNX BOB 73 GL', -15],
    ['CQ SOTA N0YPR/R DM42', -16],
  ]

  it('decodes seven overlapping-in-time signals across the band and estimates SNR', () => {
    const sig = messages.map(([m, snr], i) => {
      const p = packMessage(m)
      if (!p.ok) throw new Error(m)
      return { payload: p.payload, freq: 420 + i * 340, snr, start: 0.4 + i * 0.06 }
    })
    const r = decodeSlot(generateSlot(sig, 11), new CallsignHashes())
    for (const [i, [m, snr]] of messages.entries()) {
      const d = r.decodes.find((x) => x.text === m)
      expect(d, m).toBeDefined()
      expect(Math.abs(d!.freq - sig[i].freq)).toBeLessThanOrEqual(3.2)
      expect(Math.abs(d!.dt - (sig[i].start - 0.5))).toBeLessThanOrEqual(0.25)
      expect(Math.abs(d!.snr - snr), `${m} snr`).toBeLessThanOrEqual(3)
    }
  })

  it('decodes two signals in adjacent frequency slots (50 Hz apart)', () => {
    const a = packMessage('CQ K1ABC FN42')
    const b = packMessage('CQ W9XYZ EN52')
    if (!a.ok || !b.ok) throw new Error('pack')
    const r = decodeSlot(
      generateSlot([
        { payload: a.payload, freq: 1000, snr: -6, start: 0.5 },
        { payload: b.payload, freq: 1056, snr: -8, start: 0.6 },
      ], 3),
      new CallsignHashes(),
    )
    expect(r.decodes.map((d) => d.text).sort()).toEqual(['CQ K1ABC FN42', 'CQ W9XYZ EN52'])
  })

  it('does not decode noise (CRC guards against false positives)', () => {
    for (const seed of [1, 2, 3]) {
      const r = decodeSlot(generateSlot([], seed), new CallsignHashes())
      expect(r.decodes).toEqual([])
    }
  })

  it('does not decode a signal buried far below the threshold', () => {
    const p = packMessage('CQ K1ABC FN42')
    if (!p.ok) throw new Error('pack')
    const r = decodeSlot(generateSlot([{ payload: p.payload, freq: 1500, snr: -30, start: 0.5 }], 4), new CallsignHashes())
    expect(r.decodes).toEqual([])
  })

  it('tolerates a start time error of one second in either direction', () => {
    const p = packMessage('CQ K1ABC FN42')
    if (!p.ok) throw new Error('pack')
    for (const start of [-0.4, 0.1, 1.5, 2.2]) {
      const r = decodeSlot(generateSlot([{ payload: p.payload, freq: 1500, snr: -5, start }], 5), new CallsignHashes())
      expect(r.decodes.map((d) => d.text), `start ${start}`).toEqual(['CQ K1ABC FN42'])
    }
  })

  it('resolves a hashed callsign once the full callsign was heard in an earlier slot', () => {
    const hashes = new CallsignHashes()
    const first = packMessage('CQ PJ4/K1ABC', hashes)
    const reply = packMessage('PJ4/K1ABC W9XYZ RR73', new CallsignHashes())
    if (!first.ok || !reply.ok) throw new Error('pack')
    const r1 = decodeSlot(generateSlot([{ payload: first.payload, freq: 1200, snr: -4, start: 0.5 }], 8), hashes)
    expect(r1.decodes[0].text).toBe('CQ PJ4/K1ABC')
    const r2 = decodeSlot(generateSlot([{ payload: reply.payload, freq: 1200, snr: -4, start: 0.5 }], 9), hashes)
    expect(r2.decodes[0].text).toBe('<PJ4/K1ABC> W9XYZ RR73')
    const r3 = decodeSlot(generateSlot([{ payload: reply.payload, freq: 1200, snr: -4, start: 0.5 }], 9), new CallsignHashes())
    expect(r3.decodes[0].text).toBe('<...> W9XYZ RR73')
  })
})

describe('encoder', () => {
  it('produces 79 tones with the Costas arrays in the right places', () => {
    const p = packMessage('CQ K1ABC FN42')
    if (!p.ok) throw new Error('pack')
    const tones = ft8Tones(p.payload)
    expect(tones.length).toBe(79)
    const costas = [3, 1, 4, 0, 6, 5, 2]
    for (const base of [0, 36, 72]) expect([...tones.slice(base, base + 7)]).toEqual(costas)
    expect(Math.max(...tones)).toBeLessThanOrEqual(7)
  })

  it('synthesizes a constant-envelope signal at the requested frequency', () => {
    const wave = synthGfsk([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 1000)
    expect(wave.length).toBe(12 * 1920)
    // Goertzel at 1000 Hz over the middle part vs 1300 Hz
    const power = (f: number) => {
      let re = 0
      let im = 0
      for (let i = 4000; i < 18000; i++) {
        re += wave[i] * Math.cos((2 * Math.PI * f * i) / 12000)
        im += wave[i] * Math.sin((2 * Math.PI * f * i) / 12000)
      }
      return re * re + im * im
    }
    expect(power(1000)).toBeGreaterThan(1000 * power(1300))
    expect(Math.max(...wave.slice(5000, 18000))).toBeCloseTo(1, 2)
  })

  it('tone n is n x 6.25 Hz above tone 0', () => {
    const f = (tone: number) => {
      const wave = synthGfsk(new Array<number>(12).fill(tone), 1000)
      let best = 0
      let bestF = 0
      for (let hz = 990; hz <= 1060; hz += 0.5) {
        let re = 0
        let im = 0
        for (let i = 4000; i < 18000; i++) {
          re += wave[i] * Math.cos((2 * Math.PI * hz * i) / 12000)
          im += wave[i] * Math.sin((2 * Math.PI * hz * i) / 12000)
        }
        if (re * re + im * im > best) {
          best = re * re + im * im
          bestF = hz
        }
      }
      return bestF
    }
    expect(f(0)).toBeCloseTo(1000, 0)
    expect(f(4)).toBeCloseTo(1025, 0)
    expect(f(7)).toBeCloseTo(1043.75, 0)
  })

  it('generateSlot noise is deterministic and Gaussian-ish with the requested sigma', () => {
    const a = generateSlot([], 1, 12000, 0.1)
    const b = generateSlot([], 1, 12000, 0.1)
    expect(a).toEqual(b)
    let s2 = 0
    for (const v of a) s2 += v * v
    expect(Math.sqrt(s2 / a.length)).toBeCloseTo(0.1, 2)
    const rng = makeRng(1)
    expect(rng()).not.toBe(rng())
  })
})
