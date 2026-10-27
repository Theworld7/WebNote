/**
 * 块列表 → Markdown。
 *
 * 与 `lib/html/serialize` 同一立场：这里只负责「把内存里的块拼成文本」，读盘留在
 * composable 那边。区别是 Markdown 没有块结构 —— 引用块写成数据表快照，布局块按
 * 格子顺序摊平，聊天记录写成逐条消息，结构不保证往返。正文类的行内标记尽量走
 * Markdown 原生语法；下划线、高亮、颜色、卡片链接这些 Markdown 没有的语义用行内
 * HTML 承载，主流 Markdown 渲染器都接受。
 */
import type { Block, ChatMessage, InlineMark, InlineRun, StatBlock, TextualBlock } from "@/types/workspace"
import type { DataColumn, DataRow, DataTable } from "@/types/data-table"
import type { DataTableLookup } from "@/lib/html"
import { isListBlock, orderedIndexes } from "@/lib/blocks"
import { cellValue, filterRowsByValue, formatGrouped, STAT_PRECISION_DEFAULT, sumColumn, valueText } from "@/lib/data-table"
import { INLINE_MARK_ORDER, runToHtml, runsText } from "@/lib/inline"

/** 自定义 HTML 块的围栏标记，与 `lib/html` 的解析口径一致；Markdown 里当注释隐藏。 */
const HTML_BLOCK_OPEN = "<!--note-html-->"
const HTML_BLOCK_CLOSE = "<!--/note-html-->"

/** 应用内的提示框在 Markdown 里用 GFM alert 表达；导入端会把触发词还原成提示框块。 */
const CALLOUT_MARKER = "[!NOTE]"

type LineBreak = "hard" | "html" | "space"

/**
 * 块列表 → 完整 Markdown 文本（不含文档标题；文件名就是标题）。
 *
 * `lookupTables` 缺省时引用块写成「读不到」提示 —— 与 HTML 快照的降级口径一致。
 * 引用块写到哪张表由调用方先 `preload` 进内存，这里只做同步查询。
 */
export function blocksToMarkdown(blocks: readonly Block[], lookupTables?: DataTableLookup): string {
  const lookup = lookupTables ?? (() => null)
  const indexes = orderedIndexes(blocks)
  let output = ""
  let previousList = false
  /** 当前打开的列表层级；与 `orderedIndexes` 的 clamp 规则同源，保证嵌套层级合法。 */
  let levels: string[] = []

  for (const block of blocks) {
    if (!isListBlock(block)) {
      levels = []
      const text = blockToMarkdown(block, lookup)
      if (text !== "") {
        output += (output === "" ? "" : "\n\n") + text
        previousList = false
      }
      continue
    }

    const depth = Math.min(block.depth, levels.length)
    if (levels[depth] === block.type) {
      levels.length = depth + 1
    } else {
      levels.length = depth
      levels.push(block.type)
    }
    // 相邻列表项只隔一个换行；空行会把列表切成两个，也会把嵌套项读散。
    output += (output === "" ? "" : previousList ? "\n" : "\n\n") + listItemMarkdown(block, depth, indexes.get(block.id) ?? 1)
    previousList = true
  }

  return output
}

