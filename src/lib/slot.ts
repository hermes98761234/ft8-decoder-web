import { FT8_TX_START, SAMPLE_RATE } from './constants'
import { decodeCandidate, estimateSnr, findCandidates } from './decode'
import { CallsignHashes, unpackMessage, type Unpacked } from './message'
import { computeWaterfall, DEFAULT_WF, type Waterfall } from './waterfall'

export interface Decode {
  /** Unique within the slot. */
  id: string
  text: string
  kind: Unpacked['kind']
  /** dB in 2500 Hz, WSJT-X convention. */
  snr: number
  /** Time offset from the nominal start (0.5 s into the slot), seconds. */
  dt: number
  /** Audio frequency of the lowest tone, Hz. */
  freq: number
  score: number
  from?: string
  to?: string
  grid?: string
  /** Hex of the 77-bit payload (10 bytes). */
  payloadHex: string
}

export interface SlotOptions {
  maxCandidates: number
  minScore: number
  ldpcIterations: number
}

export const DEFAULT_SLOT_OPTIONS: SlotOptions = { maxCandidates: 140, minScore: 10, ldpcIterations: 25 }

export interface SlotResult {
  decodes: Decode[]
  candidates: number
  /** Waterfall rows (freqSub 0) for display: rows x bins, 0.5 dB units. */
  rows: Uint8Array
  numRows: number
  numBins: number
  rowSeconds: number
  fMin: number
  binHz: number
}

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('')

/** Display rows from the decoder waterfall (first frequency sub-bin only). */
export function waterfallRows(wf: Waterfall): { rows: Uint8Array; numRows: number } {
  const numRows = wf.numBlocks * wf.timeOsr
  const rows = new Uint8Array(numRows * wf.numBins)
  for (let b = 0; b < wf.numBlocks; b++) {
    for (let ts = 0; ts < wf.timeOsr; ts++) {
      const src = b * wf.blockStride + ts * wf.freqOsr * wf.numBins
      rows.set(wf.mag.subarray(src, src + wf.numBins), (b * wf.timeOsr + ts) * wf.numBins)
    }
  }
  return { rows, numRows }
}

/** Decodes one 15 s slot of 12 kHz audio. */
export function decodeSlot(
  samples: Float32Array,
  hashes: CallsignHashes | null = null,
  opts: SlotOptions = DEFAULT_SLOT_OPTIONS,
  sampleRate = SAMPLE_RATE,
): SlotResult {
  const wf = computeWaterfall(samples, { sampleRate, ...DEFAULT_WF })
  const cands = findCandidates(wf, opts.maxCandidates, opts.minScore)
  const seen = new Set<string>()
  const decodes: Decode[] = []
  for (const cand of cands) {
    const res = decodeCandidate(wf, cand, opts.ldpcIterations)
    if (!res) continue
    const key = hex(res.payload)
    if (seen.has(key)) continue
    seen.add(key)
    const msg = unpackMessage(res.payload, hashes)
    if (!msg) continue
    const freq = (wf.minBin + cand.freqOffset + cand.freqSub / wf.freqOsr) / wf.symbolPeriod
    const time = (cand.timeOffset + cand.timeSub / wf.timeOsr) * wf.symbolPeriod
    decodes.push({
      id: key,
      text: msg.text,
      kind: msg.kind,
      snr: estimateSnr(wf, cand, res.payload),
      dt: Math.round((time - FT8_TX_START) * 10) / 10,
      freq: Math.round(freq * 10) / 10,
      score: cand.score,
      from: msg.from,
      to: msg.to,
      grid: msg.grid,
      payloadHex: key,
    })
  }
  const { rows, numRows } = waterfallRows(wf)
  return {
    decodes,
    candidates: cands.length,
    rows,
    numRows,
    numBins: wf.numBins,
    rowSeconds: wf.symbolPeriod / wf.timeOsr,
    fMin: wf.minBin / wf.symbolPeriod,
    binHz: 1 / wf.symbolPeriod,
  }
}
