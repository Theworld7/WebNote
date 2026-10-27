/**
 * Markdown → 块列表。
 *
 * 先交给 `marked` 生成 HTML，再复用笔记自己的解析器 —— 这样 Markdown 的表格、
 * 任务列表、围栏代码、行内 HTML 都落到既有的块规则上，不必维护第二套语法树。
 * 唯一额外处理的是 GFM alert：应用里的提示框没有 Markdown 原生语法，导出端写成
 * `> [!NOTE]`，这里把触发词摘掉并还原成提示框块。
 */
import { marked } from "marked"
import type { Block, InlineRun, LayoutBlock } from "@/types/workspace"
import { createTextualBlock } from "@/lib/blocks"
import { parseNote } from "@/lib/html"
import { normalizeRuns } from "@/lib/inline"

const ALERT_MARKER = /^\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/

/** Markdown 文本 → 块列表。空文档返回空数组，由调用方决定补一个空文本块。 */
export function markdownToBlocks(source: string): Block[] {
  const html = marked.parse(source, { async: false, gfm: true })
  const note = parseNote(html)
  return note.blocks.map(promoteBlock)
}

/** `.md` / `.markdown` 文件名 → 笔记标题。 */
export function markdownTitleOf(name: string): string {
  return name.replace(/\.(md|markdown)$/i, "")
}

function promoteBlock(block: Block): Block {
  if (block.type === "quote") {
    const runs = stripAlertMarker(block.runs)
    if (runs !== null) return createTextualBlock("callout", runs)
    return block
  }
  if (block.type === "layout") {
    const layout: LayoutBlock = {
      ...block,
      cells: block.cells.map((cell) => cell.map(promoteBlock)),
    }
    return layout
  }
  return block
}

/**
 * 引用块首行是 `[!NOTE]` 之类的 GFM alert 触发词时，摘掉它并返回剩余 runs。
 * 不是 alert 就返回 `null`，让调用方保持引用块原样。
 */
function stripAlertMarker(runs: readonly InlineRun[]): InlineRun[] | null {
  const first = runs[0]
  if (first === undefined) return null

  const marker = ALERT_MARKER.exec(first.text)
  if (marker === null) return null

  let text = first.text.slice(marker[0].length)
  text = text.replace(/^\n/, "").replace(/^ /, "")

  const rest = runs.slice(1)
  const next: InlineRun[] = text === "" ? [...rest] : [{ ...first, text }, ...rest]
  return normalizeRuns(next)
}
