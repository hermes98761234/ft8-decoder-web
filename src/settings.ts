export type Lang = 'en' | 'uk'
export type Theme = 'auto' | 'light' | 'dark'

export interface Settings {
  lang: Lang
  theme: Theme
  myCall: string
  myGrid: string
  unit: 'km' | 'mi'
  cqOnly: boolean
  mapFit: boolean
  /** Correction added to the device clock, milliseconds. */
  clockOffsetMs: number
  txFreq: number
  deviceId: string
}

const KEY = 'ft8-decoder-web:settings'

export const DEFAULT_SETTINGS: Settings = {
  lang: 'en',
  theme: 'auto',
  myCall: '',
  myGrid: 'KO50',
  unit: 'km',
  cqOnly: false,
  mapFit: true,
  clockOffsetMs: 0,
  txFreq: 1500,
  deviceId: '',
}

export function loadSettings(): Settings {
  const base: Settings = { ...DEFAULT_SETTINGS, lang: typeof navigator !== 'undefined' && navigator.language?.startsWith('uk') ? 'uk' : 'en' }
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return base
    const s = JSON.parse(raw) as Partial<Settings>
    return {
      lang: s.lang === 'uk' || s.lang === 'en' ? s.lang : base.lang,
      theme: s.theme === 'light' || s.theme === 'dark' || s.theme === 'auto' ? s.theme : base.theme,
      myCall: typeof s.myCall === 'string' ? s.myCall.toUpperCase().slice(0, 12) : base.myCall,
      myGrid: typeof s.myGrid === 'string' ? s.myGrid.toUpperCase().slice(0, 6) : base.myGrid,
      unit: s.unit === 'mi' ? 'mi' : 'km',
      cqOnly: s.cqOnly === true,
      mapFit: s.mapFit !== false,
      clockOffsetMs: Number.isFinite(s.clockOffsetMs) ? Math.max(-5000, Math.min(5000, Number(s.clockOffsetMs))) : 0,
      txFreq: Number.isFinite(s.txFreq) ? Math.max(200, Math.min(2900, Number(s.txFreq))) : base.txFreq,
      deviceId: typeof s.deviceId === 'string' ? s.deviceId : '',
    }
  } catch {
    return base
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // storage unavailable (private mode): settings just are not remembered
  }
}
