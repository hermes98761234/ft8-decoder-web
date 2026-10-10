const STOPS: [number, [number, number, number]][] = [
  [0, [6, 7, 24]],
  [0.3, [28, 36, 140]],
  [0.55, [0, 168, 176]],
  [0.75, [240, 214, 52]],
  [0.9, [255, 110, 24]],
  [1, [255, 248, 230]],
]

/** 256-entry RGB lookup table (RGBA bytes) for the waterfall. */
export const LUT: Uint8ClampedArray = (() => {
  const out = new Uint8ClampedArray(256 * 4)
  for (let i = 0; i < 256; i++) {
    const x = i / 255
    let k = 1
    while (k < STOPS.length - 1 && x > STOPS[k][0]) k++
    const [x0, c0] = STOPS[k - 1]
    const [x1, c1] = STOPS[k]
    const f = Math.min(1, Math.max(0, (x - x0) / (x1 - x0)))
    for (let c = 0; c < 3; c++) out[i * 4 + c] = c0[c] + (c1[c] - c0[c]) * f
    out[i * 4 + 3] = 255
  }
  return out
})()
