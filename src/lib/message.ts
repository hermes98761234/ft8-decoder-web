import { charn, nchar } from './text'

/*
 * FT8 77-bit message packing and unpacking: standard messages (i3 = 1, 2), non-standard callsigns
 * (i3 = 4), free text and telemetry (i3 = 0). Based on the WSJT-X packjt77 layout, following
 * kgoba/ft8_lib (MIT) for the algorithms. The 77 bits are handled as one BigInt.
 */

const MAX22 = 4194304
const NTOKENS = 2063592
const MAXGRID4 = 32400
const MASK64 = (1n << 64n) - 1n

export type PackResult = { ok: true; payload: Uint8Array } | { ok: false; error: string }

export interface Unpacked {
  text: string
  kind: 'standard' | 'nonstandard' | 'free' | 'telemetry' | 'unsupported'
  i3: number
  n3: number
  /** Sender callsign (the second callsign of a standard message). */
  from?: string
  to?: string
  /** 4-character Maidenhead locator when the message carries one. */
  grid?: string
}

/** Remembers callsigns seen so hashed callsigns <...> can be resolved later. */
export class CallsignHashes {
  private by22 = new Map<number, string>()
  private by12 = new Map<number, string>()
  private by10 = new Map<number, string>()

  save(callsign: string): void {
    const h = callsignHash(callsign)
    if (!h) return
    this.by22.set(h.n22, callsign)
    this.by12.set(h.n12, callsign)
    this.by10.set(h.n10, callsign)
  }

  lookup(bits: 22 | 12 | 10, hash: number): string | undefined {
    return (bits === 22 ? this.by22 : bits === 12 ? this.by12 : this.by10).get(hash)
  }

  get size(): number {
    return this.by22.size
  }
}

/** 22/12/10-bit callsign hashes; null when the callsign has characters outside the hash alphabet. */
export function callsignHash(callsign: string): { n22: number; n12: number; n10: number } | null {
  let n58 = 0n
  let i = 0
  while (i < callsign.length && i < 11) {
    const j = nchar(callsign[i], 'alnumSpaceSlash')
    if (j < 0) return null
    n58 = 38n * n58 + BigInt(j)
    i++
  }
  while (i < 11) {
    n58 *= 38n
    i++
  }
  const n22 = Number(((47055833459n * n58) & MASK64) >> 42n) & 0x3fffff
  return { n22, n12: n22 >> 10, n10: n22 >> 12 }
}

const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9'
const isLetter = (c: string | undefined) => c !== undefined && c >= 'A' && c <= 'Z'

function bitsToPayload(v77: bigint): Uint8Array {
  let v = v77 << 3n
  const out = new Uint8Array(10)
  for (let i = 9; i >= 0; i--) {
    out[i] = Number(v & 0xffn)
    v >>= 8n
  }
  return out
}

function payloadToBits(payload: Uint8Array): bigint {
  let v = 0n
  for (let i = 0; i < 10; i++) v = (v << 8n) | BigInt(payload[i])
  return v >> 3n
}

export function payloadI3(payload: Uint8Array): number {
  return (payload[9] >> 3) & 7
}

/** CQ modifier value for "CQ nnn" / "CQ abcd" tokens, or -1 when the token is not a modifier. */
function parseCqModifier(token: string): number {
  let nnum = 0
  let nlet = 0
  let m = 0
  for (const c of token.slice(0, 5)) {
    if (isDigit(c)) nnum++
    else if (isLetter(c)) {
      nlet++
      m = 27 * m + (c.charCodeAt(0) - 64)
    } else return -1
  }
  if (nnum === 3 && nlet === 0 && token.length === 3) return parseInt(token, 10)
  if (nnum === 0 && nlet >= 1 && nlet <= 4 && token.length <= 4) return 1000 + m
  return -1
}

function packBasecall(call: string): number {
  const length = call.length
  if (length <= 2) return -1
  let c6 = '      '
  if (call.startsWith('3DA0') && length > 4 && length <= 7) c6 = ('3D0' + call.slice(4)).padEnd(6)
  else if (call.startsWith('3X') && isLetter(call[2]) && length <= 7) c6 = ('Q' + call.slice(2)).padEnd(6)
  else if (isDigit(call[2]) && length <= 6) c6 = call.padEnd(6)
  else if (isDigit(call[1]) && length <= 5) c6 = (' ' + call).padEnd(6)
  const i0 = nchar(c6[0], 'alnumSpace')
  const i1 = nchar(c6[1], 'alnum')
  const i2 = nchar(c6[2], 'numeric')
  const i3 = nchar(c6[3], 'lettersSpace')
  const i4 = nchar(c6[4], 'lettersSpace')
  const i5 = nchar(c6[5], 'lettersSpace')
  if (i0 < 0 || i1 < 0 || i2 < 0 || i3 < 0 || i4 < 0 || i5 < 0) return -1
  return ((((i0 * 36 + i1) * 10 + i2) * 27 + i3) * 27 + i4) * 27 + i5
}

