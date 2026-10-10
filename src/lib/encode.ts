import { addCrc } from './crc'
import { COSTAS, FT8_NN, FT8_SYMBOL_PERIOD, GRAY_MAP, SAMPLE_RATE } from './constants'
import { encode174 } from './ldpc'

/** 77-bit payload -> 79 channel symbols (tones 0..7): Costas, 29 data, Costas, 29 data, Costas. */
export function ft8Tones(payload: Uint8Array): Uint8Array {
  const codeword = encode174(addCrc(payload))
  const tones = new Uint8Array(FT8_NN)
  const bit = (i: number) => (codeword[i >> 3] >> (7 - (i & 7))) & 1
  let bitPos = 0
  for (let i = 0; i < FT8_NN; i++) {
    if (i < 7) tones[i] = COSTAS[i]
    else if (i >= 36 && i < 43) tones[i] = COSTAS[i - 36]
    else if (i >= 72) tones[i] = COSTAS[i - 72]
    else {
      const bits3 = (bit(bitPos) << 2) | (bit(bitPos + 1) << 1) | bit(bitPos + 2)
      bitPos += 3
      tones[i] = GRAY_MAP[bits3]
    }
  }
  return tones
}

/** Error function (Abramowitz & Stegun 7.1.26, |error| < 1.5e-7). */
export function erf(x: number): number {
  const s = x < 0 ? -1 : 1
  x = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * x)
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return s * y
}

const GFSK_CONST_K = 5.336446 // pi * sqrt(2 / ln 2)

/**
 * Synthesizes the 79-symbol FT8 waveform with Gaussian-smoothed frequency shaping (BT = 2).
 * Returns unit-amplitude samples, length 79 * samplesPerSymbol.
 */
export function synthGfsk(symbols: ArrayLike<number>, f0: number, sampleRate = SAMPLE_RATE): Float32Array {
  const nSym = symbols.length
  const nSp = Math.floor(0.5 + sampleRate * FT8_SYMBOL_PERIOD)
  const nWave = nSym * nSp
  const dphiPeak = (2 * Math.PI) / nSp
  const dphi = new Float64Array(nWave + 2 * nSp).fill((2 * Math.PI * f0) / sampleRate)
  const pulse = new Float64Array(3 * nSp)
  for (let i = 0; i < 3 * nSp; i++) {
    const t = i / nSp - 1.5
    pulse[i] = (erf(GFSK_CONST_K * 2 * (t + 0.5)) - erf(GFSK_CONST_K * 2 * (t - 0.5))) / 2
  }
  for (let i = 0; i < nSym; i++) {
    const ib = i * nSp
    for (let j = 0; j < 3 * nSp; j++) dphi[j + ib] += dphiPeak * symbols[i] * pulse[j]
  }
  for (let j = 0; j < 2 * nSp; j++) {
    dphi[j] += dphiPeak * pulse[j + nSp] * symbols[0]
    dphi[j + nSym * nSp] += dphiPeak * pulse[j] * symbols[nSym - 1]
  }
  const signal = new Float32Array(nWave)
  let phi = 0
  for (let k = 0; k < nWave; k++) {
    signal[k] = Math.sin(phi)
    phi = (phi + dphi[k + nSp]) % (2 * Math.PI)
  }
  const nRamp = Math.floor(nSp / 8)
  for (let i = 0; i < nRamp; i++) {
    const env = (1 - Math.cos((2 * Math.PI * i) / (2 * nRamp))) / 2
    signal[i] *= env
    signal[nWave - 1 - i] *= env
  }
  return signal
}

/** Deterministic PRNG (mulberry32) for reproducible test signals and noise. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface SlotSignal {
  /** Already packed 77-bit payload. */
  payload: Uint8Array
  /** Audio frequency of tone 0, Hz. */
  freq: number
  /** SNR in dB in a 2500 Hz bandwidth. */
  snr: number
  /** Start time inside the slot, seconds (nominally 0.5). */
  start: number
}

/**
 * Builds a whole 15 s slot: the given signals mixed over white Gaussian noise whose level
 * defines the SNR (2500 Hz reference bandwidth, like WSJT-X). Deterministic for a given seed.
 */
export function generateSlot(signals: SlotSignal[], seed = 1, sampleRate = SAMPLE_RATE, noiseSigma = 0.1): Float32Array {
  const rng = makeRng(seed)
  const n = Math.round(15 * sampleRate)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i += 2) {
    const u1 = Math.max(rng(), 1e-12)
    const u2 = rng()
    const r = Math.sqrt(-2 * Math.log(u1)) * noiseSigma
    out[i] = r * Math.cos(2 * Math.PI * u2)
    if (i + 1 < n) out[i + 1] = r * Math.sin(2 * Math.PI * u2)
  }
  // Noise power per Hz = sigma^2 / (sampleRate / 2); in 2500 Hz: sigma^2 * 2500 / (sampleRate / 2).
  const noise2500 = (noiseSigma * noiseSigma * 2500) / (sampleRate / 2)
  for (const s of signals) {
    const amp = Math.sqrt(2 * noise2500 * Math.pow(10, s.snr / 10))
    const wave = synthGfsk(ft8Tones(s.payload), s.freq, sampleRate)
    const start = Math.round(s.start * sampleRate)
    for (let i = 0; i < wave.length && start + i < n; i++) if (start + i >= 0) out[start + i] += amp * wave[i]
  }
  return out
}
