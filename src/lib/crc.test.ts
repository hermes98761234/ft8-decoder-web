import { describe, expect, it } from 'vitest'
import { addCrc, computeCrc, extractCrc } from './crc'
import { makeRng } from './encode'

/** Textbook MSB-first CRC-14 (x^14 + x^13 + x^10 + x^9 + x^8 + x^6 + x^4 + x^2 + x + 1), zero initial value. */
function referenceCrc(bytes: number[]): number {
  let reg = 0
  for (const byte of bytes) {
    for (let i = 7; i >= 0; i--) {
      const feedback = ((reg >> 13) & 1) ^ ((byte >> i) & 1)
      reg = (reg << 1) & 0x3fff
      if (feedback) reg ^= 0x2757
    }
  }
  return reg
}

describe('CRC-14', () => {
  it('equals the textbook bitwise CRC for whole bytes', () => {
    const rng = makeRng(5)
    for (const len of [1, 2, 9, 12]) {
      for (let k = 0; k < 10; k++) {
        const msg = Array.from({ length: len }, () => Math.floor(rng() * 256))
        expect(computeCrc(Uint8Array.from(msg), len * 8)).toBe(referenceCrc(msg))
      }
    }
    expect(referenceCrc([0x01])).toBe(0x2757)
  })

  it('is linear over GF(2) and depends on every bit', () => {
    const a = Uint8Array.from([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0, 0x11, 0x20, 0, 0])
    const b = Uint8Array.from([0xa5, 0x5a, 0x0f, 0xf0, 0x33, 0xcc, 0x01, 0x80, 0x7e, 0x40, 0, 0])
    const x = a.map((v, i) => v ^ b[i])
    expect(computeCrc(x, 82)).toBe(computeCrc(a, 82) ^ computeCrc(b, 82))
  })

  it('is zero for an all-zero message and detects single-bit errors', () => {
    expect(computeCrc(new Uint8Array(12), 82)).toBe(0)
    const p = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 0x10])
    const a = addCrc(p)
    expect(extractCrc(a)).toBe(computeCrc(Uint8Array.from([...a.slice(0, 9), a[9] & 0xf8, 0]), 82))
    for (let bit = 0; bit < 77; bit++) {
      const q = p.slice()
      q[bit >> 3] ^= 0x80 >> (bit & 7)
      expect(extractCrc(addCrc(q))).not.toBe(extractCrc(a))
    }
  })

  it('keeps the payload bits and clears the pad bits', () => {
    const a = addCrc(Uint8Array.from([255, 255, 255, 255, 255, 255, 255, 255, 255, 255]))
    expect(a[9] & 0xf8).toBe(0xf8)
    expect(a.length).toBe(12)
    expect(a[11] & 0x1f).toBe(0)
  })
})
