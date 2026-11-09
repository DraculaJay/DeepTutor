import { createExtension } from '@blocknote/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

// These are view decorations, never document nodes. They create a gap in each
// intersecting line, so text can use BOTH sides of an interior floating block.
type Gap = { pos: number; width: number; height?: number }
type BlockGap = { from: number; to: number; height: number }
type Flow = { gaps: Gap[]; blocks: BlockGap[]; decorations: DecorationSet }
const key = new PluginKey<Flow>('note-wrap-flow')
const empty = (): Flow => ({ gaps: [], blocks: [], decorations: DecorationSet.empty })
const inlineTypes = new Set(['paragraph', 'heading', 'bulletListItem', 'numberedListItem', 'checkListItem', 'toggleListItem'])

function build(view: EditorView, gaps: Gap[], blocks: BlockGap[]): Flow {
  const decorations = gaps.map(gap => Decoration.widget(gap.pos, () => {
    const span = document.createElement('span')
    span.className = 'dt-note-wrap-gap'
    span.contentEditable = 'false'
    span.setAttribute('aria-hidden', 'true')
    span.style.width = `${gap.width}px`
    if (gap.height) span.style.height = `${gap.height}px`
    return span
  }, { side: -1, key: `${gap.pos}:${gap.width}:${gap.height || 0}`, ignoreSelection: true }))
  decorations.push(...blocks.map(block => Decoration.node(block.from, block.to, { style: `margin-top:${block.height}px` })))
  return { gaps, blocks, decorations: DecorationSet.create(view.state.doc, decorations) }
}

function nextGap(view: EditorView, flow: Flow): Gap | BlockGap | undefined {
  for (const layout of view.dom.querySelectorAll<HTMLElement>('.dt-note-columns[data-layout="wrap"]')) {
    const object = layout.querySelector<HTMLElement>(':scope > [data-node-view-content-react] > .node-noteColumn:first-child .dt-note-column')
    const body = layout.querySelector<HTMLElement>(':scope > [data-node-view-content-react] > .node-noteColumn:nth-child(2)')
    if (!object || !body) continue
    const box = object.getBoundingClientRect(), outer = layout.getBoundingClientRect()
    if (!box.width || !box.height) continue
    const left = Math.max(outer.left, box.left - 12), right = Math.min(outer.right, box.right + 12)
    const top = box.top - 6, bottom = box.bottom + 6
    // Full-width non-prose blocks retain their original renderer and move below
    // the obstacle. Inline text (including links, marks and inline math) stays editable.
    for (const content of body.querySelectorAll<HTMLElement>('.bn-block-content')) {
      if (content.closest('.dt-note-columns') !== layout || inlineTypes.has(content.dataset.contentType || '')) continue
      const bounds = content.getBoundingClientRect()
      if (!bounds.width || bounds.bottom <= top || bounds.top >= bottom) continue
      const block = content.closest<HTMLElement>('.bn-block-outer[data-id]')
      if (!block) continue
      let gap: BlockGap | undefined
      view.state.doc.descendants((node, pos) => {
        if (node.attrs.id === block.dataset.id && !flow.blocks.some(item => item.from === pos)) {
          gap = { from: pos, to: pos + node.nodeSize, height: bottom - bounds.top + 6 }
          return false
        }
      })
      if (gap) return gap
    }
    // Inline atoms (for example a formula) have no editable text nodes.
    for (const atom of body.querySelectorAll<HTMLElement>('.bn-inline-content [contenteditable="false"]')) {
      if (atom.closest('.dt-note-columns') !== layout || atom.classList.contains('dt-note-wrap-gap')) continue
      const bounds = atom.getBoundingClientRect()
      if (!bounds.width || bounds.bottom <= top || bounds.top >= bottom || bounds.right <= left || bounds.left >= right - .5) continue
      const pos = view.posAtDOM(atom.parentNode!, Array.prototype.indexOf.call(atom.parentNode!.childNodes, atom))
      if (flow.gaps.some(item => item.pos === pos)) continue
      // An atom too wide for the right-hand opening needs a clear line below.
      if (bounds.width > outer.right - right) return { pos, width: 0, height: bottom - bounds.top + bounds.height }
      return { pos, width: right - bounds.left }
    }
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, { acceptNode(node) {
      const parent = node.parentElement
      if (!node.textContent?.trim() || !parent?.closest('.bn-inline-content') || parent.closest('[contenteditable="false"], pre, .dt-note-wrap-gap')) return NodeFilter.FILTER_REJECT
      if (parent.closest('.dt-note-columns') !== layout) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    } })
    const range = document.createRange()
    while (walker.nextNode()) {
      const text = walker.currentNode as Text
      range.selectNodeContents(text)
      const textBounds = range.getBoundingClientRect()
      if (textBounds.bottom <= top || textBounds.top >= bottom) continue
      for (let offset = 0; offset < text.length; offset++) {
        if (/\s/.test(text.data[offset])) continue
        range.setStart(text, offset); range.setEnd(text, offset + 1)
        const rect = range.getBoundingClientRect()
        if (rect.top >= bottom) break
        if (!rect.width || rect.bottom <= top || rect.top >= bottom || rect.right <= left || rect.left >= right - .5) continue
        let start = offset
        // Preserve Latin words; CJK can break naturally between characters.
        while (start > 0 && /[A-Za-z0-9_]/.test(text.data[start]) && /[A-Za-z0-9_]/.test(text.data[start - 1])) start--
        range.setStart(text, start); range.setEnd(text, start + 1)
        let at = range.getBoundingClientRect()
        if (Math.abs(at.top - rect.top) > 2) { start = offset; at = rect }
        const pos = view.posAtDOM(text, start)
        if (flow.gaps.some(item => item.pos === pos)) continue
        const width = Math.min(outer.right - at.left, right - at.left)
        if (width > .5) return { pos, width }
      }
    }
  }
}

