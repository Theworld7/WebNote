import type { Block, BookmarkBlock, DataTableBlock, GalleryBlock, ImageBlock, LayoutBlock, MermaidBlock, TableCell, TextualBlock } from "@/types/workspace"
import type { DataTable } from "@/types/data-table"
import { GALLERY_RATIO_DEFAULT, GALLERY_WIDTH_DEFAULT, LAYOUT_COLUMNS_DEFAULT, isListBlock } from "@/lib/blocks"
import type { ListBlockType } from "@/lib/blocks"
import { cellValue, valueText } from "@/lib/data-table"
import { escapeHtml, escapeTextToHtml, linkIcon, runsText, runsToHtml } from "@/lib/inline"
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

/**
 * 引用块 → 快照表格时用的数据来源。
 *
 * **必须是同步的纯查询**：`blocksToHtml` 是纯函数（见 `mermaidHtml` 的注释），不能
 * 在这里 `await` 读盘。调用方（`useWorkspace.saveTab`）先把要用的表读进内存，
 * 再把这张查找表传进来 —— 于是「读盘」留在 composable 那边，「拼 HTML」留在这里，
 * 两边各自仍然可测。
 *
 * 返回 `null` 表示这张表读不到（被删了、移走了、解析失败）。此时快照降级成一句提示，
 * 而不是抛错 —— 导出不该因为一个失效引用而整个失败。
 */
export type DataTableLookup = (path: string) => DataTable | null

/**
 * 块列表 → `<body>` 里的 HTML 片段。自检与往返测试直接用这个。
 *
 * `lookupTables` 缺省时，引用块一律写成提示态 —— 这是自检页与纯往返测试想要的形态
 * （不碰文件系统），而导出路径会传进来。
 */
