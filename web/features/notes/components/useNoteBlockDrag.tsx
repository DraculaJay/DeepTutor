'use client'

import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { closeHistory } from '@tiptap/pm/history'
import { SideMenuExtension } from '@blocknote/core/extensions'
import type { BlockNoteEditor, BlockSchema, InlineContentSchema, StyleSchema } from '@blocknote/core'
import type { NoteBlock } from '@/lib/notes-api'
import { canMoveNoteBlock, findNoteBlock, isNoteToggle, moveNoteBlock, noteDropZone, type NoteDropZone } from '../model/move-block'

import { sendWrapDrag } from './NoteColumnsFrame'

type Drop = { id: string; zone: NoteDropZone; x: number; y: number; width: number; height: number }
export default function useNoteBlockDrag<B extends BlockSchema, I extends InlineContentSchema, S extends StyleSchema>(editor: BlockNoteEditor<B, I, S>) {
  const gesture = useRef<{ id: string; x: number; y: number; moved: boolean; pointer: number; handle: HTMLButtonElement; wrap: HTMLElement | null } | null>(null)
  const suppressClick = useRef(false)
  const pointer = useRef({ x: 0, y: 0 })
  const animation = useRef<number | null>(null)
  const [drop, setDrop] = useState<Drop | null>(null)
  const menu = editor.getExtension(SideMenuExtension)
  const cancel = useCallback(() => {
    const current = gesture.current
    // Effect cleanup also runs on StrictMode mount replay. With no drag,
    // unfreezing would hide the menu that has just mounted.
    if (!current) return
    gesture.current = null
    if (current.wrap) sendWrapDrag(current.wrap, { phase: 'cancel', ...pointer.current })
    if (animation.current !== null) cancelAnimationFrame(animation.current)
    animation.current = null
    if (current?.handle.hasPointerCapture(current.pointer)) current.handle.releasePointerCapture(current.pointer)
    setDrop(null)
    menu?.unfreezeMenu()
  }, [menu])
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel() }
    window.addEventListener('keydown', escape)
    window.addEventListener('blur', cancel)
    return () => {
      window.removeEventListener('keydown', escape)
      window.removeEventListener('blur', cancel)
      cancel()
    }
  }, [cancel])
  const inWrap = (x: number, y: number) => {
    const wrap = gesture.current?.wrap
    if (!wrap) return false
    const rect = wrap.getBoundingClientRect()
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
  }
  const destination = (x: number, y: number): Drop | null => {
    if (inWrap(x, y)) return null
    const element = document.elementFromPoint(x, y)?.closest<HTMLElement>('.bn-block-outer[data-id]')
    if (!element || !editor.domElement?.contains(element) || !gesture.current) return null
    const id = element.dataset.id!
    const block = findNoteBlock(editor.document as NoteBlock[], id)
    if (!block) return null
    const content = element.querySelector<HTMLElement>(':scope > .bn-block > .bn-block-content') || element.querySelector<HTMLElement>('.bn-block-content') || element
    const rect = content.getBoundingClientRect()
    const zone = noteDropZone(x - rect.left, y - rect.top, rect.width, rect.height, isNoteToggle(block))
    if (!canMoveNoteBlock(editor.document as NoteBlock[], gesture.current.id, id, zone)) return null
    return { id, zone, x: rect.left, y: zone === 'after' ? element.getBoundingClientRect().bottom : rect.top, width: rect.width, height: rect.height }
  }
  const scroll = () => {
    if (!gesture.current?.moved) return
    const scroller = editor.domElement?.closest('main')
    if (scroller) {
      const rect = scroller.getBoundingClientRect(), { x, y } = pointer.current
      if (x >= rect.left && x <= rect.right) {
        if (y < rect.top + 36) scroller.scrollTop -= 12
        if (y > rect.bottom - 36) scroller.scrollTop += 12
      }
      setDrop(destination(x, y))
    }
    animation.current = requestAnimationFrame(scroll)
  }
  return {
    consumeClick: () => {
      const consumed = suppressClick.current
      suppressClick.current = false
      return consumed
    },
    start: (event: PointerEvent<HTMLButtonElement>, id: string) => {
      if (event.button !== 0 || !event.isPrimary || !editor.isEditable) return
      cancel()
      suppressClick.current = false
      const source = editor.domElement?.querySelector<HTMLElement>(`.bn-block-outer[data-id="${CSS.escape(id)}"]`)
      const column = source?.closest<HTMLElement>('.node-noteColumn')
      const layout = column?.parentElement?.closest<HTMLElement>('.dt-note-columns[data-layout="wrap"]')
      const wrap = layout?.querySelector(':scope > [data-node-view-content-react] > .node-noteColumn:first-child') === column ? layout || null : null
      gesture.current = { id, x: event.clientX, y: event.clientY, moved: false, pointer: event.pointerId, handle: event.currentTarget, wrap }
      if (wrap) sendWrapDrag(wrap, { phase: 'start', x: event.clientX, y: event.clientY })
      pointer.current = { x: event.clientX, y: event.clientY }
      menu?.freezeMenu()
      event.currentTarget.setPointerCapture(event.pointerId)
      event.preventDefault()
      event.stopPropagation()
    },
    move: (event: PointerEvent<HTMLButtonElement>) => {
      const current = gesture.current
      if (!current || current.pointer !== event.pointerId) return
      pointer.current = { x: event.clientX, y: event.clientY }
      if (!current.moved && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 5) return
      if (!current.moved) { current.moved = true; animation.current = requestAnimationFrame(scroll) }
      suppressClick.current = true
      event.preventDefault()
      if (current.wrap) sendWrapDrag(current.wrap, { phase: inWrap(event.clientX, event.clientY) ? 'move' : 'leave', x: event.clientX, y: event.clientY })
      setDrop(destination(event.clientX, event.clientY))
    },
    end: (event: PointerEvent<HTMLButtonElement>) => {
      const current = gesture.current
      if (!current || current.pointer !== event.pointerId) return
      if (!current.moved) {
        // Keep the handle mounted until its following click opens the original menu.
        if (current.wrap) sendWrapDrag(current.wrap, { phase: 'cancel', ...pointer.current })
        gesture.current = null
        if (current.handle.hasPointerCapture(current.pointer)) current.handle.releasePointerCapture(current.pointer)
        return
      }
      if (current.wrap && inWrap(event.clientX, event.clientY)) {
        sendWrapDrag(current.wrap, { phase: 'commit', x: event.clientX, y: event.clientY })
        current.wrap = null
        cancel()
        return
      }
      if (current.wrap) { sendWrapDrag(current.wrap, { phase: 'cancel', ...pointer.current }); current.wrap = null }
      const target = destination(event.clientX, event.clientY)
      if (target) {
        const blocks = moveNoteBlock(editor.document as NoteBlock[], current.id, target.id, target.zone)
        if (blocks) {
          editor.transact(tr => { closeHistory(tr); editor.replaceBlocks(editor.document, blocks as typeof editor.document) })
          editor.transact(tr => closeHistory(tr))
          editor.setTextCursorPosition(current.id, 'start')
          editor.focus()
        }
      }
      cancel()
    },
    cancel,
    indicator: drop && createPortal(<div aria-hidden="true" className={`dt-note-drop-preview is-${drop.zone}`}
      style={{ left: drop.zone === 'right' ? drop.x + drop.width : drop.x, top: drop.y, width: drop.zone === 'left' || drop.zone === 'right' ? 3 : drop.width, height: drop.zone === 'before' || drop.zone === 'after' ? 3 : drop.height }}>
      <span>{({ before: '移到上方', after: '移到下方', left: '左侧并排', right: '右侧并排', wrap: '环绕组合', inside: '放入折叠列表' })[drop.zone]}</span>
    </div>, document.body),
  }
}
