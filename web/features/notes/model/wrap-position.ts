export type WrapAnchor = { id: string; x: number; y: number; edgeX: number; edgeY: number }
/** Eight border detents. Coordinates describe the content's top-left, not its centre. */
export function wrapAnchors(width: number, height: number, itemWidth: number, itemHeight: number): WrapAnchor[] {
  return [[0, 0], [.5, 0], [1, 0], [0, .5], [1, .5], [0, 1], [.5, 1], [1, 1]].map(([x, y]) => ({
    id: `${x}:${y}`, x: x * Math.max(0, width - itemWidth), y: y * Math.max(0, height - itemHeight), edgeX: x, edgeY: y,
  }))
}
export function nearestWrapAnchor(anchors: WrapAnchor[], x: number, y: number) {
  return anchors.filter(point => Math.hypot(point.x - x, point.y - y) <= 18)
    .sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0]
}
