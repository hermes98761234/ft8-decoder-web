/** Character tables used by the FT8 message packing (ported from ft8_lib text.c). */
export type CharTable = 'full' | 'alnumSpaceSlash' | 'alnumSpace' | 'lettersSpace' | 'alnum' | 'numeric'

export function charn(c: number, table: CharTable): string {
  if (table !== 'alnum' && table !== 'numeric') {
    if (c === 0) return ' '
    c -= 1
  }
  if (table !== 'lettersSpace') {
    if (c < 10) return String.fromCharCode(48 + c)
    c -= 10
  }
  if (table !== 'numeric') {
    if (c < 26) return String.fromCharCode(65 + c)
    c -= 26
  }
  if (table === 'full') {
    if (c < 5) return '+-./?'[c]
  } else if (table === 'alnumSpaceSlash') {
    if (c === 0) return '/'
  }
  return '_'
}

/** Inverse of charn; -1 when the character is not in the table. */
export function nchar(ch: string, table: CharTable): number {
  let n = 0
  if (table !== 'alnum' && table !== 'numeric') {
    if (ch === ' ') return 0
    n += 1
  }
  if (table !== 'lettersSpace') {
    if (ch >= '0' && ch <= '9') return n + ch.charCodeAt(0) - 48
    n += 10
  }
  if (table !== 'numeric') {
    if (ch >= 'A' && ch <= 'Z') return n + ch.charCodeAt(0) - 65
    n += 26
  }
  if (table === 'full') {
    const i = '+-./?'.indexOf(ch)
    if (i >= 0 && ch.length === 1) return n + i
  } else if (table === 'alnumSpaceSlash') {
    if (ch === '/') return n
  }
  return -1
}
