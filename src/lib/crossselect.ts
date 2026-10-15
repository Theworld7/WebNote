import type { Block, InlineRun } from "@/types/workspace"
import type { OffsetRange } from "@/lib/marks"
import { blockText, isTextualBlock } from "@/lib/blocks"
import { DOM_ATTR, TOP_BLOCK_ROW_SELECTOR } from "@/lib/dom"
import { runsText, runsToHtml } from "@/lib/inline"
import { contentLength, offsetAt, rangeForOffsets, sliceRuns } from "@/lib/marks"

/**
 * 跨块只读选区。
 *
 * Chromium 把鼠标拖选钳在单个 contenteditable 宿主里，而块编辑器每块一个宿主，
 * 原生拖选出不了块。这里自己记录锚点 / 焦点、算高亮矩形、拼复制内容 ——
 * 数据始终是块上现有的 runs，不引入第二种正文表示；高亮用覆盖层画，
 * 不与原生选区抢绘制权（跨块期间容器 `select-none`，原生钳住的残影一并清掉）。
 *
 * 范围：只覆盖**顶层**块。布局格子内仍是单宿主原生选择（ADR-0007 的容器内世界），
 * 从格子内起拖不进这套逻辑。
 */

/** 跨块选区的一个端点：哪块、块内字符偏移。非正文块（或压在空白处）`offset` 为 -1，表示整块。 */
export interface BlockSelectionPoint {
  id: string
  index: number
  offset: number
}

/** 模块级开关：跨块拖选进行中。行内浮条（selectionchange 驱动）见它就收起 ——
 *  原生选区此时被钳在首块里，浮条跟着冒出来是错的。 */
let selecting = false

export function setCrossSelecting(value: boolean): void {
  selecting = value
}

export function isCrossSelecting(): boolean {
  return selecting
}

/**
 * 视口坐标 → 选区端点。
 *
 * 先按 y 找覆盖它的顶层块行（行序即文档序），再往该块的可编辑体里换算字符偏移。
 * `caretRangeFromPoint` 命中的可能是行内空白 / 别的元素，不归属本块可编辑体时
 * 按上下半块归到开头 / 结尾。非正文块（图片、表格、布局块…）端点是整块。
 */
export function resolvePoint(
  docRoot: HTMLElement,
  blocks: readonly Block[],
  x: number,
  y: number,
): BlockSelectionPoint | null {
  const rows = docRoot.querySelectorAll(TOP_BLOCK_ROW_SELECTOR)
  let rowIndex = -1
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]
    if (!(row instanceof HTMLElement)) continue
    const rect = row.getBoundingClientRect()
    if (y >= rect.top && y < rect.bottom) {
      rowIndex = i
      break
    }
  }

  const block = blocks[rowIndex]
  const row = rows[rowIndex]
  if (block === undefined || !(row instanceof HTMLElement)) return null

  const editable = row.querySelector(`[${DOM_ATTR.editable}="${block.id}"]`)
  if (!isTextualBlock(block) || !(editable instanceof HTMLElement)) {
    return { id: block.id, index: rowIndex, offset: -1 }
  }

  const caret = document.caretRangeFromPoint(x, y)
  const offset =
    caret === null || !editable.contains(caret.startContainer)
      ? null
      : offsetAt(editable, caret.startContainer, caret.startOffset)
  if (offset !== null) return { id: block.id, index: rowIndex, offset }

  const rect = editable.getBoundingClientRect()
  return { id: block.id, index: rowIndex, offset: y < rect.top + rect.height / 2 ? 0 : contentLength(editable) }
}

/** 端点偏移收进 [0, len]；-1（整块）按 0 处理 —— 复制与画矩形都不越过内容。 */
function clamp(point: BlockSelectionPoint, len: number): number {
  return Math.min(Math.max(point.offset, 0), len)
}

/**
 * 端点对 → 覆盖范围内每个块的字符区间。
 *
 * 锚块从锚点画到块尾（锚块在下沿则到锚点）、焦点块对称、中间块整块。
 * 非正文块没有 runs，不产出区间（矩形走整行、复制走 `blockText` 投影）。
 */
