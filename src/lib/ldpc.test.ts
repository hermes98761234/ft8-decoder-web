import { describe, expect, it } from 'vitest'
import { bpDecode, encode174, ldpcCheck } from './ldpc'
import { addCrc } from './crc'
import { LDPC_MN, LDPC_NM, LDPC_NUM_ROWS, LDPC_GENERATOR } from './ldpcTables'
import { makeRng } from './encode'

function bits(cw: Uint8Array): Uint8Array {
  const b = new Uint8Array(174)
  for (let i = 0; i < 174; i++) b[i] = (cw[i >> 3] >> (7 - (i & 7))) & 1
  return b
}

function randomPayload(rng: () => number): Uint8Array {
  const p = new Uint8Array(10)
  for (let i = 0; i < 10; i++) p[i] = Math.floor(rng() * 256)
  return p
}

describe('LDPC(174,91)', () => {
  it('tables are consistent: Nm and Mn describe the same Tanner graph', () => {
    expect(LDPC_GENERATOR.length).toBe(83)
    expect(LDPC_NM.length).toBe(83)
    expect(LDPC_MN.length).toBe(174)
    let edges = 0
    for (let m = 0; m < 83; m++) {
      for (let k = 0; k < LDPC_NUM_ROWS[m]; k++) {
        const n = LDPC_NM[m][k] - 1
        expect(LDPC_MN[n].includes(m + 1)).toBe(true)
        edges++
      }
    }
    expect(edges).toBe(174 * 3)
  })

  it('every encoded word satisfies all 83 parity checks', () => {
    const rng = makeRng(42)
    for (let i = 0; i < 50; i++) {
      const cw = bits(encode174(addCrc(randomPayload(rng))))
      expect(ldpcCheck(cw)).toBe(0)
    }
  })

  it('is systematic: the first 91 bits are the message', () => {
    const a91 = addCrc(Uint8Array.from([0xde, 0xad, 0xbe, 0xef, 1, 2, 3, 4, 5, 0x28]))
    const cw = encode174(a91)
    expect([...cw.slice(0, 11)]).toEqual([...a91.slice(0, 11)])
    expect(cw[11] & 0xe0).toBe(a91[11] & 0xe0)
  })

  it('belief propagation corrects noisy soft bits', () => {
    const rng = makeRng(7)
    let fixed = 0
    for (let trial = 0; trial < 20; trial++) {
      const cw = bits(encode174(addCrc(randomPayload(rng))))
      // BPSK-ish soft values with Gaussian noise (sigma 0.6, roughly 6 dB Eb/N0)
      const llr = new Float64Array(174)
      for (let i = 0; i < 174; i++) {
        const u1 = Math.max(rng(), 1e-12)
        const noise = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * rng()) * 0.6
        llr[i] = ((cw[i] ? 1 : -1) + noise) * 2.5
      }
      const r = bpDecode(llr, 40)
      if (r.errors === 0 && r.plain.every((v, i) => v === cw[i])) fixed++
    }
    expect(fixed).toBeGreaterThanOrEqual(19)
  })

  it('reports remaining parity errors for garbage input', () => {
    const rng = makeRng(3)
    const llr = Float64Array.from({ length: 174 }, () => (rng() - 0.5) * 10)
    expect(bpDecode(llr, 25).errors).toBeGreaterThan(0)
  })
})
