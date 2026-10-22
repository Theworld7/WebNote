import type { InlineMark, InlineRun, LinkShape } from "@/types/workspace"
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
export function offsetAt(root: Node, target: Node, offset: number): number | null {
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

/** 光标（折叠选区）落在 `root` 内的字符偏移。无选区、选区未折叠、或光标不在 `root` 内时返回 null。 */
export function caretOffsetIn(root: HTMLElement): number | null {
  const selection = window.getSelection()
  if (selection === null || selection.rangeCount === 0) return null

  const range = selection.getRangeAt(0)
  if (!range.collapsed) return null
  if (!root.contains(range.startContainer)) return null

  return offsetAt(root, range.startContainer, range.startOffset)
}

/** 容器内容的总字符长度（与 `runsText` 同口径，`<br>` 记 1）。跨块选区量边界用。 */
export function contentLength(root: Node): number {
  return offsetAt(root, root, root.childNodes.length) ?? 0
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

/** 深拷一个 run。`marks` / `href` / `color` 都是引用或可选字段，浅拷会让两份 run 共享同一组标记。 */
function copyRun(run: InlineRun, text?: string): InlineRun {
  const next: InlineRun = { text: text ?? run.text, marks: [...run.marks] }
  if (run.href !== undefined && run.href !== "") next.href = run.href
  if (next.href !== undefined && run.linkShape === "card") next.linkShape = "card"
  if (run.color !== undefined && run.color !== "") next.color = run.color
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
 * 在偏移处把 runs 切成两半：`head` 是偏移之前的部分，`tail` 是之后的部分。
 * 偏移落在 run 中间时把该 run 拆开，两半各自保留 marks / href（经 `copyRun` 深拷）
 * 再归一化。Enter 从段落中间拆块用：前半留在本块，后半带进新块。
 */
export function splitRunsAt(runs: readonly InlineRun[], offset: number): { head: InlineRun[]; tail: InlineRun[] } {
  const head: InlineRun[] = []
  const tail: InlineRun[] = []
  let cursor = 0

  for (const run of runs) {
    const from = cursor
    const to = from + run.text.length
    cursor = to
    if (to <= offset) head.push(copyRun(run))
    else if (from >= offset) tail.push(copyRun(run))
    else {
      head.push(copyRun(run, run.text.slice(0, offset - from)))
      tail.push(copyRun(run, run.text.slice(offset - from)))
    }
  }

  return { head: normalizeRuns(head), tail: normalizeRuns(tail) }
}

/** 只取区间内的 runs（端点落在 run 中间时拆开，marks / href 经 `copyRun` 保留）。跨块复制用它取选中片段。 */
export function sliceRuns(runs: readonly InlineRun[], range: OffsetRange): InlineRun[] {
  return normalizeRuns(
    slice(runs, range)
      .filter((piece) => piece.inside)
      .map((piece) => piece.run),
  )
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

/** 区间内的纯文字，与 `runsText` 同一投影。链接浮层回显「显示内容」用它。 */
export function textIn(runs: readonly InlineRun[], range: OffsetRange): string {
  return sliceRuns(runs, range)
    .map((run) => run.text)
    .join("")
}

/**
 * 把区间扩到所在链接的整段（相邻且同 href 的 run 跨度）。
 *
 * 链接编辑的对象是「这一整条链接」，不是选区里那半截：浮层要回显完整的显示内容，
 * 改完也不该把没选中的半截留在原处。**起点**决定编辑哪条链接 —— 起点在链接里就
 * 用整段，哪怕终点拖到了链接外；起点不在链接上（新建）时原样返回。
 */
export function linkSpanAt(runs: readonly InlineRun[], range: OffsetRange): OffsetRange {
  const starts: number[] = []
  let cursor = 0
  for (const run of runs) {
    starts.push(cursor)
    cursor += run.text.length
  }

  let index = runs.length - 1
  for (let i = 0; i < runs.length; i += 1) {
    if (range.start < starts[i] + runs[i].text.length) {
      index = i
      break
    }
  }

  const run = runs[index]
  if (run === undefined || run.href === undefined || run.href === "") return range

  let from = index
  while (from > 0 && runs[from - 1].href === run.href) from -= 1
  let to = index
  while (to + 1 < runs.length && runs[to + 1].href === run.href) to += 1

  return { start: starts[from], end: to + 1 < runs.length ? starts[to + 1] : cursor }
}

/** 偏移处生效的链接：地址与形态。不在链接上时返回 null —— 浮层的回显与按钮激活态都靠它。 */
export function linkAt(runs: readonly InlineRun[], offset: number): { href: string; shape: LinkShape } | null {
  let cursor = 0
  for (const run of runs) {
    const next = cursor + run.text.length
    if (offset < next) {
      if (run.href === undefined || run.href === "") return null
      return { href: run.href, shape: run.linkShape ?? "text" }
    }
    cursor = next
  }
  return null
}

/**
 * 在区间上设置 / 移除链接。
 *
 * `href` 为 null 即移除：地址与形态一起清 —— 没有 href 的形态是非法态（与
 * 「link 标记却没地址」同一条立场）。设置时形态总是显式给定，选区跨多段也统一
 * 成同一个链接 —— 「我圈了一段，想把它们指向同一个地址」。
 *
 * `text` 非空时顺手把区间里的文字换掉（链接的「显示内容」）。区间里的文字整段
 * 替换成这一个串，marks 与颜色取首段 —— 链接里原本前半粗后半不粗时，重写后按
 * 起点那个格式算，比凭空合并出一个谁都没用过的组合更可预期。字符长度会变，调用方
 * 按新长度算区间再 paint。
 */
export function applyLinkAt(
  runs: readonly InlineRun[],
  range: OffsetRange,
  href: string | null,
  shape: LinkShape = "text",
  text?: string,
): InlineRun[] {
  const pieces = slice(runs, range)
  const touched = pieces.filter((piece) => piece.inside)
  if (touched.length === 0) return runs.map((run) => copyRun(run))

  const head = touched[0]
  if (text !== undefined && text !== "" && text !== textIn(runs, range)) {
    head.run.text = text
    for (const piece of touched.slice(1)) piece.run.text = ""
  }

  for (const piece of touched) {
    if (href === null || href.trim() === "") {
      delete piece.run.href
      delete piece.run.linkShape
      continue
    }
    piece.run.href = href.trim()
    if (shape === "card") piece.run.linkShape = "card"
    else delete piece.run.linkShape
  }

  return normalizeRuns(pieces.map((piece) => piece.run))
}

/** 偏移处生效的文本颜色。默认色（无着色）返回 null —— 色板的高亮态靠它。 */
export function colorAt(runs: readonly InlineRun[], offset: number): string | null {
  let cursor = 0
  for (const run of runs) {
    const next = cursor + run.text.length
    if (offset < next) return run.color ?? null
    cursor = next
  }
  const last = runs[runs.length - 1]
  return last?.color ?? null
}

/**
 * 在区间上设置 / 移除文本颜色。
 *
 * `color` 为 null 即回到默认色。与链接同一立场：设置时选区跨多段统一成同一个颜色
 * —— 「我圈了一段，想把它们染成同一个颜色」。调用方保证传入值在色盘内（TEXT_COLORS）。
 */
export function applyColorAt(runs: readonly InlineRun[], range: OffsetRange, color: string | null): InlineRun[] {
  const pieces = slice(runs, range)
  const touched = pieces.filter((piece) => piece.inside)
  if (touched.length === 0) return runs.map((run) => copyRun(run))

  for (const piece of touched) {
    if (color === null || color === "") delete piece.run.color
    else piece.run.color = color
  }

  return normalizeRuns(pieces.map((piece) => piece.run))
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
