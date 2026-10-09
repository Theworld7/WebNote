import type { Block, ImageBlock, InlineRun, TableBlock, TableCell, TextualBlockType } from "@/types/workspace"
import { createImageBlock, createMermaidBlock, createTableBlock, createTextualBlock } from "@/lib/blocks"
import { textToRuns, trimRuns } from "@/lib/inline"
import { runsFromNodes } from "./runs-dom"
import { BLOCK_TAGS, IMAGE_TAG, SKIPPED_TAGS } from "./tags"

/**
 * 静态 HTML → 块列表。
 *
 * 宽松解析：认不出的标签按容器穿透，正文抽得出来就成块、抽不出来就丢。
 * 目标是「浏览器剪藏的脏 HTML 和自家导出的规范 HTML 都能吃」，所以：
 *
 * - 顶层不是标签的裸文本也成块（`<body>一段话</body>` 不会丢）；
 * - `<div>` / `<section>` / `<span>` 这类纯容器不产生块，只看它们的子节点；
 * - 连续的纯行内内容攒成一个文本块，遇到块级元素才断开 —— 否则
 *   `<p>a<strong>b</strong>c</p>` 会被拆成三个块；
 * - `<script>` / `<style>` 等噪声整段跳过（见 `tags.ts`）。
 *
 * 与 `serialize.ts` 构成往返对：`parseHtml(blocksToHtml(x))` 对规范产物是**精确**可逆的
 * （见 `design/parse-check.html` 的自检），对脏 HTML 则是先规范化、再稳定。
 */
export function parseHtml(source: string): Block[] {
  const doc = new DOMParser().parseFromString(source, "text/html")
  const state: ParseState = { blocks: [] }

  parseContainer(doc.body, state, 0)

  // 空壳文档（只有 <head><title>）拿标题兜底，否则打开就是一片空白。
  if (state.blocks.length === 0) {
    const title = doc.title.trim()
    if (title !== "") state.blocks.push(createTextualBlock("h1", textToRuns(title)))
  }

  return state.blocks
}

interface ParseState {
  blocks: Block[]
}

/**
 * 标题映射。六级一一对应 —— 模型里有 h4~h6 之后不再降级，
 * 否则「h4 → h3」会在往返里把层级压平，改一次笔记就丢一次结构。
 */
const HEADING_TYPES = new Map<string, TextualBlockType>([
  ["H1", "h1"],
  ["H2", "h2"],
  ["H3", "h3"],
  ["H4", "h4"],
  ["H5", "h5"],
  ["H6", "h6"],
])

const CODE_TAG = "CODE"

/** 行内内容 → runs。静态 HTML 走这条路径一律折叠空白并掐头去尾。 */
function inlineRuns(nodes: Iterable<Node>): InlineRun[] {
  return trimRuns(runsFromNodes(nodes, { collapseWhitespace: true }))
}

function inlineRunsOf(element: Element): InlineRun[] {
  return inlineRuns([element])
}

/**
 * 遍历一个容器的子节点。
 *
 * 每层容器自己持有一个 `pending` 攒行内节点，遇到块级元素或容器收尾时冲成一个文本块。
 * 用局部变量而不是 `ParseState` 上的共享数组：递归前必然已 flush，顺序天然正确，
 * 也不用担心下层把上层的待冲内容搅乱。
 */
function parseContainer(container: Node, state: ParseState, depth: number): void {
  let pending: Node[] = []

  const flush = (): void => {
    if (pending.length === 0) return
    const nodes = pending
    pending = []
    const runs = inlineRuns(nodes)
    if (runs.length > 0) state.blocks.push(createTextualBlock("text", runs))
  }

  for (const child of container.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      pending.push(child)
      continue
    }
    if (!(child instanceof Element)) continue
    if (SKIPPED_TAGS.has(child.tagName)) continue

    // 图片虽是行内元素，但在笔记里永远是独立块：先冲掉攒着的正文再插图。
    if (child.tagName === IMAGE_TAG) {
      flush()
      state.blocks.push(imageBlockOf(child))
      continue
    }

    if (BLOCK_TAGS.has(child.tagName)) {
      flush()
      parseBlockElement(child, state, depth)
      continue
    }

    pending.push(child)
  }

  flush()
}