function blockToMarkdown(block: Block, lookup: DataTableLookup): string {
  switch (block.type) {
    case "text":
      return paragraphMarkdown(block.runs)
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const level = Number(block.type.slice(1))
      const content = inlineMarkdown(block.runs, "html")
      return content === "" ? "#".repeat(level) : `${"#".repeat(level)} ${content}`
    }
    case "todo":
    case "ul":
    case "ol":
      return listItemMarkdown(block, block.depth, 1)
    case "quote":
      return quoteMarkdown(block.runs)
    case "callout":
      return calloutMarkdown(block.runs)
    case "code":
      return fencedCode(block.lang ?? "", runsText(block.runs))
    case "divider":
      return "---"
    case "image": {
      const title = block.title === "" ? "" : ` "${escapeQuoted(block.title)}"`
      return `![${escapeLinkLabel(block.alt)}](<${escapeLinkTarget(block.src)}>${title})`
    }
    case "table":
      return tableMarkdown(block.rows)
    case "mermaid":
      return fencedCode("mermaid", block.source)
    case "datatable":
    case "gallery":
    case "bookmark":
    case "kanban":
    case "ledger":
    case "subscription":
    case "playlist":
      return referenceMarkdown(block.type, block.path, lookup)
    case "stat":
      return statMarkdown(block, lookup(block.path))
    case "chat":
      return chatMarkdown(block.messages)
    case "layout":
      return layoutMarkdown(block.cells, lookup)
    case "html":
      return `${HTML_BLOCK_OPEN}\n${block.source}\n${HTML_BLOCK_CLOSE}`
  }
}

function paragraphMarkdown(runs: readonly InlineRun[]): string {
  return escapeLineStarts(inlineMarkdown(runs, "hard"))
}

function quoteMarkdown(runs: readonly InlineRun[]): string {
  const body = escapeLineStarts(inlineMarkdown(runs, "hard"))
  const lines = body === "" ? [""] : body.split("\n")
  return lines.map((line) => (line === "" ? ">" : `> ${line}`)).join("\n")
}

/**
 * 提示框 → `> [!NOTE]` 的 GFM alert。标记行与正文之间用硬换行隔开，导入端才能
 * 把 Marker 单独摘掉而不误伤正文。
 */
function calloutMarkdown(runs: readonly InlineRun[]): string {
  const body = escapeLineStarts(inlineMarkdown(runs, "hard"))
  const lines = body === "" ? [CALLOUT_MARKER] : [CALLOUT_MARKER + "  ", ...body.split("\n")]
  return lines.map((line) => (line === "" ? ">" : `> ${line}`)).join("\n")
}

/** 列表项。缩进统一 4 空格 —— 有序列表的标记宽度大于 2，4 是两种标记都合法的安全值。 */
function listItemMarkdown(block: TextualBlock, depth: number, index: number): string {
  const marker =
    block.type === "todo"
      ? `- [${block.checked === true ? "x" : " "}] `
      : block.type === "ol"
        ? `${index}. `
        : "- "
  const indent = "    ".repeat(depth)
  const body = escapeLineStarts(inlineMarkdown(block.runs, "hard"))
  if (body === "") return indent + marker.trimEnd()

  const lines = body.split("\n")
  const continuation = " ".repeat(indent.length + marker.length)
  const text = lines.map((line, position) => (position === 0 ? line : continuation + line)).join("\n")
  return indent + marker + text
}

