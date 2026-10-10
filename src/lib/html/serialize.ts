import type { Block, ImageBlock, MermaidBlock, TableCell, TextualBlock } from "@/types/workspace"
import { isListBlock } from "@/lib/blocks"
import type { ListBlockType } from "@/lib/blocks"
import { escapeHtml, runsText, runsToHtml } from "@/lib/inline"
import { docStyle } from "@/lib/typography"

/**
 * 块列表 → HTML。
 *
 * 产物是**规范形式**：同一个块序列永远得到同一份 HTML，与它最初从哪种写法解析来无关。
 * 解析器认的面比这里宽（脏 HTML、`<div>` 套 `<span>`、h4…），但只从这里输出一种写法 ——
 * 双方靠这个不对称成立：`parseHtml(blocksToHtml(x))` 是精确可逆的，
 * 而脏输入先被规范化、之后每一轮往返都稳定。
 *
 * 换行 / 缩进只是为了文件可读；解析器会折叠空白，缩进不会进正文。
 *
 * 自带样式（`docStyle()`）与编辑器排版规格同源，都出自 `@/lib/typography` ——
 * 「编辑器里看到什么，双击打开就是什么」这条约定由那份规格保证，不在这里复述。
 */
const DOC_STYLE = docStyle()

export interface DocumentMeta {
  /** 文档标题，写进 `<title>`。一般取文件名去扩展名。 */
  title: string
}

/** 块列表 → `<body>` 里的 HTML 片段。自检与往返测试直接用这个。 */
export function blocksToHtml(blocks: readonly Block[]): string {
  const out: string[] = []

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]

    // 不承载 runs 的形态必须在这里逐个拦下 —— 漏一个就会掉进 `plainHtml()` 当正文块处理，
    // 那里取 `block.runs` 拿到 undefined，序列化出来的是一段空白而不是报错。
    if (block.type === "image") {
      out.push(imageHtml(block))
      continue
    }
    if (block.type === "table") {
      out.push(tableHtml(block.rows))
      continue
    }
    if (block.type === "mermaid") {
      out.push(mermaidHtml(block))
      continue
    }
    if (isListBlock(block)) {
      // 吃掉连续的一段列表类块，交给建树逻辑按 depth 收成嵌套结构。
      const run: TextualBlock[] = []
      while (index < blocks.length) {
        const item = blocks[index]
        if (!isListBlock(item)) break
        run.push(item)
        index += 1
      }
      index -= 1
      out.push(levelsHtml(buildLevels(run), ""))
      continue
    }

    out.push(plainHtml(block))
  }

  return out.join("\n")
}

