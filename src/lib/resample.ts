import { SAMPLE_RATE } from './constants'

/** Windowed-sinc resampler to 12 kHz (anti-aliased when decimating). */
export function resample(input: Float32Array, fromRate: number, toRate = SAMPLE_RATE): Float32Array {
  if (fromRate === toRate) return input
  const ratio = fromRate / toRate
  const outLen = Math.floor(input.length / ratio)
  const out = new Float32Array(outLen)
  const cutoff = Math.min(1, toRate / fromRate) * 0.94 // relative to input Nyquist
  const half = Math.ceil(10 / cutoff) // taps each side (in input samples)
  for (let n = 0; n < outLen; n++) {
    const center = n * ratio
    const i0 = Math.floor(center)
    let acc = 0
    let wsum = 0
    for (let i = i0 - half + 1; i <= i0 + half; i++) {
      if (i < 0 || i >= input.length) continue
      const x = i - center
      const arg = Math.PI * x * cutoff
      const sinc = Math.abs(x) < 1e-9 ? cutoff : Math.sin(arg) / (Math.PI * x)
      const w = 0.42 + 0.5 * Math.cos((Math.PI * x) / half) + 0.08 * Math.cos((2 * Math.PI * x) / half)
      const h = sinc * w
      acc += input[i] * h
      wsum += h
    }
    out[n] = wsum !== 0 ? acc / wsum : 0
  }
  return out
}
