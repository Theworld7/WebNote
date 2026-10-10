import type { InlineMark, InlineRun } from "@/types/workspace"
import { MARK_REGISTRY, normalizeRuns, runsToHtml } from "./inline"

/**
 * 行内格式的编辑操作：选区 ↔ runs 偏移的映射，以及在 runs 上切换标记。
 *
 * 格式一律落在 runs 上，不走 `document.execCommand` —— 那条路直接改 DOM，
 * 产出的标签（`<b>`、`<span style="background-color:…">`）和序列化产物对不上，
 * 还得反过来再猜一次它改成了什么；它的选区行为在 WKWebView 与 Chromium 上也并不一致。
 *
 * 偏移口径与 `runsText()` 投影一致：`<br>` 在 DOM 里占 1 个字符，正好对上 runs 里的
 * `\n`，两边长度天然相等，换算不需要额外补偿。
 */

const TEXT_NODE = 3
const BREAK_TAG = "BR"

/** 一个节点在字符偏移里占多长。 */
function measure(node: Node): number {
  if (node.nodeType === TEXT_NODE) return (node.textContent ?? "").length
  if (node instanceof Element && node.tagName === BREAK_TAG) return 1
  let total = 0
  for (const child of node.childNodes) total += measure(child)
  return total
}

/**
 * DOM 位置 → 容器内的字符偏移。
 *
 * `offset` 落在元素上时表示子节点下标 —— contenteditable 里的选区端点常常正好落在
 * 元素边界上（整段加粗的末尾、两个标记之间），只认文本节点会漏掉这半边。
 */
function offsetAt(root: Node, target: Node, offset: number): number | null {
  let cursor = 0

  function walk(node: Node): number | null {
    if (node === target) {
      if (node.nodeType === TEXT_NODE) return cursor + offset
      const children = node.childNodes
      let sum = 0
      for (let index = 0; index < offset && index < children.length; index += 1) {
        sum += measure(children[index])
      }
      return cursor + sum
    }
    if (node.nodeType === TEXT_NODE) {
      cursor += (node.textContent ?? "").length
      return null
    }
    if (node instanceof Element && node.tagName === BREAK_TAG) {
      cursor += 1
      return null
    }
    for (const child of node.childNodes) {
      const found = walk(child)
      if (found !== null) return found
    }
    return null
  }

  return walk(root)
}

interface DomPoint {
  node: Node
  offset: number
}

/**
 * 字符偏移 → DOM 位置。
 *
 * 落点只认文本节点：`<br>` 这种空元素接不住端点，偏移正好压在它上面时原样交给它
 * 后面的文本节点，光标落在换行之后 —— 这也是浏览器的直觉位置。
 */
function pointAt(root: Node, position: number): DomPoint | null {
  let cursor = position

  function walk(node: Node): DomPoint | null {
    if (node.nodeType === TEXT_NODE) {
      const length = (node.textContent ?? "").length
      if (cursor <= length) return { node, offset: cursor }
      cursor -= length
      return null
    }
    if (node instanceof Element && node.tagName === BREAK_TAG) {
      if (cursor > 0) cursor -= 1
      return null
    }
    for (const child of node.childNodes) {
      const found = walk(child)
      if (found !== null) return found
    }
    return null
  }

  return walk(root)
}

/** 一段字符区间，相对可编辑体开头。 */
export interface OffsetRange {
  start: number
  end: number
}

/** 当前窗口选区落在 `root` 内的字符区间。无选区、选区折叠、或跨出 `root` 时返回 null。 */
export function offsetRangeIn(root: HTMLElement): OffsetRange | null {
  const selection = window.getSelection()
  if (selection === null || selection.rangeCount === 0) return null

  const range = selection.getRangeAt(0)
  if (range.collapsed) return null
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null

  const start = offsetAt(root, range.startContainer, range.startOffset)
  const end = offsetAt(root, range.endContainer, range.endOffset)
  if (start === null || end === null || start >= end) return null

  return { start, end }
}

/** 字符区间 → 可装回 selection 的 Range。端点落在 `<br>` 上时返回 null。 */
export function rangeForOffsets(root: Node, range: OffsetRange): Range | null {
  const from = pointAt(root, range.start)
  const to = pointAt(root, range.end)
  if (from === null || to === null) return null

  const result = document.createRange()
  result.setStart(from.node, from.offset)
  result.setEnd(to.node, to.offset)
  return result
}

