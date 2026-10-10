/** Minimal TopoJSON decoder: polygon rings of a feature (world-atlas land layer) as lon/lat arrays. */
interface Topology {
  transform: { scale: [number, number]; translate: [number, number] }
  arcs: number[][][]
  objects: Record<string, { type: string; geometries: { type: string; arcs: number[][][] | number[][] }[] }>
}

export type Ring = [number, number][]

export function decodeLand(topo: Topology, object = 'land'): Ring[] {
  const { scale, translate } = topo.transform
  const arcs: Ring[] = topo.arcs.map((arc) => {
    let x = 0
    let y = 0
    return arc.map(([dx, dy]) => {
      x += dx
      y += dy
      return [x * scale[0] + translate[0], y * scale[1] + translate[1]] as [number, number]
    })
  })
  const arcPoints = (i: number): Ring => (i >= 0 ? arcs[i] : arcs[~i].slice().reverse())
  const ringPoints = (ring: number[]): Ring => {
    const pts: Ring = []
    for (const i of ring) {
      const a = arcPoints(i)
      pts.push(...(pts.length ? a.slice(1) : a))
    }
    return pts
  }
  const out: Ring[] = []
  const obj = topo.objects[object]
  const geoms = obj.type === 'GeometryCollection' ? obj.geometries : [obj as unknown as (typeof obj.geometries)[number]]
  for (const g of geoms) {
    if (g.type === 'Polygon') for (const r of g.arcs as number[][]) out.push(ringPoints(r))
    else if (g.type === 'MultiPolygon') for (const poly of g.arcs as number[][][]) for (const r of poly) out.push(ringPoints(r))
  }
  return out
}
