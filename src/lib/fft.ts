/** Mixed-radix complex FFT for any length (the FT8 analysis size is 3840 = 2^8 * 3 * 5). */
export class Fft {
  readonly n: number
  private factors: number[] = []
  private cos: Float64Array
  private sin: Float64Array
  private tmpRe: Float64Array
  private tmpIm: Float64Array

  constructor(n: number) {
    this.n = n
    let m = n
    for (const p of [4, 2, 3, 5]) {
      while (m % p === 0) {
        this.factors.push(p)
        m /= p
      }
    }
    for (let p = 7; m > 1; p += 2) {
      while (m % p === 0) {
        this.factors.push(p)
        m /= p
      }
    }
    this.cos = new Float64Array(n)
    this.sin = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n)
      this.sin[i] = -Math.sin((2 * Math.PI * i) / n)
    }
    const maxP = Math.max(1, ...this.factors)
    this.tmpRe = new Float64Array(maxP)
    this.tmpIm = new Float64Array(maxP)
  }

  /** Forward transform (e^{-i...}). Input and output arrays must not alias. */
  transform(inRe: Float64Array, inIm: Float64Array, outRe: Float64Array, outIm: Float64Array): void {
    this.rec(inRe, inIm, 0, 1, outRe, outIm, 0, this.n, 0)
  }

  private rec(
    inRe: Float64Array,
    inIm: Float64Array,
    inOff: number,
    inStride: number,
    outRe: Float64Array,
    outIm: Float64Array,
    outOff: number,
    n: number,
    fi: number,
  ): void {
    if (n === 1) {
      outRe[outOff] = inRe[inOff]
      outIm[outOff] = inIm[inOff]
      return
    }
    const p = this.factors[fi]
    const m = n / p
    for (let r = 0; r < p; r++) {
      this.rec(inRe, inIm, inOff + r * inStride, inStride * p, outRe, outIm, outOff + r * m, m, fi + 1)
    }
    const step = this.n / n // twiddle index step for W_n
    const { cos, sin, tmpRe, tmpIm } = this
    const N = this.n
    for (let k = 0; k < m; k++) {
      // Twiddle-multiply the p sub-results at position k.
      for (let r = 0; r < p; r++) {
        const idx = outOff + r * m + k
        const t = (r * k * step) % N
        const wr = cos[t]
        const wi = sin[t]
        tmpRe[r] = outRe[idx] * wr - outIm[idx] * wi
        tmpIm[r] = outRe[idx] * wi + outIm[idx] * wr
      }
      // p-point DFT across the sub-results.
      for (let q = 0; q < p; q++) {
        let sr = tmpRe[0]
        let si = tmpIm[0]
        for (let r = 1; r < p; r++) {
          const t = ((r * q) % p) * (N / p)
          const wr = cos[t]
          const wi = sin[t]
          sr += tmpRe[r] * wr - tmpIm[r] * wi
          si += tmpRe[r] * wi + tmpIm[r] * wr
        }
        outRe[outOff + q * m + k] = sr
        outIm[outOff + q * m + k] = si
      }
    }
  }
}
