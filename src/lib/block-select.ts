import type { Block } from "@/types/workspace"
import { BATCH_RETYPE_TYPES } from "@/lib/blocks"
import { TOP_BLOCK_ROW_SELECTOR } from "@/lib/dom"

/**
 * 块级框选（桌面图标那套「拉一个矩形圈住几个」）。
 *
 * 与 `lib/crossselect` 是两套并列的手势，互不复用：
 * - `crossselect` 选的是**正文**（锚点 / 焦点 + 块内字符偏移），从文字上按下；
 * - 这里选的是**整块**（一组块 id），只从块行之外的空白处按下。
 *
 * 「按在文字上仍是选字」是这条边界唯一的依据 —— 正文行里几乎全是文字，框选如果
 * 也能从文字上起拖，两种手势会互相抢。
 *
 * 范围与跨块选区一致：只覆盖**顶层**块。布局格子内是容器内的世界（ADR-0007），
 * 从格子里起拖不进这套逻辑。
 */

/** 一个矩形。坐标口径由调用方决定（视口 / 文档容器内），本模块只管算法。 */
export interface SelectRect {
  top: number
  left: number
  width: number
  height: number
}

/** 两点 → 左上右下的矩形。x / y 反向拖也成立（矩形不看拖拽方向）。 */
export function rectFromPoints(x1: number, y1: number, x2: number, y2: number): SelectRect {
  return {
    top: Math.min(y1, y2),
    left: Math.min(x1, x2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  }
}

/** 这一块能不能进框选集合：只看类型，与它在文档里的位置无关。 */
export function isBatchSelectable(block: Block): boolean {
  return BATCH_RETYPE_TYPES.some((type) => block.type === type)
}

/**
 * 矩形圈住的块 id，按文档序。
 *
 * **只比纵向**：块行横向铺满正文列，而框选只从行外空白起拖，横向位置不携带意图 ——
 * 从右侧余量里拖下来，该选中的仍是同一条带上的块。桌面图标要求两个方向都相交，
 * 是因为图标之间本来就有横向空隙；这里没有那个空隙，横向判定只会让「在右边缘拉」
 * 白拉一场。
 *
 * 类型不在 `BATCH_RETYPE_TYPES` 里的块（图片 / 表格 / 布局 / 引用块…）一律**跳过**：
 * 矩形扫过它们时既不选中也不受影响，两侧的基础 / 列表块照常选上。
 */
export function blocksInBand(docRoot: HTMLElement, blocks: readonly Block[], band: SelectRect): string[] {
  const ids: string[] = []
  const rows = docRoot.querySelectorAll(TOP_BLOCK_ROW_SELECTOR)
  for (let i = 0; i < rows.length; i += 1) {
    const block = blocks[i]
    const row = rows[i]
    if (block === undefined || !(row instanceof HTMLElement) || !isBatchSelectable(block)) continue
    const rect = row.getBoundingClientRect()
    // 半开区间：恰好贴着上下沿不算相交，与拖拽落点「按块中线判」同一分寸。
    if (rect.bottom <= band.top || rect.top >= band.top + band.height) continue
    ids.push(block.id)
  }
  return ids
}

/**
 * 一组块行的可见矩形（视口坐标）。选中态高亮与浮条落位都靠它。
 *
 * 取整行的 border box 而不是行内可编辑体的文字范围：框选选的是「整块」，
 * 高亮就该是整行 —— 这跟跨块文本选区按字符偏移取行盒是两种口径，别照抄。
 */
export function bandRectsOf(docRoot: HTMLElement, blocks: readonly Block[], ids: readonly string[]): SelectRect[] {
  const wanted = new Set(ids)
  const rects: SelectRect[] = []
  const rows = docRoot.querySelectorAll(TOP_BLOCK_ROW_SELECTOR)
  for (let i = 0; i < rows.length; i += 1) {
    const block = blocks[i]
    const row = rows[i]
    if (block === undefined || !(row instanceof HTMLElement) || !wanted.has(block.id)) continue
    const rect = row.getBoundingClientRect()
    rects.push({ top: rect.top, left: rect.left, width: rect.width, height: rect.height })
  }
  return rects
}
