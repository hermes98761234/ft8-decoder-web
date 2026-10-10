import type { Lang } from './settings'

export type T = (s: string, ...args: (string | number)[]) => string

/** Marks a string for translation where it is defined away from its t() call. */
export const N = (s: string) => s

/** English source string -> Ukrainian. `{0}`, `{1}` are placeholders for interpolated values. */
export const UK: Record<string, string> = {
  'FT8 Decoder': 'FT8-декодер',
  'Decode FT8 amateur radio signals from your microphone, in the browser.': 'Декодуйте радіоаматорські сигнали FT8 з мікрофона просто в браузері.',
  Language: 'Мова',
  Theme: 'Тема',
  System: 'Системна',
  Light: 'Світла',
  Dark: 'Темна',
  Receiver: 'Приймач',
  slot: 'слот',
  'even (:00/:30)': 'парний (:00/:30)',
  'odd (:15/:45)': 'непарний (:15/:45)',
  'Time within the 15 s slot': 'Час у межах 15-секундного слоту',
  'Start listening': 'Почати прослуховування',
  'Stop listening': 'Зупинити',
  'Input device': 'Пристрій введення',
  Default: 'Типовий',
  Input: 'Вхід',
  'Decoding…': 'Декодування…',
  'Not listening.': 'Не слухаємо.',
  'Listening. Next decode in {0} s.': 'Слухаємо. Наступне декодування за {0} с.',
  'Microphone access was denied.': 'Доступ до мікрофона заборонено.',
  'No audio input device found.': 'Не знайдено пристрою введення звуку.',
  'Last slot: {0} candidates, decoded in {1} ms.': 'Останній слот: кандидатів {0}, декодовано за {1} мс.',
  'Or decode without a radio': 'Або декодуйте без радіо',
  'Sample 1': 'Зразок 1',
  'Sample 2': 'Зразок 2',
  'Synthetic busy band': 'Синтетичний завантажений діапазон',
  'Open audio file…': 'Відкрити аудіофайл…',
  'Sample recordings are real 20 m FT8 off-air audio from the ft8_lib test set.': 'Зразки — справжні ефірні записи FT8 на 20 м з тестового набору ft8_lib.',
  Settings: 'Налаштування',
  'My callsign': 'Мій позивний',
  'My grid square': 'Мій квадрат',
  Distance: 'Відстань',
  km: 'км',
  mi: 'миль',
  'Clock correction (ms)': 'Корекція годинника (мс)',
  'FT8 slots start at :00, :15, :30 and :45 UTC. Keep your device clock synchronised (NTP); an error of up to about a second is tolerated.':
    'Слоти FT8 починаються о :00, :15, :30 і :45 за UTC. Синхронізуйте годинник пристрою (NTP); похибка до секунди допустима.',
  'Reset settings': 'Скинути налаштування',
  Waterfall: 'Водоспад',
  'Start listening or pick a sample to see the signals.': 'Почніть слухати або оберіть зразок, щоб побачити сигнали.',
  '0 to 3000 Hz. Boxes mark decoded signals (green CQ, yellow other, red involving you). Dashed line: encoder frequency.':
    '0–3000 Гц. Рамки позначають декодовані сигнали (зелені CQ, жовті інші, червоні — з вашою участю). Пунктир: частота кодера.',
  'Decoded messages': 'Декодовані повідомлення',
  'CQ only': 'Лише CQ',
  Download: 'Завантажити',
  Clear: 'Очистити',
  'Map of grid squares': 'Карта квадратів',
  'Zoom to stations': 'Масштабувати до станцій',
  'Map of decoded stations by Maidenhead grid square': 'Карта декодованих станцій за квадратами Мейденхеда',
  'Stations are placed at the centre of the grid square they sent. Lines are drawn from your grid on a flat map, not along the great circle.':
    'Станції розміщено в центрі квадрата, який вони передали. Лінії йдуть від вашого квадрата на пласкій карті, а не по ортодромі.',
  'Runs entirely in your browser: audio is never uploaded. Decoder is a TypeScript port of ft8_lib (MIT).':
    'Працює повністю у вашому браузері: звук нікуди не надсилається. Декодер — порт ft8_lib (MIT) на TypeScript.',
  'Source on GitHub': 'Код на GitHub',
  // message list
  'Nothing decoded yet. Start listening, or try a sample recording.': 'Ще нічого не декодовано. Почніть слухати або спробуйте зразок запису.',
  '{0} decoded': 'декодовано: {0}',
  'sample recording': 'зразок запису',
  synthetic: 'синтетичний',
  'encoder test': 'тест кодера',
  Time: 'Час',
  Hz: 'Гц',
  Message: 'Повідомлення',
  // encoder
  Encoder: 'Кодер',
  'Builds a real FT8 signal: 77-bit message, CRC-14, LDPC(174,91), 8-FSK with Gaussian shaping.':
    'Створює справжній сигнал FT8: 77-бітне повідомлення, CRC-14, LDPC(174,91), 8-FSK з гаусовим формуванням.',
  'Audio frequency': 'Звукова частота',
  'Type a message.': 'Введіть повідомлення.',
  'Too long: free text is limited to 13 characters (0-9 A-Z + - . / ?).': 'Задовге: вільний текст — до 13 символів (0-9 A-Z + - . / ?).',
  'Not a valid FT8 message.': 'Недійсне повідомлення FT8.',
  'Packs as': 'Пакується як',
  'Standard message': 'Стандартне повідомлення',
  'Non-standard callsign': 'Нестандартний позивний',
  'Free text': 'Вільний текст',
  Telemetry: 'Телеметрія',
  Unsupported: 'Не підтримується',
  'Tone sequence': 'Послідовність тонів',
  Stop: 'Стоп',
  Play: 'Відтворити',
  'Save WAV': 'Зберегти WAV',
  'Start at next slot': 'Почати з наступного слоту',
  'Decode it back': 'Декодувати назад',
  'with noise at SNR': 'з шумом при SNR',
  'Decoded: {0} (SNR {1} dB, DT {2} s, {3} Hz) in {4} ms': 'Декодовано: {0} (SNR {1} дБ, DT {2} с, {3} Гц) за {4} мс',
  'Not decoded at this SNR.': 'При такому SNR не декодується.',
  'Radio transmission needs an amateur licence. This tool only produces audio; you feed it to your own rig.':
    'Радіопередача потребує аматорської ліцензії. Цей застосунок лише створює звук, який ви самі подаєте на свою радіостанцію.',
}

export function tr(lang: Lang, s: string, ...args: (string | number)[]): string {
  const src = lang === 'uk' ? (UK[s] ?? s) : s
  return src.replace(/\{(\d+)\}/g, (_, i: string) => String(args[+i]))
}
