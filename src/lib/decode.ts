import { computeCrc, extractCrc } from './crc'
import {
  COSTAS,
  FT8_LENGTH_SYNC,
  FT8_ND,
  FT8_NN,
  FT8_NUM_SYNC,
  FT8_SYNC_OFFSET,
  GRAY_MAP,
  LDPC_N,
} from './constants'
import { bpDecode } from './ldpc'
import { ft8Tones } from './encode'
import type { Waterfall } from './waterfall'

export interface Candidate {
  score: number
  timeOffset: number
  freqOffset: number
  timeSub: number
  freqSub: number
}

function candMagOffset(wf: Waterfall, c: Candidate): number {
  let offset = c.timeOffset
  offset = offset * wf.timeOsr + c.timeSub
  offset = offset * wf.freqOsr + c.freqSub
  offset = offset * wf.numBins + c.freqOffset
  return offset
}

function syncScore(wf: Waterfall, c: Candidate): number {
  let score = 0
  let numAverage = 0
  const base = candMagOffset(wf, c)
  const mag = wf.mag
  for (let m = 0; m < FT8_NUM_SYNC; m++) {
    for (let k = 0; k < FT8_LENGTH_SYNC; k++) {
      const block = FT8_SYNC_OFFSET * m + k
      const blockAbs = c.timeOffset + block
      if (blockAbs < 0) continue
      if (blockAbs >= wf.numBlocks) break
      const p8 = base + block * wf.blockStride
      const sm = COSTAS[k]
      if (sm > 0) {
        score += mag[p8 + sm] - mag[p8 + sm - 1]
        numAverage++
      }
      if (sm < 7) {
        score += mag[p8 + sm] - mag[p8 + sm + 1]
        numAverage++
      }
      if (k > 0 && blockAbs > 0) {
        score += mag[p8 + sm] - mag[p8 + sm - wf.blockStride]
        numAverage++
      }
      if (k + 1 < FT8_LENGTH_SYNC && blockAbs + 1 < wf.numBlocks) {
        score += mag[p8 + sm] - mag[p8 + sm + wf.blockStride]
        numAverage++
      }
    }
  }
  if (numAverage > 0) score = Math.trunc(score / numAverage)
  return score
}

function heapifyDown(heap: Candidate[], size: number): void {
  let current = 0
  for (;;) {
    const left = 2 * current + 1
    const right = left + 1
    let smallest = current
    if (left < size && heap[left].score < heap[smallest].score) smallest = left
    if (right < size && heap[right].score < heap[smallest].score) smallest = right
    if (smallest === current) break
    const tmp = heap[smallest]
    heap[smallest] = heap[current]
    heap[current] = tmp
    current = smallest
  }
}

function heapifyUp(heap: Candidate[], size: number): void {
  let current = size - 1
  while (current > 0) {
    const parent = (current - 1) >> 1
    if (!(heap[current].score < heap[parent].score)) break
    const tmp = heap[parent]
    heap[parent] = heap[current]
    heap[current] = tmp
    current = parent
  }
}

/** Finds the strongest Costas-sync candidates, best first (ft8_lib ftx_find_candidates). */
export function findCandidates(wf: Waterfall, numCandidates: number, minScore: number): Candidate[] {
  const heap: Candidate[] = []
  let size = 0
  for (let timeSub = 0; timeSub < wf.timeOsr; timeSub++) {
    for (let freqSub = 0; freqSub < wf.freqOsr; freqSub++) {
      for (let timeOffset = -10; timeOffset < 20; timeOffset++) {
        for (let freqOffset = 0; freqOffset + 7 < wf.numBins; freqOffset++) {
          const cand: Candidate = { score: 0, timeOffset, freqOffset, timeSub, freqSub }
          cand.score = syncScore(wf, cand)
          if (cand.score < minScore) continue
          if (size === numCandidates && cand.score > heap[0].score) {
            size--
            heap[0] = heap[size]
            heapifyDown(heap, size)
          }
          if (size < numCandidates) {
            heap[size] = cand
            size++
            heapifyUp(heap, size)
          }
        }
      }
    }
  }
  heap.length = size
  let unsorted = size
  while (unsorted > 1) {
    const tmp = heap[unsorted - 1]
    heap[unsorted - 1] = heap[0]
    heap[0] = tmp
    unsorted--
    heapifyDown(heap, unsorted)
  }
  return heap
}

const magDb = (v: number) => v * 0.5 - 120

