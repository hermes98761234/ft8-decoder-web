import type { T } from '../i18n'
import type { Entry } from '../entries'
import { entryKind, whereIs } from '../entries'
import type { Settings } from '../settings'

interface Props {
  entries: Entry[]
  gridBook: Map<string, string>
  settings: Settings
  selected: string | null
  onSelect: (key: string) => void
  t: T
}

export default function MessageList({ entries, gridBook, settings, selected, onSelect, t }: Props) {
  if (entries.length === 0) return <p className="hint pad">{t('Nothing decoded yet. Start listening, or try a sample recording.')}</p>
  const rows: React.ReactNode[] = []
  let lastSlot = ''
  for (const e of entries) {
    const slotKey = `${e.source}:${e.slotStart}:${e.label}`
    if (slotKey !== lastSlot) {
      lastSlot = slotKey
      const n = entries.filter((x) => `${x.source}:${x.slotStart}:${x.label}` === slotKey).length
      rows.push(
        <tr key={`h:${slotKey}`} className="slot-head">
          <td colSpan={6}>
            {e.label} {e.source === 'live' || e.source === 'sample' ? 'UTC' : ''} · {t('{0} decoded', n)}
            {e.source === 'sample' ? ` · ${t('sample recording')}` : e.source === 'demo' ? ` · ${t('synthetic')}` : e.source === 'tx' ? ` · ${t('encoder test')}` : ''}
          </td>
        </tr>,
      )
    }
    const kind = entryKind(e, settings.myCall)
    const theirGrid = e.grid ?? (e.from ? gridBook.get(e.from.replace(/^<|>$/g, '')) : undefined)
    const w = whereIs(settings.myGrid, theirGrid)
    const dist = w ? (settings.unit === 'km' ? `${Math.round(w.km)} ${t('km')}` : `${Math.round(w.km * 0.621371)} ${t('mi')}`) : ''
    rows.push(
      <tr key={e.key} className={`msg ${kind}${selected === e.key ? ' active' : ''}`} onClick={() => onSelect(e.key)}>
        <td className="num dim">{e.label.length > 5 ? e.label.slice(-8) : e.label}</td>
        <td className="num">{e.snr}</td>
        <td className="num hide-sm">{e.dt.toFixed(1)}</td>
        <td className="num">{Math.round(e.freq)}</td>
        <td className="text">{e.text}</td>
        <td className="num dim hide-sm" title={w ? `${Math.round(w.bearing)}°` : ''}>
          {dist}
        </td>
      </tr>,
    )
  }
  return (
    <div className="msg-scroll">
      <table className="data msgs">
        <thead>
          <tr>
            <th>{t('Time')}</th>
            <th>SNR</th>
            <th className="hide-sm">DT</th>
            <th>{t('Hz')}</th>
            <th>{t('Message')}</th>
            <th className="hide-sm">{t('Distance')}</th>
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
  )
}