/** 代码围栏。围栏长度按内容里最长的反引号串加一，避免正文里的 ``` 提前收尾。 */
function fencedCode(lang: string, source: string): string {
  const fence = "`".repeat(Math.max(3, longestRun(source, "`") + 1))
  const info = lang.split(/\s+/)[0]?.replace(/`/g, "") ?? ""
  const ending = source.endsWith("\n") ? "" : "\n"
  return `${fence}${info}\n${source}${ending}${fence}`
}

/** 表格 → GFM 表格。第一行当表头：Markdown 表格必须有表头，而应用里的表格通常也是。 */
function tableMarkdown(rows: readonly { header: boolean; runs: InlineRun[]; align?: "left" | "center" | "right" }[][]): string {
  if (rows.length === 0) return ""

  const first = rows[0] ?? []
  const width = Math.max(1, first.length)
  const header = Array.from({ length: width }, (_, index) => tableCellMarkdown(first[index]?.runs ?? []))
  const separator = Array.from({ length: width }, (_, index) => alignMarker(first[index]?.align)).join(" | ")
  const body = rows.slice(1).map((row) =>
    Array.from({ length: width }, (_, index) => tableCellMarkdown(row[index]?.runs ?? [])).join(" | "),
  )

  return [`| ${header.join(" | ")} |`, `| ${separator} |`, ...body.map((line) => `| ${line} |`)].join("\n")
}

function alignMarker(align: "left" | "center" | "right" | undefined): string {
  if (align === "center") return ":---:"
  if (align === "right") return "---:"
  return "---"
}

function tableCellMarkdown(runs: readonly InlineRun[]): string {
  return inlineMarkdown(runs, "html").replace(/\|/g, "\\|")
}

/**
 * 引用块 → 数据表的 Markdown 快照。
 *
 * 数据是别人的（ADR-0005），这里只读 `lookup` 已经读进内存的那一份；读不到时
 * 写一句提示，不让一篇笔记因为一张坏引用导不出来（与 HTML 快照同一降级口径）。
 */
function referenceMarkdown(type: string, path: string, lookup: DataTableLookup): string {
  if (path === "") return "> 尚未指定数据表"
  const table = lookup(path)
  if (table === null) return `> 引用的数据表读不到：${escapeMarkdownText(path)}`
  const snapshot = dataTableMarkdown(table)
  return snapshot === "" ? `> ${type}：数据表没有内容` : snapshot
}

/** 统计块 → 与导出 HTML 同构的「列名 / 合计 / 行数」三行信息。 */
function statMarkdown(block: StatBlock, table: DataTable | null): string {
  if (table === null) return `> 引用的数据表读不到：${escapeMarkdownText(block.path)}`
  const column = table.columns.find((item) => item.id === block.columnId)
  if (column === undefined) return "> 统计：尚未选择求和列"

  const filterId = block.filterColumnId ?? ""
  const filterColumn = filterId === "" ? null : table.columns.find((item) => item.id === filterId) ?? null
  const rows = filterColumn === null ? table.rows : filterRowsByValue(table.rows, filterColumn, block.filterValue ?? "")
  const precision = block.precision ?? STAT_PRECISION_DEFAULT
  const filterText = filterColumn === null ? "" : ` · ${filterColumn.name} = ${block.filterValue ?? ""}`
  const countText =
    filterColumn === null ? `${rows.length} 行 · 求和` : `${rows.length} 行 / 共 ${table.rows.length} 行 · 求和`
  return `**${escapeMarkdownText(column.name + filterText)}**：${formatGrouped(sumColumn(rows, column), precision)}（${escapeMarkdownText(countText)}）`
}

/** 数据表 → GFM 表格。图片列写成 Markdown 图片，其余按显示文本走。 */
function dataTableMarkdown(table: DataTable): string {
  if (table.columns.length === 0) return ""

  const header = table.columns.map((column) => escapeTableCell(column.name)).join(" | ")
  const separator = table.columns.map(() => "---").join(" | ")
  const rows = table.rows.map((row) => table.columns.map((column) => dataCellMarkdown(row, column)).join(" | "))
  return [`| ${header} |`, `| ${separator} |`, ...rows.map((line) => `| ${line} |`)].join("\n")
}

function dataCellMarkdown(row: DataRow, column: DataColumn): string {
  const value = cellValue(row, column)
  if (column.type === "image" && typeof value === "string" && value !== "") {
    return `![${escapeLinkLabel(column.name)}](<${escapeLinkTarget(value)}>)`
  }
  return escapeTableCell(valueText(value, column))
}

function escapeTableCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>")
}

/** 聊天记录 → 逐条 `**我**：…` / `**对方**：…`；结构不保证往返，内容按序保留。 */
function chatMarkdown(messages: readonly ChatMessage[]): string {
  return messages
    .map((message) => {
      const label = message.role === "you" ? "我" : "对方"
      const text = escapeLineStarts(inlineTextMarkdown(message.text, "hard"))
      return text === "" ? `**${label}**` : `**${label}**：${text}`
    })
    .join("\n\n")
}

/** 布局块 → 格子内容按序摊平。Markdown 没有容器块，格子边界不写标记。 */
function layoutMarkdown(cells: readonly (readonly Block[])[], lookup: DataTableLookup): string {
  return cells
    .map((cell) => blocksToMarkdown(cell, lookup))
    .filter((text) => text !== "")
    .join("\n\n")
}

function inlineMarkdown(runs: readonly InlineRun[], lineBreak: LineBreak): string {
  return runs.map((run) => runMarkdown(run, lineBreak)).join("")
}

function inlineTextMarkdown(text: string, lineBreak: LineBreak): string {
  return lineBreakText(escapeMarkdownText(text), lineBreak)
}

function runMarkdown(run: InlineRun, lineBreak: LineBreak): string {
  const hasHtmlOnly =
    (run.color !== undefined && run.color !== "") ||
    run.marks.includes("underline") ||
    run.marks.includes("highlight") ||
    run.linkShape === "card" ||
    (run.marks.includes("code") && run.text.includes("\n"))
  if (hasHtmlOnly) return runToHtml(run)

  let body = run.marks.includes("code")
    ? codeSpan(run.text)
    : lineBreakText(escapeMarkdownText(run.text), lineBreak)

  for (const mark of [...INLINE_MARK_ORDER].reverse()) {
    if (!run.marks.includes(mark)) continue
    body = markWrapper(mark, body)
  }

  if (run.href !== undefined && run.href !== "") {
    body = `[${body}](<${escapeLinkTarget(run.href)}>)`
  }
  return body
}

function markWrapper(mark: InlineMark, body: string): string {
  if (mark === "bold") return `**${body}**`
  if (mark === "italic") return `*${body}*`
  if (mark === "strike") return `~~${body}~~`
  return body
}

/** 行内代码。内容里有反引号时加长围栏；首尾是反引号或空格时两侧各补一个空格。 */
function codeSpan(text: string): string {
  const fence = "`".repeat(Math.max(1, longestRun(text, "`") + 1))
  const pad =
    text.startsWith("`") || text.endsWith("`") || text.startsWith(" ") || text.endsWith(" ") ? " " : ""
  return `${fence}${pad}${text}${pad}${fence}`
}

function lineBreakText(text: string, lineBreak: LineBreak): string {
  if (lineBreak === "hard") return text.replace(/\n/g, "  \n")
  if (lineBreak === "html") return text.replace(/\n/g, "<br>")
  return text.replace(/\n/g, " ")
}

/** 行首的 `#` / `-` / `+` / `1.` 会被当成块级语法，逐行转义掉。 */
function escapeLineStarts(text: string): string {
  return text.replace(
    /(^|\n)(#{1,6}|[-+]|\d+\.)( +)/g,
    (_match: string, lead: string, marker: string, spaces: string) => {
      const escaped = /^\d/.test(marker) ? marker.replace(".", "\\.") : `\\${marker}`
      return `${lead}${escaped}${spaces}`
    },
  )
}

function escapeMarkdownText(text: string): string {
  return text.replace(/[\\`*_[\]<>~]/g, (char) => `\\${char}`)
}

function escapeLinkLabel(text: string): string {
  return escapeMarkdownText(text)
}

/** 链接 / 图片目标写进尖括号形式，空格与 `<>` 转成百分号编码。 */
function escapeLinkTarget(target: string): string {
  return target.replace(/[<>]/g, (char) => (char === "<" ? "%3C" : "%3E")).replace(/\n/g, "%0A")
}

function escapeQuoted(text: string): string {
  return text.replace(/[\\"]/g, (char) => `\\${char}`)
}

function longestRun(text: string, char: string): number {
  let longest = 0
  let current = 0
  for (const item of text) {
    if (item === char) {
      current += 1
      longest = Math.max(longest, current)
    } else {
      current = 0
    }
  }
  return longest
}