export function blocksToHtml(blocks: readonly Block[], lookupTables?: DataTableLookup): string {
  const out: string[] = []
  const lookup = lookupTables ?? (() => null)

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
    if (block.type === "datatable") {
      out.push(dataTableHtml(block, lookup(block.path)))
      continue
    }
    if (block.type === "gallery") {
      out.push(galleryHtml(block, lookup(block.path)))
      continue
    }
    if (block.type === "bookmark") {
      out.push(bookmarkHtml(block, lookup(block.path)))
      continue
    }
    if (block.type === "layout") {
      out.push(layoutHtml(block, lookup))
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
export function serializeHtml(
  blocks: readonly Block[],
  meta: DocumentMeta,
  lookupTables?: DataTableLookup,
): string {
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
${blocksToHtml(blocks, lookupTables)}
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

/**
 * 布局块 → `<div class="note-layout" data-layout="…">` 包若干 `<section>`（ADR-0007）。
 *
 * 格子内容就是普通块 HTML —— 直接递归回 `blocksToHtml`，容器块不另立一套读写规则，
 * 「解析 ⇄ 序列化精确可逆」对格子里的块同样成立。`data-columns` 只在 grid 且非缺省
 * 列数时写出（缺省即 2 不落存储）；flex 不认列数，一律不写。
 */
function layoutHtml(block: LayoutBlock, lookup: DataTableLookup): string {
  const columns =
    block.mode === "grid" && block.columns !== undefined && block.columns !== LAYOUT_COLUMNS_DEFAULT
      ? ` data-columns="${block.columns}"`
      : ""
  const cells = block.cells.map((cell) => `  <section>${blocksToHtml(cell, lookup)}</section>`).join("\n")
  const inner = cells === "" ? "" : `\n${cells}\n`
  return `<div class="note-layout" data-layout="${block.mode}"${columns}>${inner}</div>`
}

/**
 * 数据表引用块 → **快照表格**（见 ADR-0005 的「An exported Note writes the table's
 * contents, not a pointer」）。
 *
 * 写出的是**当前内容**而不是指针：导出的文件要能在没有那个 `.tbl` 的地方被双击打开，
 * 这是本项目最核心的一条承诺。代价是这份内容**不会回头同步** —— 它是一张快照，
 * 与「另存为一份副本」是同一件事。
 *
 * 因此还原路径上它变成普通 `TableBlock`（`parse.ts` 不需要任何改动，`<table>` 本来
 * 就解析成表格块）：读到的文件里确实就是一张表，把它读成表是**正确的**读法。
 * 「本来是引用」这件事没有被写进文件，也不再被推断 —— 推断它需要一条猜测规则。
 *
 * 表读不到时写一句提示而不是抛错：导出不该因为一个失效引用整个失败。
 */
function dataTableHtml(block: DataTableBlock, table: DataTable | null): string {
  if (table === null) {
    return `<p><em>（引用的数据表读不到：${escapeHtml(block.path)}）</em></p>`
  }

  const headLine = `      <tr>${table.columns.map((column) => wrap("th", escapeTextToHtml(column.name))).join("")}</tr>`
  const bodyLines = table.rows.map((row) => {
    const cells = table.columns
      .map((column) => {
        const value = cellValue(row, column)
        // 图片格导出成真正的 `<img>`（与 imageHtml 同款转义）：快照的价值是「双击就能看」，
        // 一格 base64 文本不是看。data URI 内联，导出的单文件依旧自包含。回读时 td 里的
        // img 会被丢掉、格子变空 —— Snapshot exception 的既有范围，不再另行处理。
        if (column.type === "image" && typeof value === "string") {
          return wrap("td", `<img src="${escapeHtml(value)}" alt="">`)
        }
        return wrap("td", escapeTextToHtml(valueText(value, column)))
      })
      .join("")
    return `      <tr>${cells}</tr>`
  })

  const parts = ["<table>", "  <thead>", headLine, "  </thead>"]
  if (bodyLines.length > 0) parts.push("  <tbody>", ...bodyLines, "  </tbody>")
  parts.push("</table>")

  return parts.join("\n")
}

/**
 * 画册块 → **快照 + 指针**（ADR-0006）。
 *
 * 内容与 `dataTableHtml` 同源同构：一张快照表格，图片格照旧内联 data URI ——
 * 拿到导出文件的人双击就能看全全部内容，「不带 .tbl 也能读」的承诺不变。
 * 与它的差别只有一层 `data-*` 属性：画册的列数、填充、字段显隐是**块的设置**，
 * 丢了要重新配，所以随快照一并写进文件，编辑器据此把它还原成活的画册块；
 * 第三方编辑器剥掉这些属性也无妨，剩下的就是一张普通表格（与数据表引用块的
 * 现状等价）。
 *
 * 表读不到时**仍然写出**带属性的空表：设置跟着笔记走，不因一次读盘失败蒸发；
 * 重开时块自己走「读不到」的提示态。
 *
 * 属性只写非默认值（对齐 `TableBlock` 对齐属性的缺省立场）：默认配置的画册块
 * 在盘上与数据表快照仅差一个 `data-gallery`，人类直接读文件也不觉得吵。
 */
function galleryHtml(block: GalleryBlock, table: DataTable | null): string {
  const attrs = [`data-gallery="${escapeHtml(block.path)}"`]
  if (block.columns !== "auto") attrs.push(`data-columns="${block.columns}"`)
  if (block.ratio !== GALLERY_RATIO_DEFAULT) attrs.push(`data-ratio="${escapeHtml(block.ratio)}"`)
  if (block.width !== GALLERY_WIDTH_DEFAULT) attrs.push(`data-width="${block.width}"`)
  if (block.fit !== "cover") attrs.push(`data-fit="${block.fit}"`)
  if (block.hiddenFields.length > 0) attrs.push(`data-fields="${escapeHtml(block.hiddenFields.join(","))}"`)
  if (block.group !== "") attrs.push(`data-group="${escapeHtml(block.group)}"`)
  if (block.groupBy !== "") attrs.push(`data-group-by="${escapeHtml(block.groupBy)}"`)
  if (block.groupOrder.length > 0) attrs.push(`data-group-order="${escapeHtml(block.groupOrder.join(","))}"`)

  // 没有内容可写（表读不到 / 空表）就留一张带属性的空表 —— 表格骨架是
  // 「这是一个画册块」的最小形态，浏览器渲染出来也只是什么都没有，不会坏。
  if (table === null || table.rows.length === 0) {
    return `<table ${attrs.join(" ")}></table>`
  }

  const headLine = `      <tr>${table.columns.map((column) => wrap("th", escapeTextToHtml(column.name))).join("")}</tr>`
  const bodyLines = table.rows.map((row) => {
    const cells = table.columns
      .map((column) => {
        const value = cellValue(row, column)
        if (column.type === "image" && typeof value === "string") {
          return wrap("td", `<img src="${escapeHtml(value)}" alt="">`)
        }
        return wrap("td", escapeTextToHtml(valueText(value, column)))
      })
      .join("")
    return `      <tr>${cells}</tr>`
  })

  const parts = [`<table ${attrs.join(" ")}>`, "  <thead>", headLine, "  </thead>"]
  if (bodyLines.length > 0) parts.push("  <tbody>", ...bodyLines, "  </tbody>")
  parts.push("</table>")

  return parts.join("\n")
}

/**
 * 书签块 → **快照 + 指针**（与画册同一条 ADR-0006 立场）。
 *
 * 写出的是当前内容：每行一张 `<li>`，里面一枚 `<a data-link-shape="card">` ——
 * 与行内链接的书签卡片同一套标记与样式，导出文件双击就能看，指针（`data-bookmark`
 * 与字段选择）让它回编辑器后还是一块活的书签。名称列 / 链接列指向的列被删后,
 * 渲染态走「未设置 / 读不到」提示,快照保持最后见过的样子。
 *
 * 表读不到时仍写出带属性的空列表:指针跟着笔记走,重开时块自己走提示态。
 */
function bookmarkHtml(block: BookmarkBlock, table: DataTable | null): string {
  const attrs = [`data-bookmark="${escapeHtml(block.path)}"`]
  if (block.nameColumn !== "") attrs.push(`data-name="${escapeHtml(block.nameColumn)}"`)
  if (block.urlColumn !== "") attrs.push(`data-url="${escapeHtml(block.urlColumn)}"`)
  // 图标列只写非默认值:没设时读回端按链接派生,两边的缺省语义一致。
  if (block.iconColumn !== undefined && block.iconColumn !== "") attrs.push(`data-icon-column="${escapeHtml(block.iconColumn)}"`)
  // 分组字段只写指针:快照仍是平铺的卡片清单(与画册快照不画节标题同一立场),
  // 回编辑器后由活数据重新分节。
  if (block.groupBy !== undefined && block.groupBy !== "") attrs.push(`data-group-by="${escapeHtml(block.groupBy)}"`)
  if (block.columns !== "auto") attrs.push(`data-columns="${block.columns}"`)

  if (table === null) return `<ul class="note-bookmarks" ${attrs.join(" ")}></ul>`

  const nameColumn = table.columns.find((column) => column.id === block.nameColumn)
  const urlColumn = table.columns.find((column) => column.id === block.urlColumn)
  // 图标列设了就以列值为准(快照固化派生结果),空值逐行回退到链接派生。
  const iconColumn =
    block.iconColumn === undefined || block.iconColumn === "" ? undefined : table.columns.find((column) => column.id === block.iconColumn)
  const items = table.rows.map((row) => {
    const name = nameColumn === undefined ? "" : valueText(cellValue(row, nameColumn), nameColumn)
    const url = urlColumn === undefined ? "" : valueText(cellValue(row, urlColumn), urlColumn)
    const icon =
      iconColumn === undefined ? "" : valueText(cellValue(row, iconColumn), iconColumn).trim().charAt(0).toUpperCase()
    const card =
      url === ""
        ? escapeHtml(name)
        : `<a href="${escapeHtml(url)}" data-link-shape="card" data-icon="${escapeHtml(icon === "" ? linkIcon(url) : icon)}">${escapeHtml(name)}</a>`
    return `    <li>${card}</li>`
  })
  const inner = items.length === 0 ? "" : `\n${items.join("\n")}\n`

  return `<ul class="note-bookmarks" ${attrs.join(" ")}>${inner}</ul>`
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
