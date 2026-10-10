import { Fft } from './fft'
import { FT8_SLOT_TIME, FT8_SYMBOL_PERIOD } from './constants'

/** Magnitude waterfall of a whole FT8 slot (port of ft8_lib monitor.c / ftx_waterfall_t). */
export interface Waterfall {
  maxBlocks: number
  numBlocks: number
  numBins: number
  timeOsr: number
  freqOsr: number
  /** Elements per symbol block: timeOsr * freqOsr * numBins. */
  blockStride: number
  /** Unsigned bytes, 0.5 dB steps from -120 dB (value = 2 * dB + 240). */
  mag: Uint8Array
  minBin: number
  maxBin: number
  symbolPeriod: number
}

export interface WaterfallConfig {
  sampleRate: number
  fMin: number
  fMax: number
  timeOsr: number
  freqOsr: number
}

export const DEFAULT_WF: Omit<WaterfallConfig, 'sampleRate'> = { fMin: 100, fMax: 3100, timeOsr: 2, freqOsr: 2 }

function hann(i: number, n: number): number {
  const x = Math.sin((Math.PI * i) / n)
  return x * x
}

/** Computes the waterfall of `signal` (mono, `cfg.sampleRate` Hz, starting at the slot start). */
export function computeWaterfall(signal: Float32Array, cfg: WaterfallConfig): Waterfall {
  const symbolPeriod = FT8_SYMBOL_PERIOD
  const blockSize = Math.floor(cfg.sampleRate * symbolPeriod)
  const subblockSize = Math.floor(blockSize / cfg.timeOsr)
  const nfft = blockSize * cfg.freqOsr
  const fftNorm = 2 / nfft
  const window = new Float64Array(nfft)
  for (let i = 0; i < nfft; i++) window[i] = fftNorm * hann(i, nfft)
  const lastFrame = new Float64Array(nfft)
  const fft = new Fft(nfft)

  const maxBlocks = Math.floor(FT8_SLOT_TIME / symbolPeriod)
  const minBin = Math.floor(cfg.fMin * symbolPeriod)
  const maxBin = Math.floor(cfg.fMax * symbolPeriod) + 1
  const numBins = maxBin - minBin
  const blockStride = cfg.timeOsr * cfg.freqOsr * numBins
  const mag = new Uint8Array(maxBlocks * blockStride)

  const re = new Float64Array(nfft)
  const im = new Float64Array(nfft)
  const outRe = new Float64Array(nfft)
  const outIm = new Float64Array(nfft)

  let numBlocks = 0
  let offset = 0
  for (let start = 0; start + blockSize <= signal.length && numBlocks < maxBlocks; start += blockSize) {
    let framePos = start
    for (let timeSub = 0; timeSub < cfg.timeOsr; timeSub++) {
      lastFrame.copyWithin(0, subblockSize)
      for (let pos = nfft - subblockSize; pos < nfft; pos++) lastFrame[pos] = signal[framePos++]
      for (let pos = 0; pos < nfft; pos++) {
        re[pos] = window[pos] * lastFrame[pos]
        im[pos] = 0
      }
      fft.transform(re, im, outRe, outIm)
      for (let freqSub = 0; freqSub < cfg.freqOsr; freqSub++) {
        for (let bin = minBin; bin < maxBin; bin++) {
          const src = bin * cfg.freqOsr + freqSub
          const mag2 = outRe[src] * outRe[src] + outIm[src] * outIm[src]
          const db = 10 * Math.log10(1e-12 + mag2)
          const scaled = Math.trunc(2 * db + 240)
          mag[offset++] = scaled < 0 ? 0 : scaled > 255 ? 255 : scaled
        }
      }
    }
    numBlocks++
  }
  return { maxBlocks, numBlocks, numBins, timeOsr: cfg.timeOsr, freqOsr: cfg.freqOsr, blockStride, mag, minBin, maxBin, symbolPeriod }
}
