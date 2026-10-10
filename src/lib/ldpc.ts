import { LDPC_GENERATOR, LDPC_MN, LDPC_NM, LDPC_NUM_ROWS } from './ldpcTables'
import { LDPC_K, LDPC_K_BYTES, LDPC_M, LDPC_N, LDPC_N_BYTES } from './constants'

function parity8(x: number): number {
  x ^= x >> 4
  x ^= x >> 2
  x ^= x >> 1
  return x & 1
}

/** Systematic LDPC(174,91) encoder: 91 message bits (12 bytes) -> 174-bit codeword (22 bytes). */
export function encode174(message: Uint8Array): Uint8Array {
  const codeword = new Uint8Array(LDPC_N_BYTES)
  codeword.set(message.subarray(0, LDPC_K_BYTES))
  let colMask = 0x80 >> LDPC_K % 8
  let colIdx = LDPC_K_BYTES - 1
  for (let i = 0; i < LDPC_M; i++) {
    let nsum = 0
    for (let j = 0; j < LDPC_K_BYTES; j++) nsum ^= parity8(message[j] & LDPC_GENERATOR[i][j])
    if (nsum & 1) codeword[colIdx] |= colMask
    colMask >>= 1
    if (colMask === 0) {
      colMask = 0x80
      colIdx++
    }
  }
  return codeword
}

/** Number of unsatisfied parity checks for a 174-element array of 0/1 bits. */
export function ldpcCheck(bits: ArrayLike<number>): number {
  let errors = 0
  for (let m = 0; m < LDPC_M; m++) {
    let x = 0
    for (let i = 0; i < LDPC_NUM_ROWS[m]; i++) x ^= bits[LDPC_NM[m][i] - 1]
    if (x) errors++
  }
  return errors
}

function fastTanh(x: number): number {
  if (x < -4.97) return -1
  if (x > 4.97) return 1
  const x2 = x * x
  const a = x * (945 + x2 * (105 + x2))
  const b = 945 + x2 * (420 + x2 * 15)
  return a / b
}

function fastAtanh(x: number): number {
  const x2 = x * x
  const a = x * (945 + x2 * (-735 + x2 * 64))
  const b = 945 + x2 * (-1050 + x2 * 225)
  return a / b
}

export interface BpResult {
  /** Hard-decision codeword bits (0/1). */
  plain: Uint8Array
  /** Parity checks still failing; 0 means a valid codeword. */
  errors: number
}

/**
 * Belief-propagation (sum-product) decoder. `codeword[i]` is log(p(1)/p(0)) of bit i.
 * Port of bp_decode() from ft8_lib / WSJT-X bpdecode174.
 */
export function bpDecode(codeword: ArrayLike<number>, maxIters: number): BpResult {
  const tov = new Float64Array(LDPC_N * 3)
  const toc = new Float64Array(LDPC_M * 7)
  const plain = new Uint8Array(LDPC_N)
  let minErrors = LDPC_M

  for (let iter = 0; iter < maxIters; iter++) {
    let plainSum = 0
    for (let n = 0; n < LDPC_N; n++) {
      plain[n] = codeword[n] + tov[n * 3] + tov[n * 3 + 1] + tov[n * 3 + 2] > 0 ? 1 : 0
      plainSum += plain[n]
    }
    if (plainSum === 0) break // all-zero word is prohibited
    const errors = ldpcCheck(plain)
    if (errors < minErrors) {
      minErrors = errors
      if (errors === 0) break
    }
    for (let m = 0; m < LDPC_M; m++) {
      for (let k = 0; k < LDPC_NUM_ROWS[m]; k++) {
        const n = LDPC_NM[m][k] - 1
        let tnm = codeword[n]
        for (let mi = 0; mi < 3; mi++) {
          if (LDPC_MN[n][mi] - 1 !== m) tnm += tov[n * 3 + mi]
        }
        toc[m * 7 + k] = fastTanh(-tnm / 2)
      }
    }
    for (let n = 0; n < LDPC_N; n++) {
      for (let mi = 0; mi < 3; mi++) {
        const m = LDPC_MN[n][mi] - 1
        let tmn = 1
        for (let k = 0; k < LDPC_NUM_ROWS[m]; k++) {
          if (LDPC_NM[m][k] - 1 !== n) tmn *= toc[m * 7 + k]
        }
        tov[n * 3 + mi] = -2 * fastAtanh(tmn)
      }
    }
  }
  return { plain, errors: minErrors }
}