function segmentRanges(
  blocks: readonly Block[],
  anchor: BlockSelectionPoint,
  focus: BlockSelectionPoint,
): Map<string, OffsetRange> {
  const from = Math.min(anchor.index, focus.index)
  const to = Math.max(anchor.index, focus.index)
  const ranges = new Map<string, OffsetRange>()

  for (let i = from; i <= to; i += 1) {
    const block = blocks[i]
    if (block === undefined || !isTextualBlock(block)) continue

    const len = runsText(block.runs).length
    const a = clamp(anchor, len)
    const f = clamp(focus, len)
    let range: OffsetRange
    if (anchor.index === focus.index) {
      range = { start: Math.min(a, f), end: Math.max(a, f) }
    } else if (i === anchor.index) {
      range = anchor.index < focus.index ? { start: a, end: len } : { start: 0, end: a }
    } else if (i === focus.index) {
      range = focus.index < anchor.index ? { start: f, end: len } : { start: 0, end: f }
    } else {
      range = { start: 0, end: len }
    }
    if (range.end > range.start) ranges.set(block.id, range)
  }

  return ranges
}

/**
 * 跨块选区的可见矩形（视口坐标）。
 *
 * 拖选高亮统一走覆盖层（块内与跨块同一层,见 BlockEditor）：锚块从锚点画到
 * 块尾、焦点块对称、中间块整块。正文块按字符偏移取行盒矩形,非正文块整行兜底
 * —— 高亮不断档。颜色与混合方式由 `.cross-selection-rect` 负责（style.css）。
 */
export function selectionRects(
  docRoot: HTMLElement,
  blocks: readonly Block[],
  anchor: BlockSelectionPoint,
  focus: BlockSelectionPoint,
): DOMRect[] {
  const rects: DOMRect[] = []
  const ranges = segmentRanges(blocks, anchor, focus)
  const rows = docRoot.querySelectorAll(TOP_BLOCK_ROW_SELECTOR)

  for (let i = Math.min(anchor.index, focus.index); i <= Math.max(anchor.index, focus.index); i += 1) {
    const block = blocks[i]
    const row = rows[i]
    if (block === undefined || !(row instanceof HTMLElement)) continue

    let range: Range | null = null
    const textRange = ranges.get(block.id)
    if (textRange !== undefined) {
      const editable = row.querySelector(`[${DOM_ATTR.editable}="${block.id}"]`)
      if (editable instanceof HTMLElement) range = rangeForOffsets(editable, textRange)
    }
    if (range === null) {
      // 非正文块（或正文块的 DOM 暂时对不上）：取整行的 border box 兜底，高亮不断档。
      // 不能用 selectNodeContents(row) 的 rects —— 悬浮操作按钮是行的绝对定位子元素
      // （挂在行外 -50px 处），元素 Range 会把它的盒子一并算进来,高亮就盖到按钮上。
      rects.push(row.getBoundingClientRect())
      continue
    }
    for (const rect of range.getClientRects()) {
      if (rect.width > 0 || rect.height > 0) rects.push(rect)
    }
  }

  return rects
}

/** 跨块复制的内容：text 给不支持 HTML 的接收方，html 保留行内格式（每块一段 `<p>`）。 */
export interface CopyPayload {
  text: string
  html: string
}

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}

/** 一块在复制产物里的样子：正文块按区间切 runs，其它块落 `blockText` 投影。 */
function blockPayload(block: Block, range: OffsetRange | undefined): { text: string; html: string } {
  if (range === undefined || !isTextualBlock(block)) {
    const text = blockText(block)
    return { text, html: `<p>${escapeHtml(text)}</p>` }
  }
  const sliced: readonly InlineRun[] = sliceRuns(block.runs, range)
  return { text: runsText(sliced), html: `<p>${runsToHtml(sliced)}</p>` }
}

export function copyPayload(
  blocks: readonly Block[],
  anchor: BlockSelectionPoint,
  focus: BlockSelectionPoint,
): CopyPayload {
  const ranges = segmentRanges(blocks, anchor, focus)
  const parts: { text: string; html: string }[] = []
  for (let i = Math.min(anchor.index, focus.index); i <= Math.max(anchor.index, focus.index); i += 1) {
    const block = blocks[i]
    if (block !== undefined) parts.push(blockPayload(block, ranges.get(block.id)))
  }
  return { text: parts.map((part) => part.text).join("\n"), html: parts.map((part) => part.html).join("") }
}