/** Packs a callsign or special token into 28 bits; `ip` is the /R or /P flag. Returns -1 on failure. */
function pack28(callsign: string, hashes: CallsignHashes | null): { n28: number; ip: number } | null {
  if (callsign === 'DE') return { n28: 0, ip: 0 }
  if (callsign === 'QRZ') return { n28: 1, ip: 0 }
  if (callsign === 'CQ') return { n28: 2, ip: 0 }
  if (callsign.startsWith('CQ ') && callsign.length < 8) {
    const v = parseCqModifier(callsign.slice(3))
    return v < 0 ? null : { n28: 3 + v, ip: 0 }
  }
  if (callsign.length > 2 && callsign.startsWith('<') && callsign.endsWith('>')) {
    const h = callsignHash(callsign.slice(1, -1))
    return h ? { n28: NTOKENS + h.n22, ip: 0 } : null
  }
  let ip = 0
  let base = callsign
  if (callsign.endsWith('/P') || callsign.endsWith('/R')) {
    ip = 1
    base = callsign.slice(0, -2)
  }
  const n = packBasecall(base)
  if (n >= 0) {
    if (!callsignHash(callsign)) return null
    hashes?.save(callsign)
    return { n28: NTOKENS + MAX22 + n, ip }
  }
  // Anything else is a non-standard callsign: it needs a type 4 message (or <brackets> for its hash).
  return null
}

/** Returns 16 bits: ir flag in bit 15, grid / report code below, or null when `extra` is not valid. */
function packGrid(extra: string, ir: number): number | null {
  if (extra === '') return MAXGRID4 + 1
  if (extra === 'RRR') return MAXGRID4 + 2
  if (extra === 'RR73') return MAXGRID4 + 3
  if (extra === '73') return MAXGRID4 + 4
  if (/^[A-R]{2}[0-9]{2}$/.test(extra)) {
    const g =
      (((extra.charCodeAt(0) - 65) * 18 + (extra.charCodeAt(1) - 65)) * 10 + (extra.charCodeAt(2) - 48)) * 10 +
      (extra.charCodeAt(3) - 48)
    return (ir << 15) | g
  }
  const m = /^(R?)([+-]?)(\d{1,2})$/.exec(extra)
  if (m) {
    const dd = (m[2] === '-' ? -1 : 1) * parseInt(m[3], 10)
    return ((m[1] === 'R' ? 1 : ir) << 15) | (MAXGRID4 + 35 + dd)
  }
  return null
}

function pack(fields: [bigint | number, number][]): Uint8Array {
  let v = 0n
  for (const [x, bits] of fields) v = (v << BigInt(bits)) | (BigInt(x) & ((1n << BigInt(bits)) - 1n))
  return bitsToPayload(v)
}

function encodeStd(callTo: string, callDe: string, extra: string, hashes: CallsignHashes | null): Uint8Array | null {
  let ir = 0
  if (extra.startsWith('R ')) {
    ir = 1
    extra = extra.slice(2)
  }
  const a = pack28(callTo, hashes)
  const b = pack28(callDe, hashes)
  if (!a || !b) return null
  let i3 = 1
  if (callTo.endsWith('/P') || callDe.endsWith('/P')) {
    if (callTo.endsWith('/R') || callDe.endsWith('/R')) return null
    i3 = 2
  }
  const slash = callDe.indexOf('/')
  const cq = callTo === 'CQ' || callTo.startsWith('CQ ')
  if (slash >= 2 && cq && !(callDe.endsWith('/P') || callDe.endsWith('/R'))) return null
  const grid = packGrid(extra, ir)
  if (grid === null) return null
  return pack([
    [(a.n28 << 1) | a.ip, 29],
    [(b.n28 << 1) | b.ip, 29],
    [grid, 16],
    [i3, 3],
  ])
}

function packBase58(call: string): bigint | null {
  let r = 0n
  if (call.length > 11) return null
  for (const c of call) {
    const j = nchar(c, 'alnumSpaceSlash')
    if (j < 0) return null
    r = r * 38n + BigInt(j)
  }
  // Right-aligned: leading spaces are zeros, trimmed again on decode.
  return r
}

