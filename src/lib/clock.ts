import { FT8_SLOT_TIME } from './constants'

const SLOT_MS = FT8_SLOT_TIME * 1000

/** Start (epoch ms) of the 15 s slot containing `nowMs`. */
export function slotStart(nowMs: number): number {
  return Math.floor(nowMs / SLOT_MS) * SLOT_MS
}

/** Milliseconds until the next slot boundary (always > 0). */
export function msToNextSlot(nowMs: number): number {
  return SLOT_MS - (nowMs - slotStart(nowMs))
}

/** Slot parity: even slots start at :00 and :30, odd slots at :15 and :45. */
export function slotParity(nowMs: number): 'even' | 'odd' {
  return Math.floor(nowMs / SLOT_MS) % 2 === 0 ? 'even' : 'odd'
}

/** HHMMSS in UTC. */
export function utcStamp(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
}

/** HH:MM:SS in UTC. */
export function utcClock(ms: number): string {
  const s = utcStamp(ms)
  return `${s.slice(0, 2)}:${s.slice(2, 4)}:${s.slice(4, 6)}`
}