function parseBlockElement(element: Element, state: ParseState, depth: number): void {
  switch (element.tagName) {
    case "UL":
    case "OL":
      parseList(element, state, depth)
      return
    case "PRE":
      state.blocks.push(parsePre(element))
      return
    case "BLOCKQUOTE":
      state.blocks.push(createTextualBlock("quote", inlineRunsOf(element)))
      return
    case "ASIDE":
      // `<aside>` 语义上就是「旁注」，替 callout 省掉一个自定义属性。
      state.blocks.push(createTextualBlock("callout", inlineRunsOf(element)))
      return
    case "HR":
      state.blocks.push(createTextualBlock("divider"))
      return
    case "TABLE":
      if (element instanceof HTMLTableElement) {
        state.blocks.push(parseTable(element))
        return
      }
      break
    case "P":
      // 段落按正文处理：即使没有子节点也留一个空块。
      // 不留的话，编辑器里敲出来的空段落一保存就消失。
      if (!hasEmbeddedBlock(element)) {
        state.blocks.push(createTextualBlock("text", inlineRunsOf(element)))
        return
      }
      break
    default:
      break
  }

  const heading = HEADING_TYPES.get(element.tagName)
  if (heading !== undefined) {
    state.blocks.push(createTextualBlock(heading, inlineRunsOf(element)))
    return
  }

  // DT / DD / DIV / SECTION / FIGURE 等：穿透，产出由子节点决定。
  parseContainer(element, state, depth)
}

/** 段落里是否嵌了独立块的元素（图片 / 表格 / 列表…）。有的话不能整段当正文抽。 */
function hasEmbeddedBlock(element: Element): boolean {
  for (const child of element.children) {
    if (child.tagName === IMAGE_TAG || BLOCK_TAGS.has(child.tagName)) return true
  }
  return false
}

/**
 * 列表解析：模型是平铺的，嵌套用 `depth` 表达，不建树。
 *
 * 一个 `<li>` 的产出规则：
 * - 自有内容（除嵌套列表以外的子节点）抽得出正文 → 出一个列表项块；
 * - 自有内容为空但有嵌套列表 → 不出块，嵌套列表回到当前 depth（避免凭空多一层缩进）；
 * - 两者都空（`<li></li>`）→ 出一个空列表项块，否则序列化回去这一项会消失。
 */
function parseList(list: Element, state: ParseState, depth: number): void {
  const ordered = list.tagName === "OL"

  for (const item of list.children) {
    if (item.tagName !== "LI") continue

    const own: Node[] = []
    const nested: Element[] = []
    for (const child of item.childNodes) {
      if (child instanceof Element && (child.tagName === "UL" || child.tagName === "OL")) nested.push(child)
      else own.push(child)
    }

    const checkbox = findCheckbox(own)
    const runs = inlineRuns(own)
    let childDepth = depth

    if (runs.length > 0 || nested.length === 0) {
      const type: TextualBlockType = checkbox !== null ? "todo" : ordered ? "ol" : "ul"
      state.blocks.push(
        createTextualBlock(
          type,
          runs,
          checkbox === null ? { depth } : { depth, checked: checkbox.hasAttribute("checked") },
        ),
      )
      childDepth = depth + 1
    }

    for (const child of nested) parseList(child, state, childDepth)
  }
}

/** 在列表项的自有内容里找复选框。只看自有内容，避免误吃嵌套列表里的待办。 */
function findCheckbox(nodes: readonly Node[]): Element | null {
  for (const node of nodes) {
    if (!(node instanceof Element)) continue
    if (isCheckbox(node)) return node
    const nested = node.querySelector('input[type="checkbox"]')
    if (nested !== null) return nested
  }
  return null
}

function isCheckbox(element: Element): boolean {
  return element.tagName === "INPUT" && element.getAttribute("type") === "checkbox"
}

/** 代码块：正文原样保留（不折叠空白），语言取 `<code class="language-x">`。 */
function parsePre(element: Element): Block {
  const code = element.querySelector(CODE_TAG)
  const source = code ?? element
  // 去掉源码排版惯用的首尾换行；块正文里的换行由 Shift+Enter 产生，不受影响。
  const text = (source.textContent ?? "").replace(/^\n/, "").replace(/\n+$/, "")
  const lang = languageOf(code)

  // `<pre><code class="language-mermaid">` 是 mermaid 在 markdown 围栏之外的通用写法，
  // 别的编辑器和剪藏页面都这么存。认它，图才能被升成图块而不是摆成一段看不懂的代码。
  if (lang === "mermaid") return createMermaidBlock(text)

  return createTextualBlock("code", textToRuns(text), { lang: lang ?? "" })
}

function languageOf(code: Element | null): string | null {
  if (code === null) return null
  const match = /\blanguage-([\w#+.-]+)/.exec(code.className)
  return match === null ? null : match[1]
}

function parseTable(table: HTMLTableElement): TableBlock {
  const rows: TableCell[][] = []

  for (const row of table.rows) {
    const cells: TableCell[] = []
    for (const cell of row.cells) {
      cells.push({ header: cell.tagName === "TH", runs: inlineRunsOf(cell) })
    }
    rows.push(cells)
  }

  return createTableBlock(rows)
}

function imageBlockOf(element: Element): ImageBlock {
  return createImageBlock(
    element.getAttribute("src") ?? "",
    element.getAttribute("alt") ?? "",
    element.getAttribute("title") ?? "",
  )
}