function encodeNonStd(callTo: string, callDe: string, extra: string, hashes: CallsignHashes | null): Uint8Array | null {
  const cq = callTo === 'CQ'
  const strip = (c: string) => (c.startsWith('<') && c.endsWith('>') ? c.slice(1, -1) : c)
  let iflip = 0
  let n12 = 0
  let call58: string
  if (!cq) {
    if (callTo.length < 3) return null
    if (callDe.startsWith('<') && callDe.endsWith('>')) iflip = 1
    const call12 = strip(iflip ? callDe : callTo)
    call58 = strip(iflip ? callTo : callDe)
    const h = callsignHash(call12)
    if (!h) return null
    n12 = h.n12
    hashes?.save(call12)
  } else {
    call58 = strip(callDe)
  }
  if (callDe.length < 3) return null
  const n58 = packBase58(call58)
  if (n58 === null) return null
  hashes?.save(call58)
  const nrpt = cq ? 0 : extra === 'RRR' ? 1 : extra === 'RR73' ? 2 : extra === '73' ? 3 : 0
  return pack([
    [n12, 12],
    [n58, 58],
    [iflip, 1],
    [nrpt, 2],
    [cq ? 1 : 0, 1],
    [4, 3],
  ])
}

function encodeFree(text: string): Uint8Array | null {
  if (text.length > 13) return null
  let v = 0n
  for (let i = 0; i < 13; i++) {
    const c = i < text.length ? text[i] : ' '
    const id = nchar(c, 'full')
    if (id < 0) return null
    v = v * 42n + BigInt(id)
  }
  return pack([
    [v, 71],
    [0, 3],
    [0, 3],
  ])
}

/**
 * Packs a message such as "CQ DX K1ABC FN42", "K1ABC W9XYZ -11" or free text (up to 13 characters
 * of 0-9 A-Z space + - . / ?) into the 77-bit payload.
 */
export function packMessage(input: string, hashes: CallsignHashes | null = null): PackResult {
  const text = input.trim().replace(/\s+/g, ' ').toUpperCase()
  if (!text) return { ok: false, error: 'empty' }
  const tokens = text.split(' ')
  let callTo: string
  let rest: string[]
  if (tokens[0] === 'CQ') {
    if (tokens.length >= 3 && parseCqModifier(tokens[1]) >= 0) {
      callTo = 'CQ ' + tokens[1]
      rest = tokens.slice(2)
    } else {
      callTo = 'CQ'
      rest = tokens.slice(1)
    }
  } else {
    callTo = tokens[0]
    rest = tokens.slice(1)
  }
  if (rest.length >= 1 && rest.length <= 3) {
    const callDe = rest[0]
    const extra = rest.slice(1).join(' ')
    const fits = rest.length <= 2 || (rest.length === 3 && rest[1] === 'R')
    if (fits) {
      const std = encodeStd(callTo, callDe, extra, hashes)
      if (std) return { ok: true, payload: std }
      const non = encodeNonStd(callTo, callDe, extra, hashes)
      if (non) return { ok: true, payload: non }
    }
  }
  const free = encodeFree(text)
  if (free) return { ok: true, payload: free }
  return { ok: false, error: text.length > 13 ? 'tooLong' : 'invalid' }
}

function unpack28(n28: number, ip: number, i3: number, hashes: CallsignHashes | null): string | null {
  if (n28 < NTOKENS) {
    if (n28 === 0) return 'DE'
    if (n28 === 1) return 'QRZ'
    if (n28 === 2) return 'CQ'
    if (n28 <= 1002) return 'CQ ' + String(n28 - 3).padStart(3, '0')
    if (n28 <= 532443) {
      let n = n28 - 1003
      let s = ''
      for (let i = 0; i < 4; i++) {
        s = charn(n % 27, 'lettersSpace') + s
        n = Math.floor(n / 27)
      }
      return 'CQ ' + s.trimStart()
    }
    return null
  }
  n28 -= NTOKENS
  if (n28 < MAX22) {
    const c = hashes?.lookup(22, n28)
    return c ? `<${c}>` : '<...>'
  }
  let n = n28 - MAX22
  const ch = new Array<string>(6)
  ch[5] = charn(n % 27, 'lettersSpace')
  n = Math.floor(n / 27)
  ch[4] = charn(n % 27, 'lettersSpace')
  n = Math.floor(n / 27)
  ch[3] = charn(n % 27, 'lettersSpace')
  n = Math.floor(n / 27)
  ch[2] = charn(n % 10, 'numeric')
  n = Math.floor(n / 10)
  ch[1] = charn(n % 36, 'alnum')
  n = Math.floor(n / 36)
  ch[0] = charn(n % 37, 'alnumSpace')
  const s = ch.join('')
  let result: string
  if (s.startsWith('3D0') && s[3] !== ' ') result = '3DA0' + s.slice(3).trim()
  else if (s[0] === 'Q' && isLetter(s[1])) result = '3X' + s.slice(1).trim()
  else result = s.trim()
  if (result.length < 3) return null
  if (ip) {
    if (i3 === 1) result += '/R'
    else if (i3 === 2) result += '/P'
    else return null
  }
  hashes?.save(result)
  return result
}

