import { CRC_POLYNOMIAL, CRC_WIDTH } from './constants'

const TOPBIT = 1 << (CRC_WIDTH - 1)

/** 14-bit CRC (polynomial 0x2757) over `numBits` bits of `message`, MSB first. */
export function computeCrc(message: Uint8Array, numBits: number): number {
  let remainder = 0
  let idxByte = 0
  for (let idxBit = 0; idxBit < numBits; idxBit++) {
    if (idxBit % 8 === 0) {
      remainder ^= message[idxByte++] << (CRC_WIDTH - 8)
    }
    remainder = remainder & TOPBIT ? (remainder << 1) ^ CRC_POLYNOMIAL : remainder << 1
    remainder &= (TOPBIT << 1) - 1
  }
  return remainder
}

/** The 14 CRC bits stored after the 77 payload bits of a 91-bit block. */
export function extractCrc(a91: Uint8Array): number {
  return ((a91[9] & 0x07) << 11) | (a91[10] << 3) | (a91[11] >> 5)
}

/** 77-bit payload (10 bytes) -> 91 bits (12 bytes): payload followed by its CRC. */
export function addCrc(payload: Uint8Array): Uint8Array {
  const a91 = new Uint8Array(12)
  a91.set(payload.subarray(0, 10))
  a91[9] &= 0xf8
  a91[10] = 0
  // The CRC is calculated on the message zero-extended from 77 to 82 bits.
  const crc = computeCrc(a91, 96 - 14)
  a91[9] |= crc >> 11
  a91[10] = (crc >> 3) & 0xff
  a91[11] = (crc << 5) & 0xff
  return a91
}
