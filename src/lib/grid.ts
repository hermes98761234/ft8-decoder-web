/** Maidenhead locator helpers. */

export interface LatLon {
  lat: number
  lon: number
}

/** Centre of a 4 or 6 character Maidenhead locator, or null if invalid. */
export function gridToLatLon(grid: string): LatLon | null {
  const g = grid.trim().toUpperCase()
  if (!/^[A-R]{2}[0-9]{2}([A-X]{2})?$/.test(g)) return null
  let lon = (g.charCodeAt(0) - 65) * 20 - 180 + (g.charCodeAt(2) - 48) * 2
  let lat = (g.charCodeAt(1) - 65) * 10 - 90 + (g.charCodeAt(3) - 48)
  if (g.length === 6) {
    lon += (g.charCodeAt(4) - 65) * (2 / 24) + 1 / 24
    lat += (g.charCodeAt(5) - 65) * (1 / 24) + 1 / 48
  } else {
    lon += 1
    lat += 0.5
  }
  return { lat, lon }
}

/** 4-character locator for a position. */
export function latLonToGrid(p: LatLon): string {
  const lon = Math.min(179.999, Math.max(-180, p.lon)) + 180
  const lat = Math.min(89.999, Math.max(-90, p.lat)) + 90
  return (
    String.fromCharCode(65 + Math.floor(lon / 20), 65 + Math.floor(lat / 10)) +
    Math.floor((lon % 20) / 2) +
    Math.floor(lat % 10)
  )
}

const R_EARTH_KM = 6371

const rad = (d: number) => (d * Math.PI) / 180

/** Great-circle distance in km. */
export function distanceKm(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat)
  const dLon = rad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Initial bearing from a to b in degrees (0..360). */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const dLon = rad(b.lon - a.lon)
  const y = Math.sin(dLon) * Math.cos(rad(b.lat))
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(dLon)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}
