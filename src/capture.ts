import { FT8_SLOT_TIME } from './lib/constants'
import { slotStart } from './lib/clock'

const WORKLET = `
class Capture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(2048); this.n = 0; this.frame = 0 }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        if (this.n === 0) this.frame = currentFrame + i
        this.buf[this.n++] = ch[i]
        if (this.n === this.buf.length) {
          this.port.postMessage({ frame: this.frame, data: this.buf.slice() })
          this.n = 0
        }
      }
    }
    return true
  }
}
registerProcessor('ft8-capture', Capture)
`

export interface CapturedSlot {
  samples: Float32Array
  sampleRate: number
  /** Epoch ms of the slot start. */
  start: number
  /** Seconds of the slot that were actually recorded. */
  covered: number
}

export interface CaptureOptions {
  deviceId?: string
  /** Extra milliseconds added to the device clock (user correction). */
  clockOffsetMs: () => number
  onSlot: (slot: CapturedSlot) => void
  onSkip: (reason: 'late') => void
}

/** Microphone capture split into UTC-aligned 15 s slots. */
export class SlotCapture {
  readonly ctx: AudioContext
  readonly analyser: AnalyserNode
  private stream: MediaStream
  private node: AudioWorkletNode
  private chunks: { frame: number; data: Float32Array }[] = []
  private refWall = 0
  private refFrame = -1
  private lastSlot = -1
  private timer = 0
  private opts: CaptureOptions

  private constructor(ctx: AudioContext, stream: MediaStream, node: AudioWorkletNode, analyser: AnalyserNode, opts: CaptureOptions) {
    this.ctx = ctx
    this.stream = stream
    this.node = node
    this.analyser = analyser
    this.opts = opts
  }

  static async start(opts: CaptureOptions): Promise<SlotCapture> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: opts.deviceId ? { exact: opts.deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    })
    const ctx = new AudioContext({ latencyHint: 'interactive' })
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }))
    try {
      await ctx.audioWorklet.addModule(url)
    } finally {
      URL.revokeObjectURL(url)
    }
    const source = ctx.createMediaStreamSource(stream)
    const node = new AudioWorkletNode(ctx, 'ft8-capture')
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 8192
    analyser.smoothingTimeConstant = 0
    const mute = ctx.createGain()
    mute.gain.value = 0
    source.connect(node)
    source.connect(analyser)
    node.connect(mute)
    mute.connect(ctx.destination)
    const cap = new SlotCapture(ctx, stream, node, analyser, opts)
    node.port.onmessage = (e: MessageEvent<{ frame: number; data: Float32Array }>) => cap.onChunk(e.data.frame, e.data.data)
    cap.timer = window.setInterval(() => cap.tick(), 100)
    if (ctx.state === 'suspended') await ctx.resume()
    return cap
  }

  private onChunk(frame: number, data: Float32Array): void {
    if (this.refFrame < 0) {
      // The chunk just ended "now": map its first frame to wall-clock time.
      this.refFrame = frame
      this.refWall = Date.now() - (data.length / this.ctx.sampleRate) * 1000
    }
    this.chunks.push({ frame, data })
    const keep = Math.ceil(this.ctx.sampleRate * FT8_SLOT_TIME * 2.5)
    let total = 0
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      total += this.chunks[i].data.length
      if (total > keep) {
        this.chunks.splice(0, i)
        break
      }
    }
  }

  /** Sample frame at a corrected wall-clock time (epoch ms). */
  private frameOf(wall: number): number {
    return this.refFrame + ((wall - this.refWall - this.opts.clockOffsetMs()) / 1000) * this.ctx.sampleRate
  }

  private tick(): void {
    if (this.refFrame < 0) return
    const now = Date.now() + this.opts.clockOffsetMs()
    const cur = slotStart(now)
    const prev = cur - FT8_SLOT_TIME * 1000
    if (prev <= this.lastSlot || now < cur + 150) return
    this.lastSlot = prev
    const sr = this.ctx.sampleRate
    const n = Math.round(sr * FT8_SLOT_TIME)
    const startFrame = Math.round(this.frameOf(prev))
    const out = new Float32Array(n)
    let covered = 0
    for (const c of this.chunks) {
      const from = Math.max(c.frame, startFrame)
      const to = Math.min(c.frame + c.data.length, startFrame + n)
      if (to <= from) continue
      out.set(c.data.subarray(from - c.frame, to - c.frame), from - startFrame)
      covered += to - from
    }
    const seconds = covered / sr
    if (seconds < FT8_SLOT_TIME - 1.5) {
      this.opts.onSkip('late')
      return
    }
    this.opts.onSlot({ samples: out, sampleRate: sr, start: prev, covered: seconds })
  }

  stop(): void {
    window.clearInterval(this.timer)
    this.node.port.onmessage = null
    this.node.disconnect()
    for (const t of this.stream.getTracks()) t.stop()
    void this.ctx.close()
  }
}
