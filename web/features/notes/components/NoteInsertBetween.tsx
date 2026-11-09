'use client'
import { useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus } from 'lucide-react'
import { SideMenuExtension, SuggestionMenu } from '@blocknote/core/extensions'
import { useTranslation } from 'react-i18next'
import type { NotesEditor } from './NoteEditor'

/** A gutter button at the block boundary; no editable nodes or spacer blocks. */
export default function NoteInsertBetween({ editor, blockId }: { editor: NotesEditor; blockId: string }) {
  const { t } = useTranslation()
  const [position, setPosition] = useState<{ x: number; y: number; width: number } | null>(null)
  useLayoutEffect(() => {
    const block = editor.domElement?.querySelector<HTMLElement>(`.bn-block-outer[data-id="${CSS.escape(blockId)}"]`)
    const scroller = editor.domElement?.closest('main')
    if (!block) return
    const measure = () => {
      const rect = block.getBoundingClientRect()
      const clip = scroller?.getBoundingClientRect()
      setPosition(rect.bottom > (clip?.top ?? 0) && rect.bottom < (clip?.bottom ?? window.innerHeight)
        ? { x: rect.left, y: rect.bottom + 2, width: rect.width } : null)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(block)
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
    }
  }, [editor, blockId])
  if (!position) return null
  return createPortal(<div className="dt-note-insert-between" style={{ left: position.x - 27, top: position.y - 10, width: position.width + 27 }}>
    <button type="button" aria-label={t('Insert block between blocks')} title={t('Insert block between blocks')}
      onPointerEnter={() => editor.getExtension(SideMenuExtension)?.freezeMenu()}
      onPointerLeave={() => editor.getExtension(SideMenuExtension)?.unfreezeMenu()}
      onMouseDown={event => event.preventDefault()}
      onClick={event => {
        const [block] = editor.insertBlocks([{ type: 'paragraph' }], blockId, event.altKey ? 'before' : 'after')
        if (block) editor.setTextCursorPosition(block.id, 'start')
        editor.focus()
        editor.getExtension(SideMenuExtension)?.unfreezeMenu()
        editor.getExtension(SuggestionMenu)?.openSuggestionMenu('/')
      }}><Plus size={14} /></button><span />
  </div>, document.body)
}
