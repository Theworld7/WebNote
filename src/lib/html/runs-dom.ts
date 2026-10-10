import type { InlineMark, InlineRun } from "@/types/workspace"
import { TAG_MARKS, normalizeRuns } from "@/lib/inline"
import { BLOCK_TAGS, IMAGE_TAG, SKIPPED_TAGS } from "./tags"

/**
 * DOM → runs 的采集。
 *
 * 同一个函数服务两个方向：
 * - 解析静态 HTML（`collapseWhitespace: true`）—— 源码里的缩进换行在浏览器里不占位置；
 * - 读回 contenteditable（`collapseWhitespace: false`）—— 用户敲的空格是有意义的。
 *
 * 不加这个开关就只能二选一：折叠会让编辑器吃空格，不折叠会让解析结果带着满屏缩进。
 *
 * 标签 → 标记的反查表（`TAG_MARKS`）不在这里 —— 它是标记注册表的一半，与「标记 → 标签」
 * 同源，收在 `@/lib/inline`。
 */

const TEXT_NODE = 3

const LINK_TAG = "A"
const BREAK_TAG = "BR"
const INPUT_TAG = "INPUT"

export interface RunsFromNodeOptions {
  /** 是否把空白折叠成单空格。解析静态 HTML 传 true，读编辑器传 false。 */
  collapseWhitespace?: boolean
}

/** 采集时逐层累积的格式上下文。 */
interface RunContext {
  marks: InlineMark[]
  href: string | undefined
}

function makeRun(context: RunContext, text: string): InlineRun {
  const run: InlineRun = { text, marks: [...context.marks] }
  if (context.href !== undefined && context.href !== "") run.href = context.href
  return run
}

/**
 * 块级元素前补一个换行。
 *
 * `<li><div>a</div><div>b</div></li>` 这种剪藏常见形态：两个 div 直接拼会连成 "ab"，
 * 补了换行才是 "a\nb"。首个块不补 —— 否则每个块开头都多一个空行。
 */
function breakBefore(out: InlineRun[], context: RunContext): void {
  if (out.length === 0) return
  const last = out[out.length - 1]
  if (last.text.endsWith("\n")) return
  out.push(makeRun(context, "\n"))
}

function walk(node: Node, context: RunContext, out: InlineRun[], collapse: boolean): void {
  if (node.nodeType === TEXT_NODE) {
    const raw = node.textContent ?? ""
    const text = collapse ? raw.replace(/\s+/g, " ") : raw
    if (text !== "") out.push(makeRun(context, text))
    return
  }

  if (!(node instanceof Element)) return
  const tag = node.tagName
  if (SKIPPED_TAGS.has(tag) || tag === INPUT_TAG || tag === IMAGE_TAG) return

  if (tag === BREAK_TAG) {
    out.push(makeRun(context, "\n"))
    return
  }

  if (BLOCK_TAGS.has(tag)) breakBefore(out, context)

  const mark = TAG_MARKS.get(tag)
  const next: RunContext = {
    marks: mark !== undefined && !context.marks.includes(mark) ? [...context.marks, mark] : context.marks,
    // 嵌套链接取最内层的 href：`<a href="x"><a href="y">` 不会出现，但 `<a><span>` 会。
    href: tag === LINK_TAG ? node.getAttribute("href") ?? context.href : context.href,
  }

  for (const child of node.childNodes) walk(child, next, out, collapse)
}

/**
 * 跨 run 折叠空白边界。
 *
 * 逐文本节点的 `\s+ → " "` 只解决节点内部，节点之间还会撞车：
 * `a <strong> b</strong>` 会得到 "a " + " b" = 两个空格。这里按 run 边界再收一次。
 * `\n` 是 `<br>` 的语义，不动它；但紧贴换行的空格要去掉。
 */
function collapseBoundaries(runs: InlineRun[]): InlineRun[] {
  for (let index = 0; index < runs.length; index += 1) {
    const run = runs[index]
    const previous = index > 0 ? runs[index - 1] : undefined
    const next = index + 1 < runs.length ? runs[index + 1] : undefined

    if (previous !== undefined && /[ \n]$/.test(previous.text)) run.text = run.text.replace(/^ +/, "")
    if (next !== undefined && /^ *\n/.test(next.text)) run.text = run.text.replace(/ +$/, "")
  }
  return runs
}

/** 采集若干兄弟节点的行内内容。 */
export function runsFromNodes(nodes: Iterable<Node>, options: RunsFromNodeOptions = {}): InlineRun[] {
  const collapse = options.collapseWhitespace === true
  const out: InlineRun[] = []
  const context: RunContext = { marks: [], href: undefined }

  for (const node of nodes) walk(node, context, out, collapse)

  return normalizeRuns(collapse ? collapseBoundaries(out) : out)
}

/** 采集单个节点（含其后代）的行内内容。 */
export function runsFromNode(node: Node, options: RunsFromNodeOptions = {}): InlineRun[] {
  return runsFromNodes([node], options)
}