/** 深拷一个 run。`marks` 与 `href` 都是引用 / 可选字段，浅拷会让两份 run 共享同一组标记。 */
function copyRun(run: InlineRun, text?: string): InlineRun {
  const next: InlineRun = { text: text ?? run.text, marks: [...run.marks] }
  if (run.href !== undefined && run.href !== "") next.href = run.href
  return next
}

interface Piece {
  run: InlineRun
  /** 该段是否落在待切换的区间内。 */
  inside: boolean
}

/**
 * 按区间把 runs 切成段。区间端点落在 run 中间时把那个 run 拆开 ——
 * 不拆的话「选中一段里的前半句加粗」会变成整段加粗。
 */
function slice(runs: readonly InlineRun[], range: OffsetRange): Piece[] {
  const pieces: Piece[] = []
  let cursor = 0

  for (const run of runs) {
    const from = cursor
    const to = from + run.text.length
    cursor = to

    if (to <= range.start || from >= range.end) {
      pieces.push({ run: copyRun(run), inside: false })
      continue
    }
    if (from < range.start) {
      pieces.push({ run: copyRun(run, run.text.slice(0, range.start - from)), inside: false })
    }
    pieces.push({
      run: copyRun(run, run.text.slice(Math.max(range.start - from, 0), Math.min(range.end - from, to - from))),
      inside: true,
    })
    if (to > range.end) {
      pieces.push({ run: copyRun(run, run.text.slice(range.end - from)), inside: false })
    }
  }

  return pieces
}

/**
 * 在区间上切换标记。
 *
 * 「加还是减」按整段收敛：区间覆盖到的每一段都已带该标记才移除，否则一律加上。
 * 选区跨了两种格式时，收敛到「都带上」比反过来更贴合「我圈了一段，想把它变粗」的本意。
 */
export function toggleMarkAt(runs: readonly InlineRun[], range: OffsetRange, mark: InlineMark): InlineRun[] {
  const pieces = slice(runs, range)
  const touched = pieces.filter((piece) => piece.inside)
  if (touched.length === 0) return runs.map((run) => copyRun(run))

  const removing = touched.every((piece) => piece.run.marks.includes(mark))
  for (const piece of touched) {
    piece.run.marks = removing
      ? piece.run.marks.filter((item) => item !== mark)
      : [...piece.run.marks, mark]
  }

  return normalizeRuns(pieces.map((piece) => piece.run))
}

/** 某个偏移处生效的标记。工具栏拿它显示当前哪几个格式是激活的。 */
export function marksAt(runs: readonly InlineRun[], offset: number): InlineMark[] {
  let cursor = 0
  for (const run of runs) {
    const next = cursor + run.text.length
    if (offset < next) return [...run.marks]
    cursor = next
  }
  const last = runs[runs.length - 1]
  return last === undefined ? [] : [...last.marks]
}

/**
 * 把 runs 画回可编辑元素并复原选区。
 *
 * contenteditable 是非受控的 —— Vue 不回写正文，改完数据这层 DOM 得自己接上。
 * 写 `innerHTML` 会把选区连同旧节点一起丢掉，所以紧接着按字符偏移把 Range 装回去。
 *
 * 切换标记不改变字符长度，所以传进来的区间在重画前后指的是同一段文字。
 */
export function paintRuns(element: HTMLElement, runs: readonly InlineRun[], range: OffsetRange): void {
  element.innerHTML = runsToHtml(runs)
  element.focus()

  const restored = rangeForOffsets(element, range)
  const selection = window.getSelection()
  if (restored !== null && selection !== null) {
    selection.removeAllRanges()
    selection.addRange(restored)
  }
}

/**
 * 键盘快捷键对应的行内标记，不是格式快捷键时返回 null。
 *
 * 键位表在 `@/lib/inline` 的标记注册表里，与标记的标签、顺序、按钮名同源 ——
 * 正文块与表格单元格共用这条查找，两处的键位不会漂。
 */
export function shortcutMark(event: KeyboardEvent): InlineMark | null {
  if (!event.metaKey && !event.ctrlKey) return null
  if (event.altKey) return null
  const key = event.key.toLowerCase()
  const hit = MARK_REGISTRY.find((spec) => spec.shortcut?.key === key && (spec.shortcut.shift ?? false) === event.shiftKey)
  return hit?.mark ?? null
}
