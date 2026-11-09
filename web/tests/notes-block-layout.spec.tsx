import { afterEach, expect, it, vi } from 'vitest'
import { act, fireEvent, render } from '@testing-library/react'
import { BlockNoteEditor, BlockNoteSchema, defaultBlockSpecs } from '@blocknote/core'
import { BlockNoteViewRaw } from '@blocknote/react'
import { closeHistory } from '@tiptap/pm/history'
import { toggleListItem, toggleHeading, noteColumn, noteColumns } from '@/features/notes/components/NoteRichBlocks'
import { canMoveNoteBlock, findNoteBlock, moveNoteBlock, noteDropZone } from '@/features/notes/model/move-block'
import type { NoteBlock } from '@/lib/notes-api'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const block = (id: string, children: NoteBlock[] = []): NoteBlock => ({ id, type: 'paragraph', props: {}, content: [{ type: 'text', text: id, styles: { bold: true } }], children })
const schema = BlockNoteSchema.create({ blockSpecs: { ...defaultBlockSpecs, toggleListItem: toggleListItem(), toggleHeading: toggleHeading(), noteColumn: noteColumn(), noteColumns: noteColumns() } })
const editors: (typeof schema.BlockNoteEditor)[] = []
afterEach(() => editors.splice(0).forEach(editor => editor._tiptapEditor.destroy()))

it('separates reordering, side placement, wrapping and toggle nesting', () => {
  expect(noteDropZone(5, 2, 200, 80, false)).toBe('before')
  expect(noteDropZone(195, 79, 200, 80, false)).toBe('after')
  expect(noteDropZone(5, 40, 200, 80, false)).toBe('left')
  expect(noteDropZone(195, 40, 200, 80, false)).toBe('right')
  expect(noteDropZone(100, 40, 200, 80, false)).toBe('wrap')
  expect(noteDropZone(100, 40, 200, 80, true)).toBe('inside')
})
it('moves intact sourced subtrees through columns and wrap, and dissolves empty layout wrappers', () => {
  const source = block('source', [block('child')])
  source.props = { sourceId: 'lecture', sourceUrl: '/materials/lecture', metadata: '{"original":true}' }
  const original = [source, block('target'), block('last')]
  for (const zone of ['left', 'right', 'wrap'] as const) {
    const arranged = moveNoteBlock(original, 'source', 'target', zone)!
    expect(original).toEqual([source, block('target'), block('last')])
    expect(arranged[0].type).toBe('noteColumns')
    expect(arranged[0].props.mode).toBe(zone === 'wrap' ? 'wrap' : 'columns')
    expect(arranged[0].children!.map(column => column.children![0].id)).toEqual(zone === 'right' ? ['target', 'source'] : ['source', 'target'])
    expect(findNoteBlock(arranged, 'source')).toEqual(source)
    const out = moveNoteBlock(arranged, 'source', 'last', 'after')!
    expect(out).toEqual([block('target'), block('last'), source])
  }
  expect(moveNoteBlock(original, 'source', 'child', 'wrap')).toBeNull()
  expect(moveNoteBlock(original, 'source', 'target', 'inside')).toBeNull()
  expect(moveNoteBlock(original, 'missing', 'target', 'left')).toBeNull()
})
it('nests and extracts complete toggle subtrees without editing any child content', () => {
  const parent: NoteBlock = { ...block('parent'), type: 'toggleHeading', props: { level: 2, collapsed: true }, children: [block('existing')] }
  const nested: NoteBlock = { ...block('nested'), type: 'toggleListItem', props: { collapsed: true }, children: [block('answer', [block('formula')])] }
  const inside = moveNoteBlock([parent, nested, block('last')], 'nested', 'parent', 'inside')!
  expect(inside[0].props.collapsed).toBe(false)
  expect(inside[0].children!.map(item => item.id)).toEqual(['existing', 'nested'])
  expect(findNoteBlock(inside, 'nested')).toEqual(nested)
  expect(canMoveNoteBlock(inside, 'parent', 'answer', 'inside')).toBe(false)
  expect(moveNoteBlock(inside, 'nested', 'last', 'before')![1]).toEqual(nested)
  expect(JSON.parse(JSON.stringify(inside))).toEqual(inside)
})
it('round-trips spatial structure and collapsed state through the actual BlockNote schema and undo', async () => {
  const editor = BlockNoteEditor.create({ schema, initialContent: [{ id: 'toggle', type: 'toggleHeading', props: { collapsed: true }, content: 'Title', children: [{ id: 'inside', content: 'Child' }] }, { id: 'a', content: 'Source' }, { id: 'b', content: 'Target' }] })
  editors.push(editor)
  const view = render(<BlockNoteViewRaw editor={editor} sideMenu={false} formattingToolbar={false} slashMenu={false} />)
  await act(async () => {})
  const before = structuredClone(editor.document)
  const arranged = moveNoteBlock(before as NoteBlock[], 'a', 'b', 'wrap')!
  await act(async () => {
    editor.transact(tr => { closeHistory(tr); editor.replaceBlocks(editor.document, arranged as typeof editor.document) })
    editor.transact(tr => closeHistory(tr))
  })
  const layout = view.container.querySelector('.dt-note-columns')!
  expect(layout.querySelector(':scope > [data-node-view-content-react] > .node-noteColumn:first-child'), layout.outerHTML).not.toBeNull()
  const saved = JSON.parse(JSON.stringify(editor.document))
  expect(saved[1].props.mode).toBe('wrap')
  expect(saved[0].children[0].id).toBe('inside')
  await act(async () => { expect(editor.undo()).toBe(true) })
  expect(editor.document).toEqual(before)
  await act(async () => { expect(editor.redo()).toBe(true) })
  const reopened = BlockNoteEditor.create({ schema, initialContent: saved })
  editors.push(reopened)
  expect(reopened.document).toEqual(saved)
  view.unmount()
})
it('saves Toggle List clicks in block props and restores them without browser view storage', async () => {
  const editor = BlockNoteEditor.create({ schema, initialContent: [{ id: 'list', type: 'toggleListItem', content: 'Topic', children: [{ id: 'child', content: 'Keep me' }] }] })
  editors.push(editor)
  const element = document.createElement('div')
  document.body.append(element)
  await act(async () => editor.mount(element))
  const button = element.querySelector<HTMLButtonElement>('.bn-toggle-button')!
  expect(button.getAttribute('aria-expanded')).toBe('true')
  await act(async () => fireEvent.click(button))
  expect(editor.getBlock('list')!.props).toMatchObject({ collapsed: true })
  expect(editor.getBlock('child')!.content).toEqual([{ type: 'text', text: 'Keep me', styles: {} }])
  const saved = JSON.parse(JSON.stringify(editor.document))
  localStorage.clear()
  const reopened = BlockNoteEditor.create({ schema, initialContent: saved })
  editors.push(reopened)
  expect(reopened.getBlock('list')!.props).toMatchObject({ collapsed: true })
  expect(reopened.getBlock('child')!.id).toBe('child')
  element.remove()
})