function unpackGrid(igrid: number, ir: number): { extra: string; grid?: string } | null {
  if (igrid <= MAXGRID4) {
    let n = igrid
    const d3 = n % 10
    n = Math.floor(n / 10)
    const d2 = n % 10
    n = Math.floor(n / 10)
    const l1 = n % 18
    n = Math.floor(n / 18)
    const l0 = n % 18
    const grid = String.fromCharCode(65 + l0, 65 + l1, 48 + d2, 48 + d3)
    return { extra: (ir ? 'R ' : '') + grid, grid }
  }
  const irpt = igrid - MAXGRID4
  if (irpt === 1) return { extra: '' }
  if (irpt === 2) return { extra: 'RRR' }
  if (irpt === 3) return { extra: 'RR73' }
  if (irpt === 4) return { extra: '73' }
  const v = irpt - 35
  return { extra: (ir ? 'R' : '') + (v < 0 ? '-' : '+') + String(Math.abs(v)).padStart(2, '0') }
}

function unpackBase58(n58: bigint): string {
  let s = ''
  for (let i = 0; i < 11; i++) {
    s = charn(Number(n58 % 38n), 'alnumSpaceSlash') + s
    n58 /= 38n
  }
  return s.trim()
}

/** Decodes a 77-bit payload to text, or null if the fields are invalid. */
export function unpackMessage(payload: Uint8Array, hashes: CallsignHashes | null = null): Unpacked | null {
  const v = payloadToBits(payload)
  const i3 = Number(v & 7n)
  const n3 = Number((v >> 3n) & 7n)
  if (i3 === 1 || i3 === 2) {
    const igrid = Number((v >> 3n) & 0x7fffn)
    const ir = Number((v >> 18n) & 1n)
    const n29b = Number((v >> 19n) & 0x1fffffffn)
    const n29a = Number((v >> 48n) & 0x1fffffffn)
    const to = unpack28(n29a >>> 1, n29a & 1, i3, hashes)
    const from = unpack28(n29b >>> 1, n29b & 1, i3, hashes)
    const g = unpackGrid(igrid, ir)
    if (to === null || from === null || g === null) return null
    const text = [to, from, g.extra].filter(Boolean).join(' ')
    return { text, kind: 'standard', i3, n3: 0, from, to, grid: g.grid }
  }
  if (i3 === 4) {
    const icq = Number((v >> 3n) & 1n)
    const nrpt = Number((v >> 4n) & 3n)
    const iflip = Number((v >> 6n) & 1n)
    const n58 = (v >> 7n) & ((1n << 58n) - 1n)
    const n12 = Number((v >> 65n) & 0xfffn)
    const decoded = unpackBase58(n58)
    if (decoded.length >= 3) hashes?.save(decoded)
    const looked = hashes?.lookup(12, n12)
    const hashed = looked ? `<${looked}>` : '<...>'
    const call1 = iflip ? decoded : hashed
    const call2 = iflip ? hashed : decoded
    const extra = icq ? '' : (['', 'RRR', 'RR73', '73'][nrpt] ?? '')
    const to = icq ? 'CQ' : call1
    const text = [to, call2, extra].filter(Boolean).join(' ')
    return { text, kind: 'nonstandard', i3, n3: 0, from: call2, to }
  }
  if (i3 === 0 && n3 === 0) {
    let t = v >> 6n
    let s = ''
    for (let i = 0; i < 13; i++) {
      s = charn(Number(t % 42n), 'full') + s
      t /= 42n
    }
    return { text: s.trim(), kind: 'free', i3, n3 }
  }
  if (i3 === 0 && n3 === 5) {
    const t = (v >> 6n).toString(16).toUpperCase().padStart(18, '0')
    return { text: t, kind: 'telemetry', i3, n3 }
  }
  return { text: `[i3.n3 ${i3}.${n3}]`, kind: 'unsupported', i3, n3 }
}

/** Extracts a Maidenhead 4-character locator from free text like "R KO50", ignoring RR73. */
export function gridFromText(text: string): string | undefined {
  const last = text.trim().split(/\s+/).pop() ?? ''
  return /^[A-R]{2}[0-9]{2}$/.test(last) && last !== 'RR73' ? last : undefined
}
