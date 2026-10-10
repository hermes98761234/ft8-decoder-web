import { describe, expect, it } from 'vitest'
import { CallsignHashes, callsignHash, gridFromText, packMessage, payloadI3, unpackMessage } from './message'

function roundTrip(text: string, hashes: CallsignHashes | null = null) {
  const p = packMessage(text, hashes)
  if (!p.ok) throw new Error(`${text}: ${p.error}`)
  return unpackMessage(p.payload, hashes)
}

describe('standard messages', () => {
  const cases = [
    'CQ K1ABC FN42',
    'CQ DX K1ABC FN42',
    'CQ POTA W9XYZ EN52',
    'CQ 123 K1ABC FN42',
    'K1ABC W9XYZ -11',
    'K1ABC W9XYZ R-09',
    'K1ABC W9XYZ +05',
    'K1ABC W9XYZ R+12',
    'W9XYZ K1ABC RRR',
    'W9XYZ K1ABC RR73',
    'W9XYZ K1ABC 73',
    'W9XYZ K1ABC',
    'K1ABC W9XYZ EN52',
    'QRZ UR5XXX KO50',
    'CQ UA3ABC KO85',
    'CQ 3DA0XYZ KG53',
    'CQ 3XA0XYZ JJ16',
    'CQ G4ABC/P IO91',
    'K1ABC/R W9XYZ/R -03',
    'CQ A1BC FN31',
    'CQ 9A1ABC JN85',
  ]
  for (const c of cases) {
    it(`round-trips "${c}"`, () => {
      expect(roundTrip(c)?.text).toBe(c)
    })
  }

  it('marks /P messages as type 2 and the rest as type 1', () => {
    const p1 = packMessage('CQ K1ABC FN42')
    const p2 = packMessage('CQ G4ABC/P IO91')
    if (!p1.ok || !p2.ok) throw new Error('pack')
    expect(payloadI3(p1.payload)).toBe(1)
    expect(payloadI3(p2.payload)).toBe(2)
  })

  it('extracts sender, recipient and grid', () => {
    const u = roundTrip('K1ABC W9XYZ EN52')
    expect(u).toMatchObject({ kind: 'standard', to: 'K1ABC', from: 'W9XYZ', grid: 'EN52' })
    expect(roundTrip('K1ABC W9XYZ RR73')?.grid).toBeUndefined()
    expect(roundTrip('CQ K1ABC FN42')?.to).toBe('CQ')
  })

  it('normalises case and spaces', () => {
    expect(roundTrip('  cq   k1abc  fn42 ')?.text).toBe('CQ K1ABC FN42')
  })

  it('encodes the WSJT-X reference bit pattern for "CQ" and a standard call', () => {
    // WSJT-X packjt77: CQ is token 2; K1ABC has its digit second so it is right-aligned as " K1ABC" and
    // packs to NTOKENS + MAX22 + base-(37,36,10,27,27,27) digits (0, K=20, 1, A=1, B=2, C=3).
    const p = packMessage('CQ K1ABC')
    if (!p.ok) throw new Error('pack')
    const n29a = ((p.payload[0] << 21) | (p.payload[1] << 13) | (p.payload[2] << 5) | (p.payload[3] >> 3)) >>> 0
    const n29b = (((p.payload[3] & 7) << 26) | (p.payload[4] << 18) | (p.payload[5] << 10) | (p.payload[6] << 2) | (p.payload[7] >> 6)) >>> 0
    expect(n29a >>> 1).toBe(2)
    
    expect(n29b >>> 1).toBe(2063592 + 4194304 + ((((20 * 10 + 1) * 27 + 1) * 27 + 2) * 27 + 3))
  })
})

describe('free text and others', () => {
  it('round-trips free text up to 13 characters', () => {
    for (const s of ['TNX BOB 73 GL', 'HELLO', 'A', 'CQ TEST 73', '1/2 +-./? 9']) {
      const u = roundTrip(s)
      expect(u?.kind === 'free' || u?.kind === 'standard').toBe(true)
      expect(u?.text).toBe(s)
    }
    expect(roundTrip('TNX BOB 73 GL')?.kind).toBe('free')
  })

  it('rejects over-long or illegal free text', () => {
    expect(packMessage('THIS TEXT IS WAY TOO LONG').ok).toBe(false)
    expect(packMessage('BAD#CHAR').ok).toBe(false)
    expect(packMessage('   ').ok).toBe(false)
  })

  it('decodes telemetry as hex', () => {
    // n3 = 5 lives in bits 71..73: byte 8 bit 0 and byte 9 bits 7..6
    const p = new Uint8Array(10)
    p[8] = 0x01
    p[9] = 0x40
    expect(unpackMessage(p)?.kind).toBe('telemetry')
  })

  it('flags unsupported message types instead of failing', () => {
    const p = new Uint8Array(10)
    p[9] = 3 << 3 // i3 = 3 (ARRL RTTY)
    expect(unpackMessage(p)?.kind).toBe('unsupported')
  })
})

describe('non-standard callsigns and hashes', () => {
  it('packs a long callsign as type 4 with a hashed partner', () => {
    const h = new CallsignHashes()
    const p = packMessage('K1ABC PJ4/W9XYZ RR73', h)
    if (!p.ok) throw new Error('pack')
    expect(payloadI3(p.payload)).toBe(4)
    const u = unpackMessage(p.payload, h)
    expect(u?.text).toBe('<K1ABC> PJ4/W9XYZ RR73')
    expect(u?.kind).toBe('nonstandard')
  })

  it('shows <...> when the hashed callsign is unknown', () => {
    const p = packMessage('K1ABC PJ4/W9XYZ RR73', new CallsignHashes())
    if (!p.ok) throw new Error('pack')
    expect(unpackMessage(p.payload, new CallsignHashes())?.text).toBe('<...> PJ4/W9XYZ RR73')
  })

  it('CQ with a non-standard callsign', () => {
    const u = roundTrip('CQ PJ4/K1ABC')
    expect(u?.kind).toBe('nonstandard')
    expect(u?.text).toBe('CQ PJ4/K1ABC')
  })

  it('callsign hashes have the right widths and are stable', () => {
    const h = callsignHash('K1ABC')!
    expect(h.n22).toBeLessThan(1 << 22)
    expect(h.n12).toBe(h.n22 >> 10)
    expect(h.n10).toBe(h.n22 >> 12)
    expect(callsignHash('K1ABC')).toEqual(h)
    expect(callsignHash('K1ABD')!.n22).not.toBe(h.n22)
    expect(callsignHash('K1#BC')).toBeNull()
  })

  it('resolves a hashed callsign inside a standard message after it was seen', () => {
    const h = new CallsignHashes()
    h.save('PJ4/K1ABC')
    const p = packMessage('<PJ4/K1ABC> W9XYZ -05', h)
    if (!p.ok) throw new Error('pack')
    expect(unpackMessage(p.payload, h)?.text).toBe('<PJ4/K1ABC> W9XYZ -05')
  })
})

describe('gridFromText', () => {
  it('finds a trailing locator but not RR73', () => {
    expect(gridFromText('CQ K1ABC FN42')).toBe('FN42')
    expect(gridFromText('K1ABC W9XYZ RR73')).toBeUndefined()
    expect(gridFromText('K1ABC W9XYZ -10')).toBeUndefined()
  })
})