export const noteWrapFlow = createExtension({
  key: 'note-wrap-flow',
  prosemirrorPlugins: [new Plugin<Flow>({
    key,
    state: {
      init: empty,
      apply(tr, previous) { return tr.getMeta(key) || (tr.docChanged ? empty() : previous) },
    },
    props: { decorations: state => key.getState(state)!.decorations },
    view(view) {
      let frame = 0, reset = false, destroyed = false
      const solve = () => {
        frame = 0
        if (destroyed) return
        if (reset) {
          reset = false
          if (key.getState(view.state)!.gaps.length || key.getState(view.state)!.blocks.length) view.dispatch(view.state.tr.setMeta(key, empty()).setMeta('addToHistory', false))
        }
        // Bound work per frame; continue on the next frame for long paragraphs.
        for (let count = 0; count < 32; count++) {
          const flow = key.getState(view.state)!, gap = nextGap(view, flow)
          if (!gap) return
          const next = 'pos' in gap ? build(view, [...flow.gaps, gap], flow.blocks) : build(view, flow.gaps, [...flow.blocks, gap])
          view.dispatch(view.state.tr.setMeta(key, next).setMeta('addToHistory', false))
        }
        schedule()
      }
      const schedule = () => { if (!frame && !destroyed) frame = requestAnimationFrame(solve) }
      const invalidate = () => { reset = true; schedule() }
      view.dom.addEventListener('dt-note-wrap-layout', invalidate)
      window.addEventListener('resize', invalidate)
      document.fonts?.addEventListener('loadingdone', invalidate)
      schedule()
      return {
        update(updated, previous) { if (updated.state.doc !== previous.doc) invalidate() },
        destroy() {
          destroyed = true; cancelAnimationFrame(frame)
          view.dom.removeEventListener('dt-note-wrap-layout', invalidate)
          window.removeEventListener('resize', invalidate)
          document.fonts?.removeEventListener('loadingdone', invalidate)
        },
      }
    },
  })],
})
