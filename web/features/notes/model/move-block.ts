import type { NoteBlock } from '@/lib/notes-api'

export type NoteDropZone = 'before' | 'after' | 'left' | 'right' | 'wrap' | 'inside'
export const isNoteToggle = (block: NoteBlock) => block.type === 'toggleHeading' || block.type === 'toggleListItem' || (block.type === 'heading' && block.props.isToggleable === true)
export function findNoteBlock(items: NoteBlock[], id: string): NoteBlock | undefined {
  for (const block of items) {
    if (block.id === id) return block
    const child = findNoteBlock(block.children || [], id)
    if (child) return child
  }
}
export function canMoveNoteBlock(blocks: NoteBlock[], sourceId: string, targetId: string, zone: NoteDropZone = 'after') {
  const source = findNoteBlock(blocks, sourceId), target = findNoteBlock(blocks, targetId)
  return !!source && !!target && !['noteColumn'].includes(source.type) && !['noteColumn', 'noteColumns'].includes(target.type)
    && sourceId !== targetId && !findNoteBlock(source.children || [], targetId) && (zone !== 'inside' || isNoteToggle(target))
}
/** Thin top/bottom strips sort; the remaining left/centre/right regions arrange content. */
export function noteDropZone(x: number, y: number, width: number, height: number, toggle: boolean): NoteDropZone {
  const edge = Math.min(12, height * .2)
  if (y < edge) return 'before'
  if (y > height - edge) return 'after'
  if (x < width * .25) return 'left'
  if (x > width * .75) return 'right'
  return toggle ? 'inside' : 'wrap'
}
/** Dissolve layout-only wrappers after their last peer moves away. Never unwrap a toggle. */
function normalizeLayouts(items: NoteBlock[]): NoteBlock[] {
  return items.flatMap(block => {
    if (block.children) block.children = normalizeLayouts(block.children)
    if (block.type !== 'noteColumns') return [block]
    block.children = (block.children || []).filter(column => column.children?.length)
    if (block.children.length < 2) return block.children.flatMap(column => column.children || [])
    return [block]
  })
}
/** Move intact subtrees. Only new layout containers receive new IDs. */
export function moveNoteBlock(blocks: NoteBlock[], sourceId: string, targetId: string, zone: NoteDropZone) {
  if (!canMoveNoteBlock(blocks, sourceId, targetId, zone)) return null
  const result = structuredClone(blocks)
  const source = findNoteBlock(result, sourceId)!
  const remove = (items: NoteBlock[]): boolean => {
    const index = items.findIndex(block => block.id === sourceId)
    if (index >= 0) { items.splice(index, 1); return true }
    return items.some(block => remove(block.children || []))
  }
  const insert = (items: NoteBlock[]): boolean => {
    const index = items.findIndex(block => block.id === targetId)
    if (index < 0) return items.some(block => insert(block.children || []))
    const target = items[index]
    if (zone === 'inside') {
      target.children = [...(target.children || []), source]
      target.props.collapsed = false
    } else if (zone === 'before' || zone === 'after') {
      items.splice(index + Number(zone === 'after'), 0, source)
    } else {
      const column = (block: NoteBlock): NoteBlock => ({ id: crypto.randomUUID(), type: 'noteColumn', props: {}, children: [block] })
      items.splice(index, 1, { id: crypto.randomUUID(), type: 'noteColumns', props: { mode: zone === 'wrap' ? 'wrap' : 'columns' },
        children: (zone === 'right' ? [target, source] : [source, target]).map(column) })
    }
    return true
  }
  remove(result)
  insert(result)
  return normalizeLayouts(result)
}