/** 块列表 → 可直接双击打开的完整 HTML 文档。 */
export function serializeHtml(blocks: readonly Block[], meta: DocumentMeta): string {
  const title = meta.title === "" ? "未命名" : meta.title

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${DOC_STYLE}
</style>
</head>
<body>
${blocksToHtml(blocks)}
</body>
</html>
`
}

/** 非列表的正文块。列表类不走这里 —— 它们要合进同一个 `<ul>`/`<ol>`。 */
function plainHtml(block: TextualBlock): string {
  switch (block.type) {
    case "text":
      return wrap("p", runsToHtml(block.runs))
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      return wrap(block.type, runsToHtml(block.runs))
    case "quote":
      return wrap("blockquote", runsToHtml(block.runs))
    case "callout":
      return wrap("aside", runsToHtml(block.runs))
    case "code":
      return codeHtml(block)
    case "divider":
      return "<hr>"
    default:
      // ul / ol / todo 已在 blocksToHtml 里被拦下。真走到这里说明调用方漏判，
      // 退化成段落至少不丢内容。
      return wrap("p", runsToHtml(block.runs))
  }
}

function wrap(tag: string, inner: string, attributes = ""): string {
  return `<${tag}${attributes}>${inner}</${tag}>`
}

/** 代码块用 `<pre><code>` 两层：语言标识挂在 `<code class="language-x">` 上，与常见约定一致。 */
function codeHtml(block: TextualBlock): string {
  const lang = block.lang ?? ""
  const attribute = lang === "" ? "" : ` class="language-${escapeHtml(lang)}"`
  // 不去动换行：代码块里的换行是内容，escapeTextToHtml 那套 `<br>` 转换在这里是错的。
  return `<pre><code${attribute}>${escapeHtml(runsText(block.runs))}</code></pre>`
}

function imageHtml(block: ImageBlock): string {
  const title = block.title === "" ? "" : ` title="${escapeHtml(block.title)}"`
  return `<img src="${escapeHtml(block.src)}" alt="${escapeHtml(block.alt)}"${title}>`
}

/**
 * Mermaid 图块 → `<pre><code class="language-mermaid">`。
 *
 * 与 markdown 生态（```mermaid 围栏）以及别的编辑器一致，GitHub / Obsidian / Typora
 * 都认这个形态，导出物不会被锁死在本项目里。
 *
 * **代价写在明处**：导出的单文件用浏览器直接打开时看到的是一段源码，不是图。
 * 换成内联渲染好的 SVG 能让它好看，但 `blocksToHtml` 就不再是纯函数（要等异步渲染
 * 回来），「解析 ⇄ 序列化精确可逆」这条不变式也跟着断 —— 那两条是本项目的硬约定，
 * 所以这里守住源码形态，可视化留在编辑器里。
 */
function mermaidHtml(block: MermaidBlock): string {
  return `<pre><code class="language-mermaid">${escapeHtml(block.source)}</code></pre>`
}

/** 复选框后面留一个空格：纯为可读性，解析时会被 trimRuns 掐掉。 */
function checkboxHtml(checked: boolean): string {
  return checked ? '<input type="checkbox" checked> ' : '<input type="checkbox"> '
}

/**
 * 单元格的对齐内联样式。
 *
 * 必须是**内联**的：`DOC_STYLE` 里 `th, td { text-align: left }` 的选择器优先级高于
 * 继承来的值，写成 `<col style="text-align:center">` 会被它整条压掉，导出的文件里
 * 对齐根本没生效。左对齐不写 —— 那就是 DOC_STYLE 的默认值，写了只是让每个格子变脏。
 */
function alignAttribute(cell: TableCell): string {
  const align = cell.align
  if (align === undefined || align === "left") return ""
  return ` style="text-align:${align}"`
}

function tableHtml(rows: readonly TableCell[][]): string {
  if (rows.length === 0) return "<table></table>"

  const head: string[] = []
  const body: string[] = []

  for (const row of rows) {
    const cells = row
      .map((cell) => wrap(cell.header ? "th" : "td", runsToHtml(cell.runs), alignAttribute(cell)))
      .join("")
    const line = `      <tr>${cells}</tr>`
    if (row.length > 0 && row.every((cell) => cell.header)) head.push(line)
    else body.push(line)
  }

  const parts = ["<table>"]
  if (head.length > 0) parts.push("  <thead>", ...head, "  </thead>")
  if (body.length > 0) parts.push("  <tbody>", ...body, "  </tbody>")
  parts.push("</table>")

  return parts.join("\n")
}

// ---- 嵌套列表 ----

/** 连续出现时要合进同一个 `<ul>`/`<ol>` 的块类型 —— 判定只有 `isListBlock` 一份。 */
type ListKind = ListBlockType

interface ListItemNode {
  block: TextualBlock
  /** 该条目内部继续嵌套的层级。类型不同时会有多个，依次排开（`<li>a<ul>…</ul><ol>…</ol></li>` 合法）。 */
  children: ListLevel[]
}

interface ListLevel {
  kind: ListKind
  items: ListItemNode[]
}

/** 列表块在 HTML 里的归属；非列表族返回 null。 */
function listKindOf(block: TextualBlock): ListKind | null {
  return isListBlock(block) ? block.type : null
}

/**
 * 平铺的列表块 → 层级结构。
 *
 * `depth` 是解析时从嵌套 `<ul>` 里数出来的，可能因为模型变动而越级（比如手工构造的
 * 数据里首个块 depth 就是 2）。`Math.min(block.depth, levels.length)` 把它夹到
 * 「最多比当前深一层」，越级输入会退化成平铺而不是抛错。
 *
 * 同 depth 但类型变了（ul 里插了一段 ol），不合并也不报错 —— 在同一层挂一个新列表，
 * 渲染出来就是 `<li>…<ul>…</ul><ol>…</ol></li>`。
 */
function buildLevels(blocks: readonly TextualBlock[]): ListLevel[] {
  const roots: ListLevel[] = []
  /**
   * 当前每个深度上打开的层级。声明成 `(ListLevel | undefined)[]` 而不是 `ListLevel[]`：
   * 它是按需稀疏填充的，元素可能为空；把空态写进类型里，下面才不用靠断言绕开检查。
   */
  const levels: (ListLevel | undefined)[] = []

  /** 某一层的父级容器：depth 0 挂到 roots，更深挂到上一层最后一个条目的 children 里。 */
  const containerOf = (depth: number): ListLevel[] => {
    if (depth === 0) return roots
    const parent = levels[depth - 1]
    if (parent === undefined) return roots
    if (parent.items.length === 0) return roots
    const owner = parent.items[parent.items.length - 1]
    return owner.children
  }

  for (const block of blocks) {
    const kind = listKindOf(block)
    if (kind === null) continue

    const depth = Math.min(block.depth, levels.length)
    const existing = depth < levels.length ? levels[depth] : undefined

    if (existing !== undefined && existing.kind === kind) {
      // 复用该层，关掉比它更深的层级。
      levels.length = depth + 1
    } else {
      levels.length = depth
      const level: ListLevel = { kind, items: [] }
      containerOf(depth).push(level)
      levels[depth] = level
    }

    const level = levels[depth]
    if (level === undefined) continue
    level.items.push({ block, children: [] })
  }

  return roots
}

function levelsHtml(levels: readonly ListLevel[], indent: string): string {
  return levels.map((level) => levelHtml(level, indent)).join("\n")
}

function levelHtml(level: ListLevel, indent: string): string {
  const tag = level.kind === "ol" ? "ol" : "ul"
  const inner = indent + "  "
  const items = level.items.map((item) => itemHtml(item, inner)).join("\n")
  return `${indent}<${tag}>\n${items}\n${indent}</${tag}>`
}

function itemHtml(item: ListItemNode, indent: string): string {
  const head =
    item.block.type === "todo"
      ? checkboxHtml(item.block.checked === true) + runsToHtml(item.block.runs)
      : runsToHtml(item.block.runs)
  const children =
    item.children.length === 0 ? "" : `\n${levelsHtml(item.children, indent + "  ")}\n${indent}`
  return `${indent}<li>${head}${children}</li>`
}
