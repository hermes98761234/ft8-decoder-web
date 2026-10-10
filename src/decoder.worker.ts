/// <reference lib="webworker" />
import { SAMPLE_RATE } from './lib/constants'
import { CallsignHashes } from './lib/message'
import { resample } from './lib/resample'
import { decodeSlot, DEFAULT_SLOT_OPTIONS, type SlotResult } from './lib/slot'

export interface DecodeRequest {
  type: 'decode'
  id: number
  samples: Float32Array
  sampleRate: number
  /** Opaque value echoed back (slot start, epoch ms). */
  tag: number
}
export type DecodeResponse =
  | { type: 'result'; id: number; tag: number; result: SlotResult; ms: number }
  | { type: 'error'; id: number; message: string }

// Callsigns seen so far, to resolve hashed <...> callsigns in later slots.
const hashes = new CallsignHashes()

self.onmessage = (e: MessageEvent<DecodeRequest>) => {
  const { id, samples, sampleRate, tag } = e.data
  try {
    const t0 = performance.now()
    const s12 = resample(samples, sampleRate, SAMPLE_RATE)
    const result = decodeSlot(s12, hashes, DEFAULT_SLOT_OPTIONS)
    const res: DecodeResponse = { type: 'result', id, tag, result, ms: Math.round(performance.now() - t0) }
    ;(self as unknown as Worker).postMessage(res, [result.rows.buffer])
  } catch (err) {
    const res: DecodeResponse = { type: 'error', id, message: err instanceof Error ? err.message : String(err) }
    self.postMessage(res)
  }
}
