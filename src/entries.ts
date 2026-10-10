import type { Decode } from './lib/slot'
import { bearingDeg, distanceKm, gridToLatLon } from './lib/grid'
import { utcClock } from './lib/clock'

export interface Entry extends Decode {
  /** Unique across slots. */
  key: string
  /** Epoch ms of the slot start (for files and samples, the recording time or 0). */
  slotStart: number
  /** Time column text. */
  label: string
  source: 'live' | 'file' | 'sample' | 'demo' | 'tx'
}

export function makeEntries(decodes: Decode[], slotStart: number, source: Entry['source'], label?: string): Entry[] {
  const l = label ?? utcClock(slotStart)
  return decodes.map((d) => ({ ...d, key: `${slotStart}:${l}:${d.id}`, slotStart, label: l, source }))
}

/** callsign -> latest known 4-character locator, from the messages that carried one. */
export function buildGridBook(entries: Entry[]): Map<string, string> {
  const book = new Map<string, string>()
  // entries are newest first; walk oldest to newest so newer grids win
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]
    if (e.from && e.grid) book.set(e.from.replace(/^<|>$/g, ''), e.grid)
  }
  return book
}

export interface Where {
  km: number
  bearing: number
}

export function whereIs(myGrid: string, theirGrid: string | undefined): Where | null {
  const a = gridToLatLon(myGrid)
  const b = theirGrid ? gridToLatLon(theirGrid) : null
  if (!a || !b) return null
  return { km: distanceKm(a, b), bearing: bearingDeg(a, b) }
}

/** WSJT-X decoded-text style lines: "HHMMSS snr dt freq ~ message". */
export function toDecodedText(entries: Entry[]): string {
  return [...entries]
    .reverse()
    .map((e) => {
      const t = e.label.replace(/:/g, '').padStart(6, '0')
      return `${t} ${String(e.snr).padStart(3)} ${e.dt.toFixed(1).padStart(4)} ${String(Math.round(e.freq)).padStart(4)} ~  ${e.text}`
    })
    .join('\n')
}

export function entryKind(e: Pick<Entry, 'to' | 'from' | 'text'>, myCall: string): 'cq' | 'me' | 'other' {
  if (myCall && (e.to === myCall || e.from === myCall)) return 'me'
  return e.text.startsWith('CQ') ? 'cq' : 'other'
}
