/** FT8 protocol constants (see the WSJT-X FT8 paper and kgoba/ft8_lib). */
export const FT8_SYMBOL_PERIOD = 0.16
export const FT8_SLOT_TIME = 15
export const FT8_ND = 58
export const FT8_NN = 79
export const FT8_LENGTH_SYNC = 7
export const FT8_NUM_SYNC = 3
export const FT8_SYNC_OFFSET = 36
export const FT8_TONE_SPACING = 6.25
/** Duration of the transmitted signal in seconds (79 x 0.16). */
export const FT8_TX_TIME = FT8_NN * FT8_SYMBOL_PERIOD
/** Nominal start of the transmission inside a slot, seconds. */
export const FT8_TX_START = 0.5

export const LDPC_N = 174
export const LDPC_K = 91
export const LDPC_M = 83
export const LDPC_K_BYTES = 12
export const LDPC_N_BYTES = 22

export const CRC_POLYNOMIAL = 0x2757
export const CRC_WIDTH = 14

/** Costas 7x7 sync tone pattern. */
export const COSTAS = [3, 1, 4, 0, 6, 5, 2] as const
/** Gray code map: 3 bits -> tone. */
export const GRAY_MAP = [0, 1, 3, 2, 5, 6, 4, 7] as const

export const SAMPLE_RATE = 12000
