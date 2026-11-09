import { StrictMode, useMemo, useState } from 'react'
import { act, render, renderHook, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { BlockNoteEditor } from '@blocknote/core'
import useNoteBlockDrag from '@/features/notes/components/useNoteBlockDrag'

function Controls({ editor }: { editor: BlockNoteEditor }) {
  useNoteBlockDrag(editor)
  return <><button>Drag or open block menu</button><button>Add block</button></>
}
function HoveredBlock() {
  const [visible, setVisible] = useState(true)
  // SideMenuExtension.unfreezeMenu hides its floating controls. Model that
  // public contract so StrictMode exercises the actual disappearance path.
  const editor = useMemo(() => ({ getExtension: () => ({ unfreezeMenu: () => setVisible(false) }) }) as unknown as BlockNoteEditor, [])
  return visible ? <Controls editor={editor} /> : null
}
it('keeps hovered controls visible through StrictMode effect replay without an active drag', () => {
  render(<StrictMode><HoveredBlock /></StrictMode>)
  expect(screen.getByRole('button', { name: 'Drag or open block menu' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Add block' })).toBeVisible()
})

it('keeps the original handle mounted between pointerup and its menu-opening click', () => {
  const menu = { freezeMenu: vi.fn(), unfreezeMenu: vi.fn() }
  const editor = { getExtension: () => menu, isEditable: true } as unknown as BlockNoteEditor
  const { result } = renderHook(() => useNoteBlockDrag(editor))
  const handle = { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn(), hasPointerCapture: () => true }
  const event = { button: 0, isPrimary: true, clientX: 10, clientY: 10, pointerId: 1, currentTarget: handle, preventDefault() {}, stopPropagation() {} } as unknown as React.PointerEvent<HTMLButtonElement>
  act(() => result.current.start(event, 'block'))
  act(() => result.current.end(event))
  expect(handle.releasePointerCapture).toHaveBeenCalledWith(1)
  expect(menu.freezeMenu).toHaveBeenCalledOnce()
  expect(menu.unfreezeMenu).not.toHaveBeenCalled()
  expect(result.current.consumeClick()).toBe(false)
})