function extractLikelihood(wf: Waterfall, c: Candidate): Float64Array {
  const log174 = new Float64Array(LDPC_N)
  const base = candMagOffset(wf, c)
  const s2 = new Float64Array(8)
  for (let k = 0; k < FT8_ND; k++) {
    const symIdx = k + (k < 29 ? 7 : 14)
    const bitIdx = 3 * k
    const block = c.timeOffset + symIdx
    if (block < 0 || block >= wf.numBlocks) continue // likelihoods stay 0
    const p = base + symIdx * wf.blockStride
    for (let j = 0; j < 8; j++) s2[j] = magDb(wf.mag[p + GRAY_MAP[j]])
    log174[bitIdx] = Math.max(s2[4], s2[5], s2[6], s2[7]) - Math.max(s2[0], s2[1], s2[2], s2[3])
    log174[bitIdx + 1] = Math.max(s2[2], s2[3], s2[6], s2[7]) - Math.max(s2[0], s2[1], s2[4], s2[5])
    log174[bitIdx + 2] = Math.max(s2[1], s2[3], s2[5], s2[7]) - Math.max(s2[0], s2[2], s2[4], s2[6])
  }
  return log174
}

function normalizeLogl(log174: Float64Array): void {
  let sum = 0
  let sum2 = 0
  for (let i = 0; i < LDPC_N; i++) {
    sum += log174[i]
    sum2 += log174[i] * log174[i]
  }
  const invN = 1 / LDPC_N
  const variance = (sum2 - sum * sum * invN) * invN
  if (!(variance > 0)) return
  const norm = Math.sqrt(24 / variance)
  for (let i = 0; i < LDPC_N; i++) log174[i] *= norm
}

export interface DecodedPayload {
  payload: Uint8Array
  crc: number
}

/** Soft-decision LDPC decode of one candidate; null when the parity or CRC check fails. */
export function decodeCandidate(wf: Waterfall, c: Candidate, maxIterations: number): DecodedPayload | null {
  const log174 = extractLikelihood(wf, c)
  normalizeLogl(log174)
  const { plain, errors } = bpDecode(log174, maxIterations)
  if (errors > 0) return null
  const a91 = new Uint8Array(12)
  for (let i = 0; i < 91; i++) if (plain[i]) a91[i >> 3] |= 0x80 >> (i & 7)
  const extracted = extractCrc(a91)
  a91[9] &= 0xf8
  a91[10] = 0
  const calculated = computeCrc(a91, 96 - 14)
  if (extracted !== calculated) return null
  return { payload: a91.slice(0, 10), crc: calculated }
}

/**
 * SNR in dB for a 2500 Hz reference bandwidth (WSJT-X convention). Signal power is the mean power at the
 * transmitted tones; noise is the median power of the bins just outside the 8-tone span.
 */
export function estimateSnr(wf: Waterfall, c: Candidate, payload: Uint8Array): number {
  const tones = ft8Tones(payload)
  const base = candMagOffset(wf, c)
  const lin = (v: number) => Math.pow(10, magDb(v) / 10)
  let sig = 0
  let nSig = 0
  const noise: number[] = []
  for (let k = 0; k < FT8_NN; k++) {
    const block = c.timeOffset + k
    if (block < 0 || block >= wf.numBlocks) continue
    const p = base + k * wf.blockStride
    sig += lin(wf.mag[p + tones[k]])
    nSig++
    for (const d of NOISE_BINS) {
      const bin = c.freqOffset + d
      if (bin >= 0 && bin < wf.numBins) noise.push(lin(wf.mag[p + d]))
    }
  }
  if (nSig === 0 || noise.length === 0) return -24
  noise.sort((a, b) => a - b)
  // Noise bin powers are exponentially distributed: median = mean * ln 2.
  const noiseMean = noise[noise.length >> 1] / Math.LN2
  const ratio = Math.max(sig / nSig / noiseMean - 1, 0.001)
  const snr = 10 * Math.log10(ratio) + SNR_OFFSET_DB
  return Math.max(-24, Math.min(40, Math.round(snr)))
}

/** Bin offsets (relative to tone 0) used for the noise floor, outside the 8-tone span. */
const NOISE_BINS = [-6, -5, -4, -3, 10, 11, 12, 13]

/** 10 log10(6.25 / 2500) plus a window/analysis correction found by simulation (see slot.test.ts). */
export const SNR_OFFSET_DB = -25.5
