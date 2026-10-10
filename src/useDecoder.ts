import { useCallback, useEffect, useRef } from 'react'
import type { DecodeRequest, DecodeResponse } from './decoder.worker'
import type { SlotResult } from './lib/slot'

export interface DecodeDone {
  tag: number
  result: SlotResult
  ms: number
}

/** Runs slot decodes in a Web Worker (one at a time, queued); resolves with the slot result. */
export function useDecoder() {
  const worker = useRef<Worker | null>(null)
  const pending = useRef(new Map<number, { resolve: (d: DecodeDone) => void; reject: (e: Error) => void }>())
  const nextId = useRef(1)

  useEffect(() => {
    const w = new Worker(new URL('./decoder.worker.ts', import.meta.url), { type: 'module' })
    const map = pending.current
    w.onmessage = (e: MessageEvent<DecodeResponse>) => {
      const p = map.get(e.data.id)
      if (!p) return
      map.delete(e.data.id)
      if (e.data.type === 'result') p.resolve({ tag: e.data.tag, result: e.data.result, ms: e.data.ms })
      else p.reject(new Error(e.data.message))
    }
    w.onerror = (e) => {
      for (const p of map.values()) p.reject(new Error(e.message || 'Worker error'))
      map.clear()
    }
    worker.current = w
    return () => {
      w.terminate()
      worker.current = null
      for (const p of map.values()) p.reject(new Error('Decoder stopped'))
      map.clear()
    }
  }, [])

  return useCallback((samples: Float32Array, sampleRate: number, tag: number) => {
    return new Promise<DecodeDone>((resolve, reject) => {
      const w = worker.current
      if (!w) {
        reject(new Error('Decoder not ready'))
        return
      }
      const id = nextId.current++
      pending.current.set(id, { resolve, reject })
      const req: DecodeRequest = { type: 'decode', id, samples, sampleRate, tag }
      w.postMessage(req, [samples.buffer])
    })
  }, [])
}
