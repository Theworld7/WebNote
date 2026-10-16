import type { Block, BookmarkBlock, ChatBlock, DataTableBlock, GalleryBlock, ImageBlock, KanbanBlock, LayoutBlock, LedgerBlock, MermaidBlock, StatBlock, TableCell, TextualBlock } from "@/types/workspace"
import type { DataColumn, DataTable, DataRow } from "@/types/data-table"
import { GALLERY_RATIO_DEFAULT, GALLERY_WIDTH_DEFAULT, LAYOUT_COLUMNS_DEFAULT, isListBlock } from "@/lib/blocks"
import type { ListBlockType } from "@/lib/blocks"
import { cellValue, filterRowsByValue, formatGrouped, groupRows, kanbanCardColor, STAT_PRECISION_DEFAULT, sumColumn, valueText } from "@/lib/data-table"
import { balanceMap, formatAmount, formatExpense, formatIncome, formatYuan, ledgerSections, sumRows } from "@/lib/ledger"
import type { LedgerSection, LedgerTotals } from "@/lib/ledger"
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
    if (block.type === "kanban") {
      out.push(kanbanHtml(block, lookup(block.path)))
      continue
    }
    if (block.type === "ledger") {
      out.push(ledgerHtml(block, lookup(block.path)))
      continue
    }
    if (block.type === "stat") {
      out.push(statHtml(block, lookup(block.path)))
      continue
    }
    if (block.type === "chat") {
      out.push(chatHtml(block))
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

/**
 * 表格块 → HTML。盘上 `.html` 与剪贴板的「复制内容」共用这一个函数 ——
 * 两处的表格形态必须逐字同源,导出去的笔记和粘到 Excel 的网格才不会长成两张表。
 */
export function tableHtml(rows: readonly TableCell[][]): string {
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
 * 数据表引用块快照表格的唯一真源:表头 + 表体 + `thead`/`tbody` 骨架。
 *
 * 只剩数据表引用块一个消费者 —— 画册 / 看板 / 书签的导出已换成展示快照
 * (卡片 / 看板列 / 书签宫格,与编辑器视图同构),不再落表格形态。
 * 图片格导出成真正的 `<img>`（与 `imageHtml` 同款转义,快照的价值是「双击就能看」,
 * 一格 base64 文本不是看;data URI 内联,导出的单文件依旧自包含。回读时 td 里的
 * img 会被丢掉、格子变空 —— Snapshot exception 的既有范围,不再另行处理）;
 * 其余格子走 `valueText` 文本投影。
 */
function snapshotTableHtml(table: DataTable): string {
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

  const parts = ["<table>", "  <thead>", headLine, "  </thead>"]
  if (bodyLines.length > 0) parts.push("  <tbody>", ...bodyLines, "  </tbody>")
  parts.push("</table>")

  return parts.join("\n")
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
  return snapshotTableHtml(table)
}

/**
 * 画册块 → **展示快照 + 指针**（ADR-0006）。
 *
 * 导出的不是数据表快照表格，而是**与编辑器默认视图同构**的卡片 HTML：分节
 * （`data-group-by`）、聚合叠卡（`data-group`，按应用打开时的默认态画成折叠）、
 * 海报卡（列数 / 比例 / 宽度 / 填充 / 字段显隐）全部按当前设置呈现 ——
 * 「编辑器里看到什么，双击打开就是什么」由这里兑现；菜单按钮与展开交互不导出。
 *
 * 指针属性原样挂在容器 `div` 上，解析端凭它认领回活的画册块（内容仍从 `.tbl` 来，
 * 静态卡片只是快照）。旧版写法（`<table data-gallery>`）解析端继续认，老文件不受影响；
 * 剥掉属性后剩下的是一份静态卡片，按正文读是「正确的读法」。
 *
 * 表读不到时**仍然写出**带属性的空容器：设置跟着笔记走，不因一次读盘失败蒸发；
 * 重开时块自己走「读不到」的提示态。
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

  const openTag = `<div class="note-gallery" ${attrs.join(" ")}>`
  if (table === null || table.rows.length === 0) return openTag + "</div>"

  const posterStyle = galleryPosterStyle(block)
  const sections = gallerySections(block, table).map((section) => {
    const title = section.title === null ? "" : `  <p class="note-sec-title">${escapeHtml(section.title)}</p>\n`
    const cards = section.units.map((unit) => galleryUnitHtml(unit, table, block, posterStyle)).join("\n")
    return `${title}  <div class="note-gallery-grid"${gridAttribute(block.columns)}>\n${cards}\n  </div>`
  })
  return `${openTag}\n${sections.join("\n")}\n</div>`
}

/** 自定义列数写内联 grid 声明（响应式交给浏览器，与编辑器同一口径）。 */
function gridAttribute(columns: "auto" | number): string {
  return columns === "auto" ? "" : ` style="grid-template-columns:repeat(${columns},minmax(0,1fr))"`
}

/** 海报区的内联样式：比例与宽度百分比，与编辑器 `posterStyle` 同一几何。 */
function galleryPosterStyle(block: GalleryBlock): string {
  const parts = block.ratio.split(":")
  let style = `aspect-ratio:${parts[0] ?? 2} / ${parts[1] ?? 3}`
  if (block.width !== GALLERY_WIDTH_DEFAULT) style += `;width:${block.width}%;margin-inline:auto`
  return style
}

/** ---- 画册视图逻辑的静态镜像（默认态 = 聚合全部折叠），与 GalleryBlockView 对齐 ---- */

interface GalleryUnit {
  /** true = 聚合态,画成叠卡(代表卡 + 骨架);false = 逐行平铺。 */
  stacked: boolean
  lead: DataRow
  rows: readonly DataRow[]
}

interface GallerySection {
  /** 节标题;null = 不画标题行(未开分组)。 */
  title: string | null
  units: GalleryUnit[]
}

/** 分节(分组列 + 手排)与节内聚合(聚合列归桶,≥2 行折叠),规则口径见 `dt.groupRows`。 */
function gallerySections(block: GalleryBlock, table: DataTable): GallerySection[] {
  const byColumn = block.groupBy === "" ? null : table.columns.find((column) => column.id === block.groupBy) ?? null
  // 聚合列与分组列撞字段时退化为平铺 —— 同一列又分节又堆叠没有读法(编辑器同款规则)。
  const aggColumn = block.group === block.groupBy ? null : table.columns.find((column) => column.id === block.group) ?? null
  if (byColumn === null) return [{ title: null, units: galleryUnits(table.rows, aggColumn) }]

  const { groups: bucketed, loose } = groupRows(table.rows, byColumn, { manualOrder: block.groupOrder })
  const out: GallerySection[] = bucketed.map((bucket) => ({ title: bucket.title, units: galleryUnits(bucket.rows, aggColumn) }))
  if (loose.length > 0) out.push({ title: "未分组", units: galleryUnits(loose, aggColumn) })
  return out
}

/**
 * 聚合归桶:空值行不聚合、按首现序出组、单行组平铺 —— 与编辑器 `buildUnits` 同一套,
 * 差别只有聚合态恒为折叠(静态文件没有「展开」这层交互)。
 */
function galleryUnits(rows: readonly DataRow[], column: DataColumn | null): GalleryUnit[] {
  if (column === null) return rows.map((row) => ({ stacked: false, lead: row, rows: [row] }))

  const buckets = new Map<string, DataRow[]>()
  for (const row of rows) {
    const value = cellValue(row, column)
    if (value === null || value === "") continue
    const key = String(value)
    const bucket = buckets.get(key)
    if (bucket === undefined) buckets.set(key, [row])
    else bucket.push(row)
  }

  const seen = new Set<string>()
  const out: GalleryUnit[] = []
  for (const row of rows) {
    const value = cellValue(row, column)
    if (value === null || value === "") {
      out.push({ stacked: false, lead: row, rows: [row] })
      continue
    }
    const key = String(value)
    if (seen.has(key)) continue
    seen.add(key)
    const bucket = buckets.get(key)
    const lead = bucket?.[0]
    if (bucket === undefined || lead === undefined) continue
    out.push({ stacked: bucket.length >= 2, lead, rows: bucket })
  }
  return out
}

function galleryUnitHtml(unit: GalleryUnit, table: DataTable, block: GalleryBlock, posterStyle: string): string {
  const card = galleryCardHtml(unit.lead, table, block, posterStyle)
  if (!unit.stacked) return card
  // 叠卡:骨架两叠垫在代表卡后面,几何由 `.note-gstack` 的伪元素负责。
  return `<div class="note-gstack">\n${card}\n</div>`
}

/** 海报 = 第一个图片列的值(可空,落占位块),与编辑器 `posterOf` 同一取法。 */
function galleryPosterOf(row: DataRow, columns: readonly DataColumn[]): string {
  for (const column of columns) {
    if (column.type !== "image") continue
    const value = cellValue(row, column)
    if (typeof value === "string") return value
  }
  return ""
}

function galleryCardHtml(row: DataRow, table: DataTable, block: GalleryBlock, posterStyle: string): string {
  const poster = galleryPosterOf(row, table.columns)
  const style = posterStyle === "" ? "" : ` style="${escapeHtml(posterStyle)}"`
  const media =
    poster === ""
      ? `  <div class="note-gposter"${style}></div>`
      : `  <img src="${escapeHtml(poster)}" alt=""${style}>`
  // 字段 = 非图片列 − 被隐藏的列(海报位只认图片列,与编辑器 `visibleColumns` 一致)。
  const fields = table.columns
    .filter((column) => column.type !== "image" && !block.hiddenFields.includes(column.id))
    .map((column) => galleryFieldHtml(row, column))
    .join("")
  return `<figure class="note-gcard">\n${media}\n  <figcaption>${fields}</figcaption>\n</figure>`
}

function galleryFieldHtml(row: DataRow, column: DataColumn): string {
  const text = valueText(cellValue(row, column), column)
  const value =
    text === "" ? '<span class="v note-empty">空</span>' : `<span class="v">${escapeHtml(text)}</span>`
  return `<span class="note-gfield"><span class="k">${escapeHtml(column.name)}</span>${value}</span>`
}

/**
 * 看板块 → **展示快照 + 指针**(与画册同一条 ADR-0006 立场,详见 ADR-0008)。
 *
 * 导出的不是数据表快照表格,而是**与编辑器默认视图同构**的看板 HTML:按分组列
 * 分列、「未分组」列恒在最左、便签卡带行 id 哈希出的固定浅色(`dt.kanbanCardColor`,
 * 与编辑器同一真源)。静态文件没有拖拽与就地编辑,卡片是纯展示 —— 菜单按钮不导出。
 *
 * 指针属性(`data-group` / `data-fields` / `data-group-order` / `data-show-empty`)
 * 原样挂在容器 `div` 上,解析端凭它认领回活的看板块;旧版写法
 * (`<table data-kanban>`)继续认。`data-fields` 存**显示列** id(正向,看板块独有
 * 语义),与画册 `data-fields` 存**隐藏列** id(反向)语义相反 —— 两者分属不同的
 * 块类型属性,解析端各按其块认领。
 *
 * 未选分组列(或指向的列被删)时编辑器走「请选分组列」提示态,静态按同一立场
 * 只写空容器:设置不蒸发,内容不瞎猜。表读不到同理。
 */
function kanbanHtml(block: KanbanBlock, table: DataTable | null): string {
  const attrs = [`data-kanban="${escapeHtml(block.path)}"`]
  if (block.groupColumnId !== "") attrs.push(`data-group="${escapeHtml(block.groupColumnId)}"`)
  if (block.displayColumnIds.length > 0) attrs.push(`data-fields="${escapeHtml(block.displayColumnIds.join(","))}"`)
  if (block.groupOrder.length > 0) attrs.push(`data-group-order="${escapeHtml(block.groupOrder.join(","))}"`)
  if (block.showEmptyGroups) attrs.push(`data-show-empty="true"`)

  const openTag = `<div class="note-kanban" ${attrs.join(" ")}>`
  if (table === null || table.rows.length === 0) return openTag + "</div>"

  const groupColumn = table.columns.find((column) => column.id === block.groupColumnId) ?? null
  if (groupColumn === null) return openTag + "</div>"

  const { groups: bucketed, loose } = groupRows(table.rows, groupColumn, {
    manualOrder: block.groupOrder,
    emptySelectGroups: block.showEmptyGroups,
  })
  const lanes: { title: string; rows: readonly DataRow[] }[] = []
  if (loose.length > 0 || block.showEmptyGroups) lanes.push({ title: "未分组", rows: loose })
  for (const group of bucketed) lanes.push({ title: group.title, rows: group.rows })

  // 卡片字段:全显模式(记录为空)下分组列由列头表达、不上卡片;显式清单按序过滤失效 id。
  const fields =
    block.displayColumnIds.length === 0
      ? table.columns.filter((column) => column.id !== block.groupColumnId)
      : block.displayColumnIds
          .map((id) => table.columns.find((column) => column.id === id))
          .filter((column): column is DataColumn => column !== undefined)

  const sections = lanes.map((lane) => {
    const cards = lane.rows.map((row) => kanbanCardHtml(row, fields)).join("\n")
    const inner = cards === "" ? "" : `\n${cards}\n  `
    return `  <section class="note-kcol">\n    <header><span class="t">${escapeHtml(lane.title)}</span><span class="n">${lane.rows.length}</span></header>\n    ${inner}</section>`
  })
  return `${openTag}\n${sections.join("\n")}\n</div>`
}

/**
 * 统计块 → **展示快照 + 指针**(与画册 / 看板同一条 ADR-0006 立场)。
 *
 * 快照是导出时刻的列名、合计与行数 —— 一个数字没有「可读全数据」可言,静态文件里它就是
 * 一个摘录。指针属性(`data-stat` / `data-column`)挂在容器 `div` 上,解析端凭它认领
 * 回活的统计块。未选列或表读不到时只写带属性的空容器:设置不蒸发,内容不瞎猜。
 */
function statHtml(block: StatBlock, table: DataTable | null): string {
  const attrs = [`data-stat="${escapeHtml(block.path)}"`]
  if (block.columnId !== "") attrs.push(`data-column="${escapeHtml(block.columnId)}"`)
  // 精度是非默认才写的设置,与列 id 同一立场:默认两位不落盘。
  if (block.precision !== undefined && block.precision !== STAT_PRECISION_DEFAULT) {
    attrs.push(`data-precision="${block.precision}"`)
  }
  // 筛选只在列 id 非空时生效;value 即使空串也写出 —— 「字段 = 空值」是合法的筛选条件。
  const filterColumnId = block.filterColumnId ?? ""
  const filterColumn =
    filterColumnId === "" || table === null
      ? null
      : table.columns.find((item) => item.id === filterColumnId) ?? null
  if (filterColumnId !== "") {
    attrs.push(`data-filter-column="${escapeHtml(filterColumnId)}"`)
    attrs.push(`data-filter-value="${escapeHtml(block.filterValue ?? "")}"`)
  }

  const openTag = `<div class="note-stat" ${attrs.join(" ")}>`
  const column = table === null ? null : table.columns.find((item) => item.id === block.columnId) ?? null
  if (table === null || column === null) return openTag + "</div>"

  // 筛选列被删后退回全表求和,与视图(filterColumn 落空)同一退化口径。
  const rows = filterColumn === null ? table.rows : filterRowsByValue(table.rows, filterColumn, block.filterValue ?? "")
  const filterText = filterColumn === null ? "" : ` · ${filterColumn.name} = ${block.filterValue ?? ""}`
  const precision = block.precision ?? STAT_PRECISION_DEFAULT
  // 第三行与应用内视图同一文案:参与求和的行数,开筛选时附全表行数。
  const countText =
    filterColumn === null
      ? `${rows.length} 行 · 求和`
      : `${rows.length} 行 / 共 ${table.rows.length} 行 · 求和`
  return `${openTag}<span class="k">${escapeHtml(column.name + filterText)}</span><span class="v">${formatGrouped(sumColumn(rows, column), precision)}</span><span class="c">${escapeHtml(countText)}</span></div>`
}

function kanbanCardHtml(row: DataRow, fields: readonly DataColumn[]): string {
  const cells = fields.map((column) => kanbanFieldHtml(row, column)).join("")
  return `<article class="note-kcard" style="background:${kanbanCardColor(row.id)}">${cells}</article>`
}

/** 卡片上一格:图片列显示「[图片]」占位(卡片小,不内联渲染图),勾选画出复选框,其余走文本投影。 */
function kanbanFieldHtml(row: DataRow, column: DataColumn): string {
  const label = `<span class="k">${escapeHtml(column.name)}</span>`
  if (column.type === "image") {
    const value = cellValue(row, column)
    const text = typeof value === "string" && value !== "" ? "[图片]" : ""
    return `<span class="note-kfield">${label}<span class="v${text === "" ? " note-empty" : ""}">${text === "" ? "空" : text}</span></span>`
  }
  if (column.type === "checkbox") {
    return `<span class="note-kfield">${label}<input type="checkbox"${cellValue(row, column) === true ? " checked" : ""}></span>`
  }
  const text = valueText(cellValue(row, column), column)
  const value =
    text === "" ? '<span class="v note-empty">空</span>' : `<span class="v">${escapeHtml(text)}</span>`
  return `<span class="note-kfield">${label}${value}</span>`
}

/**
 * 账目块 → **展示快照 + 指针**(与画册 / 看板同一条 ADR-0006 立场)。
 *
 * 导出与编辑器视图同构:一张带节标题行(按月 / 按列分组,标题行内带节小计)、
 * 余额列与合计行(`tfoot`)的普通表格 —— 双击打开就是一本可读的账,不依赖 `.tbl`。
 * 求和 / 格式化 / 分节全部走 `lib/ledger` 的同一份函数,与编辑器视图不算两遍。
 *
 * 指针属性(`data-income` / `data-expense` / `data-balance` / `data-group-mode` /
 * `data-group`)原样挂在容器 `div` 上,解析端凭 `data-ledger` 认领回活的账目块;
 * 剥掉属性后剩下的就是一张普通表格,按表格读是「正确的读法」。未设收入 / 支出列时
 * 快照退化成纯数据表格(没有金额格式化、余额列与合计),设置不蒸发。表读不到时仍
 * 写出带属性的空容器:指针跟着笔记走,重开时块自己走「读不到」的提示态。
 */
function ledgerHtml(block: LedgerBlock, table: DataTable | null): string {
  const attrs = [`data-ledger="${escapeHtml(block.path)}"`]
  if (block.incomeColumnId !== "") attrs.push(`data-income="${escapeHtml(block.incomeColumnId)}"`)
  if (block.expenseColumnId !== "") attrs.push(`data-expense="${escapeHtml(block.expenseColumnId)}"`)
  if (!block.showBalance) attrs.push(`data-balance="false"`)
  if (block.groupMode !== "none" && block.groupColumnId !== "") {
    attrs.push(`data-group-mode="${block.groupMode}"`)
    attrs.push(`data-group="${escapeHtml(block.groupColumnId)}"`)
  }

  const openTag = `<div class="note-ledger" ${attrs.join(" ")}>`
  if (table === null || table.rows.length === 0) return openTag + "</div>"

  const income = block.incomeColumnId === "" ? null : table.columns.find((column) => column.id === block.incomeColumnId) ?? null
  const expense = block.expenseColumnId === "" ? null : table.columns.find((column) => column.id === block.expenseColumnId) ?? null
  const groupColumn = block.groupMode === "none" ? null : table.columns.find((column) => column.id === block.groupColumnId) ?? null
  const hasMoney = income !== null || expense !== null
  const showBalance = block.showBalance && hasMoney
  const { sections, loose } = ledgerSections(table.rows, income, expense, {
    mode: groupColumn === null ? "none" : block.groupMode,
    column: groupColumn,
  })
  const balances = showBalance ? balanceMap(table.rows, income, expense) : null

  const allSections = loose === null ? sections : [...sections, loose]
  const columnCount = table.columns.length + (balances === null ? 0 : 1)

  const headCells = table.columns.map((column) => wrap("th", escapeTextToHtml(column.name))).join("")
  const headLine = `      <tr>${headCells}${balances === null ? "" : wrap("th", "余额")}</tr>`

  const rowLine = (row: DataRow): string => {
    const cells = table.columns.map((column) => {
      const value = cellValue(row, column)
      if (column === income) return wrap("td", escapeHtml(typeof value === "number" ? formatIncome(value) : ""), ' class="num in"')
      if (column === expense) return wrap("td", escapeHtml(typeof value === "number" ? formatExpense(value) : ""), ' class="num ex"')
      return wrap("td", escapeTextToHtml(valueText(value, column)))
    })
    if (balances !== null) {
      cells.push(wrap("td", escapeHtml(formatAmount(balances.get(row.id) ?? 0)), ' class="num"'))
    }
    return `      <tr>${cells.join("")}</tr>`
  }

  const groupLine = (section: LedgerSection): string => {
    const summary =
      section.totals.income === 0 && section.totals.expense === 0
        ? ""
        : ` <span class="s">收入 ${formatYuan(section.totals.income)} · 支出 ${formatYuan(section.totals.expense)}</span>`
    return `      <tr class="note-ledger-group"><th colspan="${columnCount}">${escapeHtml(section.title)}${summary}</th></tr>`
  }

  const bodyLines: string[] = []
  for (const section of allSections) {
    if (section.title !== "") bodyLines.push(groupLine(section))
    for (const row of section.rows) bodyLines.push(rowLine(row))
  }

  const parts = ["<table>", "  <thead>", headLine, "  </thead>", "  <tbody>", ...bodyLines, "  </tbody>"]
  if (hasMoney) {
    const totals = sumRows(table.rows, income, expense)
    parts.push(
      "  <tfoot>",
      `      <tr>${ledgerTotalsCells(table.columns, income, expense, totals)}${wrap("td", escapeHtml(`结余 ${formatYuan(totals.net)}`), ' class="num"')}</tr>`,
      "  </tfoot>",
    )
  }
  parts.push("</table>")

  return `${openTag}\n${parts.join("\n")}\n</div>`
}

/** 合计行里除余额外的格子:第一个非金额列放「合计」标签,金额列放各自的合计,其余留空。 */
function ledgerTotalsCells(
  columns: readonly DataColumn[],
  income: DataColumn | null,
  expense: DataColumn | null,
  totals: LedgerTotals,
): string {
  let labeled = false
  return columns
    .map((column) => {
      if (column === income) return wrap("td", escapeHtml(formatIncome(totals.income)), ' class="num in"')
      if (column === expense) return wrap("td", escapeHtml(formatExpense(totals.expense)), ' class="num ex"')
      if (!labeled) {
        labeled = true
        return wrap("td", "合计", ' class="lbl"')
      }
      return wrap("td", "")
    })
    .join("")
}

/**
 * 书签块 → **展示快照 + 指针**（与画册同一条 ADR-0006 立场）。
 *
 * 导出与编辑器同一构：`data-group-by` 分节（节标题 + 卡片宫格），每行一枚
 * `<a data-link-shape="card">` —— 与行内链接的书签卡片同一套标记与样式，指针
 * （`data-bookmark` 与字段选择）挂在容器 `div` 上让编辑器认领回活的块。旧版写法
 * （`<ul data-bookmark>`）解析端继续认。名称列 / 链接列指向的列被删后,渲染态走
 * 「未设置」提示,静态按同一立场只写空容器（与看板未选分组列的处理一致）。
 *
 * 表读不到时仍写出带属性的空容器:指针跟着笔记走,重开时块自己走提示态。
 * 图标保持字符派生(`data-icon`):图片图标的「加载成功才显示」靠运行时探测,
 * 静态文件做不到,退回与行内链接卡片同一的字符形态。
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

  const openTag = `<div class="note-bookmark" ${attrs.join(" ")}>`
  if (table === null) return openTag + "</div>"

  const nameColumn = table.columns.find((column) => column.id === block.nameColumn)
  const urlColumn = table.columns.find((column) => column.id === block.urlColumn)
  // 名称或链接列未设置:编辑器画「去设置」引导,静态同构地只留容器。
  if (nameColumn === undefined || urlColumn === undefined) return openTag + "</div>"
  // 图标列设了就以列值为准(快照固化派生结果),空值逐行回退到链接派生。
  const iconColumn =
    block.iconColumn === undefined || block.iconColumn === "" ? undefined : table.columns.find((column) => column.id === block.iconColumn)

  const byColumn =
    block.groupBy === undefined || block.groupBy === ""
      ? null
      : table.columns.find((column) => column.id === block.groupBy) ?? null
  const sections: { title: string | null; rows: readonly DataRow[] }[] = []
  if (byColumn === null) sections.push({ title: null, rows: table.rows })
  else {
    const { groups: bucketed, loose } = groupRows(table.rows, byColumn)
    for (const bucket of bucketed) sections.push({ title: bucket.title, rows: bucket.rows })
    if (loose.length > 0) sections.push({ title: "未分组", rows: loose })
  }

  const itemsOf = (rows: readonly DataRow[]): string =>
    rows
      .map((row) => {
        const name = valueText(cellValue(row, nameColumn), nameColumn)
        const url = valueText(cellValue(row, urlColumn), urlColumn)
        const icon =
          iconColumn === undefined ? "" : valueText(cellValue(row, iconColumn), iconColumn).trim().charAt(0).toUpperCase()
        const card =
          url === ""
            ? escapeHtml(name)
            : `<a href="${escapeHtml(url)}" data-link-shape="card" data-icon="${escapeHtml(icon === "" ? linkIcon(url) : icon)}">${escapeHtml(name)}</a>`
        return `    <li>${card}</li>`
      })
      .join("\n")

  const nodes = sections.map((section) => {
    const title = section.title === null ? "" : `  <p class="note-sec-title">${escapeHtml(section.title)}</p>\n`
    const items = itemsOf(section.rows)
    const inner = items === "" ? "" : `\n${items}\n  `
    return `${title}  <ul class="note-bookmarks">${inner}</ul>`
  })
  return `${openTag}\n${nodes.join("\n")}\n</div>`
}

/**
 * 聊天记录块 → `<div data-chat>` 包若干 `<p data-role>`。
 *
 * 消息一条一个段落、角色挂在 `data-role` 上 —— 双击打开时就是一段带说话方的对话，
 * 语义自明；解析端凭 `data-chat` 认领回聊天记录块，剥掉指针后剩下的段落也只是
 * 普通正文，与快照块的「正确的读法」同一立场。文本走 `escapeTextToHtml`（换行
 * 变 `<br>`），解析端再把 `<br>` 收回换行。
 */
function chatHtml(block: ChatBlock): string {
  const lines = block.messages.map((message) =>
    `  <p data-role="${message.role}">${escapeTextToHtml(message.text)}</p>`,
  )
  const inner = lines.length === 0 ? "" : `\n${lines.join("\n")}\n`
  return `<div data-chat>${inner}</div>`
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
