import { act, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import NoteColumnsFrame, { sendWrapDrag } from '@/features/notes/components/NoteColumnsFrame'
import { nearestWrapAnchor, wrapAnchors } from '@/features/notes/model/wrap-position'

afterEach(() => vi.useRealTimers())
it('provides eight border detents and ignores positions outside their attraction radius', () => {
  const points = wrapAnchors(500, 320, 200, 80)
  expect(points).toHaveLength(8)
  expect(nearestWrapAnchor(points, 298, 2)?.id).toBe('1:0')
  expect(nearestWrapAnchor(points, 80, 100)).toBeUndefined()
})
function setup() {
  const editor = { isEditable: true, updateBlock: vi.fn(), transact: (fn: (tr: Parameters<typeof import('@tiptap/pm/history').closeHistory>[0]) => void) => fn({ setMeta: vi.fn() } as unknown as Parameters<typeof import('@tiptap/pm/history').closeHistory>[0]) }
  const props = { mode: 'wrap' as const, wrapX: 50, wrapY: 70, wrapHeight: 320, wrapAnchor: '' }
  const view = render(<NoteColumnsFrame block={{ id: 'layout', props, children: [{ id: 'a', type: 'noteColumn', props: {} }, { id: 'b', type: 'noteColumn', props: {} }] }} editor={editor} slotRef={() => {}} />)
  const root = view.container.firstElementChild as HTMLElement
  root.insertAdjacentHTML('beforeend', '<div data-node-view-content-react><div class="node-noteColumn"><div class="dt-note-column"></div></div><div class="node-noteColumn"></div></div>')
  const object = root.querySelector<HTMLElement>('.dt-note-column')!
  Object.defineProperty(root, 'clientWidth', { value: 500 })
  Object.defineProperty(object, 'offsetHeight', { value: 80 })
  root.getBoundingClientRect = () => ({ left: 0, top: 0, width: 500, height: 320 }) as DOMRect
  object.getBoundingClientRect = () => ({ left: 150, top: 70, width: 200, height: 80 }) as DOMRect
  const send = (phase: 'start' | 'move' | 'commit' | 'cancel', x = 100, y = 100) => act(() => sendWrapDrag(root, { phase, x, y }))
  return { editor, root, send }
}
it('snaps only after three continuous seconds, commits once, and leaves content untouched', () => {
  vi.useFakeTimers()
  const { editor, root, send } = setup()
  send('start'); send('move', 250, 30)
  act(() => vi.advanceTimersByTime(2999))
  expect(root.querySelector('[data-snapped="true"]')).toBeNull()
  expect(editor.updateBlock).not.toHaveBeenCalled()
  act(() => vi.advanceTimersByTime(1))
  expect(root.querySelector('[data-snapped="true"]')).not.toBeNull()
  send('move', 251, 31) // A small pointer motion must not undo a completed snap.
  send('commit')
  expect(editor.updateBlock).toHaveBeenCalledExactlyOnceWith('layout', { props: { wrapX: 100, wrapY: 0, wrapHeight: 320, wrapAnchor: '1:0' } })
})
it('cancels dwell when leaving a detent and restores the original geometry on cancellation', () => {
  vi.useFakeTimers()
  const { editor, root, send } = setup()
  send('start'); send('move', 250, 30)
  act(() => vi.advanceTimersByTime(2900))
  send('move', 50, 100)
  act(() => vi.advanceTimersByTime(3000))
  expect(root.querySelector('[data-snapped="true"]')).toBeNull()
  send('cancel')
  expect(editor.updateBlock).not.toHaveBeenCalled()
  expect(root.style.getPropertyValue('--wrap-left')).toBe('150px')
  expect(root.style.getPropertyValue('--wrap-top')).toBe('70px')
  expect(root.querySelector('.dt-note-wrap-anchors')).toBeNull()
})
