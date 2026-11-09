'use client'

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { NoteBlock } from '@/lib/notes-api'
import { noteColumnTracks } from '../model/move-block'
import { closeHistory } from '@tiptap/pm/history'
import { wrapAnchors, nearestWrapAnchor, type WrapAnchor } from '../model/wrap-position'

export type WrapPosition = { mode: 'columns' | 'wrap'; wrapX: number; wrapY: number; wrapHeight: number; wrapAnchor: string }
type Props = {
  block: { id: string; props: WrapPosition; children: NoteBlock[] }
  editor: { isEditable: boolean; updateBlock: (id: string, update: { props: Partial<WrapPosition> }) => unknown; transact: (callback: (tr: Parameters<typeof closeHistory>[0]) => void) => unknown }
  slotRef: (element: HTMLElement | null) => void
}
export type WrapDragEvent = { phase: 'start' | 'move' | 'commit' | 'cancel' | 'leave'; x: number; y: number }
export function sendWrapDrag(element: HTMLElement, detail: WrapDragEvent) {
  element.dispatchEvent(new CustomEvent('dt-note-wrap-drag', { detail }))
}

/** Position only the floating column. The original child node views stay mounted. */
export default function NoteColumnsFrame({ block, editor, slotRef }: Props) {
  const root = useRef<HTMLDivElement>(null)
  const [anchors, setAnchors] = useState<WrapAnchor[]>([])
  const [candidate, setCandidate] = useState('')
  const [snapped, setSnapped] = useState(false)
  const ref = useCallback((element: HTMLDivElement | null) => { root.current = element; slotRef(element) }, [slotRef])
  useEffect(() => {
    const element = root.current!
    if (block.props.mode !== 'wrap') return
    const floating = () => element.querySelector<HTMLElement>(':scope > [data-node-view-content-react] > .node-noteColumn:first-child .dt-note-column')
    let position = { x: block.props.wrapX, y: block.props.wrapY, height: block.props.wrapHeight, anchor: block.props.wrapAnchor }
    let drag: { x: number; y: number; originX: number; originY: number; width: number; height: number; itemWidth: number; itemHeight: number } | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let active: WrapAnchor | undefined
    const clearDwell = () => { clearTimeout(timer); active = undefined; delete element.dataset.wrapSnapped; setCandidate(''); setSnapped(false) }
    const draw = () => {
      const item = floating()
      if (!item) return
      const width = element.clientWidth, itemWidth = width * .4, itemHeight = item.offsetHeight
      element.style.setProperty('--wrap-left', `${(width - itemWidth) * position.x / 100}px`)
      element.style.setProperty('--wrap-top', `${position.y}px`)
      element.style.setProperty('--wrap-min-height', `${Math.max(position.height, position.y + itemHeight)}px`)
      element.dispatchEvent(new CustomEvent('dt-note-wrap-layout', { bubbles: true }))
    }
    const stop = () => { drag = null; clearDwell(); setAnchors([]); delete element.dataset.wrapDragging }
    const listener = (event: Event) => {
      const { phase, x, y } = (event as CustomEvent<WrapDragEvent>).detail
      if (phase === 'start') {
        const item = floating()
        if (!item || !editor.isEditable) return
        const bounds = element.getBoundingClientRect(), itemBounds = item.getBoundingClientRect()
        drag = { x: x - bounds.left, y: y - bounds.top, originX: itemBounds.left - bounds.left, originY: itemBounds.top - bounds.top,
          width: bounds.width, height: Math.max(bounds.height, itemBounds.height), itemWidth: itemBounds.width, itemHeight: itemBounds.height }
        return
      }
      if (!drag) return
      if (phase === 'leave') { clearDwell(); return }
      if (phase === 'cancel') {
        position = { x: block.props.wrapX, y: block.props.wrapY, height: block.props.wrapHeight, anchor: block.props.wrapAnchor }
        stop(); draw(); return
      }
      if (phase === 'commit') {
        editor.transact(tr => { closeHistory(tr); editor.updateBlock(block.id, { props: {
          wrapX: position.x, wrapY: position.y, wrapHeight: position.height, wrapAnchor: position.anchor,
        } }) })
        editor.transact(tr => closeHistory(tr))
        stop(); return
      }
      element.dataset.wrapDragging = 'true'
      const points = wrapAnchors(drag.width, drag.height, drag.itemWidth, drag.itemHeight)
      setAnchors(points)
      const left = Math.max(0, Math.min(drag.width - drag.itemWidth, drag.originX + x - element.getBoundingClientRect().left - drag.x))
      const top = Math.max(0, Math.min(drag.height - drag.itemHeight, drag.originY + y - element.getBoundingClientRect().top - drag.y))
      position = { x: left / Math.max(1, drag.width - drag.itemWidth) * 100, y: top, height: drag.height, anchor: '' }
      const nearest = nearestWrapAnchor(points, left, top)
      if (nearest?.id !== active?.id) {
        clearDwell()
        active = nearest
        if (nearest) {
          setCandidate(nearest.id)
          timer = setTimeout(() => {
            position = { x: nearest.x / Math.max(1, drag!.width - drag!.itemWidth) * 100, y: nearest.y, height: drag!.height, anchor: nearest.id }
            element.dataset.wrapSnapped = nearest.id; setSnapped(true); draw()
          }, 3000)
        }
      } else if (nearest && position.anchor === '') {
        // Keep a completed snap while the pointer remains in its attraction zone.
        if (element.dataset.wrapSnapped === nearest.id) position = { ...position, x: nearest.x / Math.max(1, drag.width - drag.itemWidth) * 100, y: nearest.y, anchor: nearest.id }
      }
      element.dataset.wrapSnapped = position.anchor
      draw()
    }
    element.addEventListener('dt-note-wrap-drag', listener)
    let previous = ''
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      const size = `${element.clientWidth}:${floating()?.offsetHeight}`
      if (size !== previous) { previous = size; if (!drag) draw() }
    })
    resize?.observe(element)
    const item = floating()
    if (item) resize?.observe(item)
    draw()
    return () => { clearTimeout(timer); resize?.disconnect(); element.removeEventListener('dt-note-wrap-drag', listener) }
  }, [block.id, block.props.mode, block.props.wrapX, block.props.wrapY, block.props.wrapHeight, block.props.wrapAnchor, editor])
  return <div className="dt-note-columns" data-layout={block.props.mode} ref={ref}
    style={{ '--note-column-count': block.children.reduce((sum, child) => sum + noteColumnTracks(child), 0) } as CSSProperties}>
    {anchors.length > 0 && <div className="dt-note-wrap-anchors" contentEditable={false} aria-hidden="true">
      {anchors.map(point => <i key={point.id} data-active={candidate === point.id} data-snapped={candidate === point.id && snapped}
        style={{ left: `${point.edgeX * 100}%`, top: `${point.edgeY * 100}%` }} />)}
    </div>}
  </div>
}
