import { describe, expect, it } from 'vitest'
import { Fft } from './fft'

function naive(re: number[], im: number[]) {
  const n = re.length
  const or = new Array<number>(n).fill(0)
  const oi = new Array<number>(n).fill(0)
  for (let k = 0; k < n; k++) {
    for (let j = 0; j < n; j++) {
      const a = (-2 * Math.PI * j * k) / n
      or[k] += re[j] * Math.cos(a) - im[j] * Math.sin(a)
      oi[k] += re[j] * Math.sin(a) + im[j] * Math.cos(a)
    }
  }
  return { or, oi }
}

describe('Fft', () => {
  for (const n of [1, 2, 8, 15, 60, 77, 120, 384]) {
    it(`matches a direct DFT for n = ${n}`, () => {
      const re = Array.from({ length: n }, (_, i) => Math.sin(i * 1.3) + 0.2 * i)
      const im = Array.from({ length: n }, (_, i) => Math.cos(i * 0.7))
      const f = new Fft(n)
      const outRe = new Float64Array(n)
      const outIm = new Float64Array(n)
      f.transform(Float64Array.from(re), Float64Array.from(im), outRe, outIm)
      const ref = naive(re, im)
      for (let k = 0; k < n; k++) {
        expect(outRe[k]).toBeCloseTo(ref.or[k], 6)
        expect(outIm[k]).toBeCloseTo(ref.oi[k], 6)
      }
    })
  }

  it('puts a pure tone of the FT8 analysis size into the right bin', () => {
    const n = 3840
    const re = new Float64Array(n)
    const im = new Float64Array(n)
    for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * 500 * i) / n)
    const or = new Float64Array(n)
    const oi = new Float64Array(n)
    new Fft(n).transform(re, im, or, oi)
    expect(Math.hypot(or[500], oi[500])).toBeCloseTo(n / 2, 3)
    expect(Math.hypot(or[501], oi[501])).toBeLessThan(1e-6)
  })
})
