import type { Block, BookmarkBlock, ChatMessage, GalleryBlock, ImageBlock, InlineRun, KanbanBlock, LayoutBlock, LayoutMode, LedgerBlock, LedgerGroupMode, StatBlock, TableAlign, TableBlock, TableCell, TextualBlockType } from "@/types/workspace"
import { createBookmarkBlock, createChatBlock, createGalleryBlock, createHtmlBlock, createImageBlock, createKanbanBlock, createLayoutBlock, createLedgerBlock, createMermaidBlock, createStatBlock, createTableBlock, createTextualBlock, GALLERY_RATIO_DEFAULT, GALLERY_WIDTH_DEFAULT } from "@/lib/blocks"
import { STAT_PRECISION_DEFAULT, STAT_PRECISION_OPTIONS } from "@/lib/data-table"
import { runsText, textToRuns, trimRuns } from "@/lib/inline"
import { isTableAlign } from "@/lib/table"
import { docStyle } from "@/lib/typography"
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
  return parseNote(source).blocks
}

/** 一篇笔记的解析结果：正文块 + 页面级 CSS。 */
export interface ParsedNote {
  blocks: Block[]
  /** `<head>` 里用户写的页面级 CSS。没有时为空串。 */
  style: string
}

/**
 * 静态 HTML → 笔记。与 `parseHtml` 同一条路，只是把 `<head>` 里的页面样式一并交出来。
 *
 * 页面样式的读法（见 ADR-0011）：
 * - 首选带 `data-note-style` 的那个 `<style>` —— 本程序的规范形态；
 * - 没有标记的 `<style>` 照收（手工在 head 里写的样式一保存就被抹掉，那是静默丢失），
 *   但跳过本程序写进去的基础样式：打了 `data-note-base` 的，以及旧版本写过、没有标记
 *   却与当前 `docStyle()` 逐字相同的那份；
 * - 只看 `<head>`。正文里的 `<style>`（剪藏页面、HTML 块里的）不进页面样式 ——
 *   后者属于 HTML 块的原文，收进来会变成两份。
 */
export function parseNote(source: string): ParsedNote {
  const doc = new DOMParser().parseFromString(source, "text/html")
  const state: ParseState = { blocks: [] }

  // HTML 解析规则：进入「in body」模式之前的注释不落进 body —— 片段以围栏注释开头时
  // （笔记第一块就是 HTML 块、或直接把片段喂给解析器），开栏注释会挂在 Document 上；
  // `</body>` 之后的尾注则挂在 `<html>` 元素上。两边都挪回 body 首尾，
  // 围栏才在 parseContainer 的视野里。正文中的注释不受此规则影响。
  const leading = Array.from(doc.childNodes).filter((node) => node instanceof Comment)
  const anchor = doc.body.firstChild
  for (const node of leading) doc.body.insertBefore(node, anchor)
  for (const node of Array.from(doc.documentElement.childNodes)) {
    if (node instanceof Comment) doc.body.appendChild(node)
  }

  parseContainer(doc.body, state, 0)

  // 空壳文档（只有 <head><title>）拿标题兜底，否则打开就是一片空白。
  if (state.blocks.length === 0) {
    const title = doc.title.trim()
    if (title !== "") state.blocks.push(createTextualBlock("h1", textToRuns(title)))
  }

  return { blocks: state.blocks, style: pageStyleOf(doc) }
}

/** 页面级 CSS 的标签标记，与 `serialize.ts` 的 `pageStyleTag` 对偶。 */
const NOTE_STYLE_ATTR = "data-note-style"
const NOTE_BASE_ATTR = "data-note-base"

/** 边界换行不算内容 —— 写端补的 `\n` 不该在往返里越攒越多。 */
function trimCss(css: string): string {
  return css.replace(/^\n+/, "").replace(/\n+$/, "")
}

function pageStyleOf(doc: Document): string {
  // 写端给 `<style>` 内容补的边界换行不算差异。少了这一层归一化，**每一篇旧笔记**都会
  // 凭空长出一份页面样式：老文件里基础样式没有 `data-note-base` 标记，它的 textContent 是
  // `\n${docStyle()}\n`，与 `docStyle()` 差两个换行 —— 于是整页排版（`body { padding: 3rem … }`）
  // 被当成用户 CSS，落到编辑器正文列上，还会被送进 HTML 块的 iframe。
  const base = trimCss(docStyle())

  const marked = doc.head.querySelector(`style[${NOTE_STYLE_ATTR}]`)
  if (marked !== null) {
    const text = trimCss(marked.textContent ?? "")
    // 把基础排版原样抄成页面样式，等于什么都没写（它本来就生效）。被上面那个归一化缺位
    // 误存过一次的文件正是这副样子 —— 认作空，下次存盘顺手清掉。
    return text === base ? "" : text
  }

  const parts: string[] = []
  for (const element of doc.head.querySelectorAll("style")) {
    if (element.hasAttribute(NOTE_BASE_ATTR)) continue
    const text = trimCss(element.textContent ?? "")
    // 旧版本写过、还没打标记的基础样式 —— 与当前规格逐字相同（边界换行不算），
    // 认作基础样式放行。更早版本的规格变了，那份会被当成页面样式收进来
    // （用户能在抽屉里看到并删掉）。宁可看得见的冗余，也不要静默丢弃。
    if (text === base) continue
    parts.push(text)
  }
  return parts.join("\n")
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

/** 自定义 HTML 块的围栏注释文本（开 / 关），与 `serialize.ts` 的 `htmlBlockHtml` 对偶。 */
const HTML_BLOCK_OPEN = "note-html"
const HTML_BLOCK_CLOSE = "/note-html"

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

  const children = Array.from(container.childNodes)
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]
    if (child.nodeType === Node.TEXT_NODE) {
      pending.push(child)
      continue
    }
    // 自定义 HTML 块以围栏注释认领：`<!--note-html-->` 与 `<!--/note-html-->` 之间的
    // 节点整体收进原文（见 parseHtmlBlock）。普通注释不是元素也不是文本，
    // 走下面 `instanceof Element` 一关被跳过 —— 行为不变。
    if (child instanceof Comment && child.textContent === HTML_BLOCK_OPEN) {
      flush()
      const collected = collectHtmlBlock(children, index)
      state.blocks.push(createHtmlBlock(collected.source))
      index = collected.stopIndex
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

/**
 * 收集围栏注释之间的节点为 HTML 原文。
 *
 * 按节点类型各自取**字面**表示：元素取 `outerHTML`、文本取原数据、普通注释还原成
 * `<!--…-->` —— 不走 runs、不折叠空白，原文进出一个字节不差。边界换行掐掉
 * （与 `parsePre` 同一手法），序列化端补回的 `\n` 不算内容。
 *
 * 宽容口径：终止注释缺失（手工编辑截断）就收到容器末尾；嵌套的同名开栏注释
 * 不递归配对，第一个终止栏收场 —— 围栏是保留字，见序列化端的说明。
 */
function collectHtmlBlock(children: readonly Node[], startIndex: number): { source: string; stopIndex: number } {
  const parts: string[] = []
  let stopIndex = children.length - 1

  for (let index = startIndex + 1; index < children.length; index += 1) {
    const node = children[index]
    if (node instanceof Comment && node.textContent === HTML_BLOCK_CLOSE) {
      stopIndex = index
      break
    }
    if (node instanceof Element) parts.push(node.outerHTML)
    else if (node instanceof Comment) parts.push(`<!--${node.textContent ?? ""}-->`)
    else if (node.nodeType === Node.TEXT_NODE) parts.push(node.textContent ?? "")
  }

  const source = parts.join("").replace(/^\n/, "").replace(/\n+$/, "")
  return { source, stopIndex }
}

function parseBlockElement(element: Element, state: ParseState, depth: number): void {
  switch (element.tagName) {
    case "UL":
    case "OL":
      // 旧版书签导出是 <ul>,靠指针认领:没有 data-bookmark 就照普通列表解析。
      // 新版导出是 div 容器(见 DIV 分支),这里只兜历史文件。
      if (element.tagName === "UL" && element.hasAttribute("data-bookmark")) {
        state.blocks.push(parseBookmark(element))
        return
      }
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
    case "DIV":
      // 聊天记录块以 data-chat 指针认领（见 parseChat）；没有指针的 div 照旧穿透。
      if (element.hasAttribute("data-chat")) {
        state.blocks.push(parseChat(element))
        return
      }
      // 布局块（ADR-0007）以 data-layout 指针认领；没有指针的 div 照旧穿透 ——
      // 剪藏来的页面满地都是 div，不能因为新增了容器块就改变它们的去处。
      if (element.hasAttribute("data-layout")) {
        state.blocks.push(parseLayout(element))
        return
      }
      // 画册 / 看板 / 书签的展示快照容器(导出规范形态)。指针在容器上,内容是静态卡片,
      // 活数据从 `.tbl` 来,这里丢弃。先画册后看板:一个容器不会同时有两个指针。
      if (element.hasAttribute("data-gallery")) {
        const gallery = parseGallery(element)
        if (gallery !== null) state.blocks.push(gallery)
        return
      }
      if (element.hasAttribute("data-kanban")) {
        const kanban = parseKanban(element)
        if (kanban !== null) state.blocks.push(kanban)
        return
      }
      if (element.hasAttribute("data-bookmark")) {
        state.blocks.push(parseBookmark(element))
        return
      }
      // 账目块的展示快照容器:指针在容器上,内容是带小计合计的静态表格,
      // 活数据从 `.tbl` 来,这里丢弃。没有指针的 div 照旧穿透。
      if (element.hasAttribute("data-ledger")) {
        state.blocks.push(parseLedger(element))
        return
      }
      // 统计块的展示快照容器:指针在容器上,内容是导出时刻的列名与合计,这里丢弃。
      if (element.hasAttribute("data-stat")) {
        state.blocks.push(parseStat(element))
        return
      }
      break
    case "TABLE":
      if (element instanceof HTMLTableElement) {
        // 旧版导出(ADR-0006 初版 / ADR-0008 初版)把指针挂在 <table> 快照上,同样认领:
      // 看板/画册的路径与设置都在属性里,快照内容丢弃,活数据从 `.tbl` 来。先判看板
      // 再判画册(一个 table 不会同时有两个指针),都没有就走普通表格。
        const kanban = parseKanban(element)
        if (kanban !== null) {
          state.blocks.push(kanban)
          return
        }
        const gallery = parseGallery(element)
        if (gallery !== null) state.blocks.push(gallery)
        else state.blocks.push(parseTable(element))
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

/**
 * 聊天记录：`<p data-role>` 一条消息，角色只认字面 "you"，其余（含缺失）都归
 * agent —— 宽容读取不猜。换行从 `<br>` 收回（借 runs 采集的那条路），空消息
 * 照收：编辑器里「加了还没打字」的消息是正常状态，丢弃它往返就不精确了。
 */
function parseChat(element: Element): Block {
  const messages: ChatMessage[] = []
  for (const child of element.children) {
    if (child.tagName !== "P") continue
    const text = runsText(runsFromNodes([child], { collapseWhitespace: false }))
    messages.push({ role: child.getAttribute("data-role") === "you" ? "you" : "agent", text })
  }
  return createChatBlock(messages)
}

function parseTable(table: HTMLTableElement): TableBlock {
  const rows: TableCell[][] = []

  for (const row of table.rows) {
    const cells: TableCell[] = []
    for (const cell of row.cells) {
      const align = cellAlign(cell)
      const parsed: TableCell = { header: cell.tagName === "TH", runs: inlineRunsOf(cell) }
      if (align !== undefined) parsed.align = align
      cells.push(parsed)
    }
    rows.push(cells)
  }

  return createTableBlock(rows)
}

/**
 * `<div data-layout="grid|flex">` → 布局块（ADR-0007）。
 *
 * 每个 `<section>` 格子用既有的容器解析走一遍 —— 格子内容就是普通块，不另立规则。
 * 宽容口径与画册一致：`data-layout` 缺失或非法回退 grid；`data-columns` 非法或缺省
 * 归成 undefined（缺省即 2 不落存储）。section 全部缺失（空 div）解析成 `cells: []`，
 * 视图回到「未选择布局方式」的选择器 —— 与序列化端对未初始化块的写法互相咬合。
 * 格子内若解析出布局块照单收下：外部 HTML 的嵌套不被禁止，UI 不会产生它。
 */
function parseLayout(element: Element): LayoutBlock {
  const mode: LayoutMode = element.getAttribute("data-layout") === "flex" ? "flex" : "grid"
  const columns = parseLayoutColumns(element.getAttribute("data-columns"))
  const cells: Block[][] = []
  for (const child of element.children) {
    if (child.tagName !== "SECTION") continue
    const state: ParseState = { blocks: [] }
    parseContainer(child, state, 0)
    cells.push(state.blocks)
  }
  return createLayoutBlock(mode, columns, cells)
}

/** 列数的宽容读取：只认 2..4 的整数（与设置菜单的档位对齐），其余落回缺省。 */
function parseLayoutColumns(raw: string | null): number | undefined {
  if (raw === null) return undefined
  const value = Number(raw)
  return Number.isInteger(value) && value >= 2 && value <= 4 ? value : undefined
}

/**
 * `data-gallery` 容器 → 画册块。规范形态是 `<div class="note-gallery" data-gallery=…>`
 * (展示快照,与编辑器视图同构);旧版写法 `<table data-gallery>` 同样认 —— 属性读取
 * 只认 `data-*`,两种载体无差别。没有 `data-gallery` 返回 null,调用方回落到普通内容
 * —— 画册块被第三方编辑器剥掉属性之后,剩下的就是一份无主静态卡片,按正文读是
 * 「正确的读法」。
 *
 * 属性**宽容**读取:这是自家导出的写法,但文件可能被人手工编辑过 —— 缺失或非法的
 * 设置一律落回默认值(响应式 / 海报比例 / 裁剪填充 / 全显),而不是拒读整篇笔记。路径是唯一
 * 没有「默认值」可落的:留空串,块自己渲染成「读不到」的提示态。
 */
function parseGallery(container: Element): GalleryBlock | null {
  const path = container.getAttribute("data-gallery")
  if (path === null) return null

  const rawColumns = Number(container.getAttribute("data-columns"))
  const columns =
    Number.isInteger(rawColumns) && rawColumns >= 1 && rawColumns <= 12 ? rawColumns : "auto"

  const ratio = parseGalleryRatio(container.getAttribute("data-ratio"))
  const width = parseGalleryWidth(container.getAttribute("data-width"))
  const fit = container.getAttribute("data-fit") === "contain" ? "contain" : "cover"
  const fields = container.getAttribute("data-fields") ?? ""
  const hiddenFields = fields === "" ? [] : fields.split(",").filter((id) => id !== "")
  // 聚合参考列 id 原样收下,不校验列还存在 —— 指向的列被删后渲染时自然退化为平铺,
  // 与 hiddenFields 里残留 id 的立场一致。
  const group = container.getAttribute("data-group") ?? ""
  const groupBy = container.getAttribute("data-group-by") ?? ""
  const order = container.getAttribute("data-group-order") ?? ""
  const groupOrder = order === "" ? [] : order.split(",").filter((item) => item !== "")

  return createGalleryBlock(path, columns, fit, hiddenFields, ratio, group, groupBy, groupOrder, width)
}

/**
 * `data-kanban` 容器 → 看板块。没有 `data-kanban` 返回 null,调用方回落到画册或普通
 * 内容 —— 与画册同一立场:被第三方编辑器剥掉属性后,剩下的就是一份无主静态卡片,
 * 按正文读是「正确的读法」。
 *
 * 属性**宽容**读取:`data-group` / `data-fields` / `data-group-order` 的列 id 原样收下,
 * 不校验列还存在 —— 指向的列被删后渲染时自然退化为「未分组」一列 / 全显,与画册
 * hiddenFields 残留 id 的立场一致。`data-show-empty` 只认字面 "true"。
 * 路径没有默认值可落,留空串走「读不到」提示态。
 */
function parseKanban(container: Element): KanbanBlock | null {
  const path = container.getAttribute("data-kanban")
  if (path === null) return null

  const groupColumnId = container.getAttribute("data-group") ?? ""
  const fields = container.getAttribute("data-fields") ?? ""
  const displayColumnIds = fields === "" ? [] : fields.split(",").filter((id) => id !== "")
  const order = container.getAttribute("data-group-order") ?? ""
  const groupOrder = order === "" ? [] : order.split(",").filter((item) => item !== "")
  const showEmptyGroups = container.getAttribute("data-show-empty") === "true"

  return createKanbanBlock(path, groupColumnId, displayColumnIds, groupOrder, showEmptyGroups)
}

/**
 * `data-bookmark` 容器 → 书签块。规范形态是 `<div class="note-bookmark" data-bookmark=…>`
 * (分节宫格快照);旧版写法 `<ul data-bookmark>` 同样认。没有指针的元素走普通内容解析 ——
 * 与画册块同一立场:被第三方编辑器剥掉属性后,剩下的就是一份普通内容快照,
 * 按普通内容读是「正确的读法」。
 *
 * 属性**宽容**读取:名称列 / 链接列的列 id 原样收下、不校验列还存在(指向的列被删后
 * 渲染时退化为「未设置」提示,与画册 hiddenFields 残留 id 的立场一致);列数只认
 * 1..12 的整数,其余落回响应式。路径没有默认值可落,留空串走「读不到」提示态。
 */
function parseBookmark(container: Element): BookmarkBlock {
  const path = container.getAttribute("data-bookmark") ?? ""

  const rawColumns = Number(container.getAttribute("data-columns"))
  const columns = Number.isInteger(rawColumns) && rawColumns >= 1 && rawColumns <= 12 ? rawColumns : "auto"

  return createBookmarkBlock(
    path,
    container.getAttribute("data-name") ?? "",
    container.getAttribute("data-url") ?? "",
    columns,
    container.getAttribute("data-icon-column") ?? "",
    container.getAttribute("data-group-by") ?? "",
  )
}

/**
 * `data-ledger` 容器 → 账目块。没有 `data-ledger` 不会走到这里(调用方已判),
 * 手工编辑过的文件按属性**宽容**读取:收入 / 支出列与分组列、排序列的列 id 原样收下、
 * 不校验列还存在(指向的列被删后渲染时退化为未设置,与画册残留 id 的立场一致);
 * `data-group-mode` 只认 "month" / "column",其余落回 none;`data-balance` 只认
 * 字面 "false"(缺省即显示余额,与「缺省不落存储」咬合);`data-sort-dir` 只认
 * 字面 "asc",缺省即倒序(`data-sort` 空 = 不排序,方向一起留着但不生效)。
 * 路径没有默认值可落,留空串走「读不到」提示态。
 */
function parseLedger(container: Element): LedgerBlock {
  const path = container.getAttribute("data-ledger") ?? ""
  const rawMode = container.getAttribute("data-group-mode")
  const groupColumnId = container.getAttribute("data-group") ?? ""
  const groupMode: LedgerGroupMode =
    groupColumnId === "" ? "none" : rawMode === "month" ? "month" : rawMode === "column" ? "column" : "none"

  return createLedgerBlock(
    path,
    container.getAttribute("data-income") ?? "",
    container.getAttribute("data-expense") ?? "",
    container.getAttribute("data-balance") !== "false",
    groupMode,
    groupColumnId,
    container.getAttribute("data-sort") ?? "",
    container.getAttribute("data-sort-dir") === "asc" ? "asc" : "desc",
  )
}

/**
 * `data-stat` 容器 → 统计块。没有 `data-stat` 不会走到这里(调用方已判)。
 * 求和列的列 id 原样收下、不校验列还存在(指向的列被删后渲染时退化为未设置,
 * 与画册残留 id 的立场一致)。路径没有默认值可落,留空串走「读不到」提示态。
 */
function parseStat(container: Element): StatBlock {
  const block = createStatBlock(
    container.getAttribute("data-stat") ?? "",
    container.getAttribute("data-column") ?? "",
  )
  const precision = parseStatPrecision(container.getAttribute("data-precision"))
  if (precision !== STAT_PRECISION_DEFAULT) block.precision = precision
  // 筛选宽容读取:列 id 空串 = 不筛选(与序列化「非空才写」对齐);列 id 非空时
  // value 原样收下,缺属性按「等于空值」处理 —— 那是合法条件,不是缺配置。
  const filterColumnId = container.getAttribute("data-filter-column") ?? ""
  if (filterColumnId !== "") {
    block.filterColumnId = filterColumnId
    block.filterValue = container.getAttribute("data-filter-value") ?? ""
  }
  return block
}

/**
 * `data-precision` 的宽容读取:只认设置菜单同款档位(0..3 的整数),手工改出
 * `2.5` 位或 `99` 这种没有意义的值一律落回默认两位 —— 与 `parseGalleryRatio`
 * 的立场一致:解析端不吃离谱配置,显示端不为此设防。
 */
function parseStatPrecision(raw: string | null): number {
  const value = Number(raw)
  const legal =
    raw !== null &&
    Number.isInteger(value) &&
    (STAT_PRECISION_OPTIONS as readonly number[]).includes(value)
  return legal ? value : STAT_PRECISION_DEFAULT
}

/**
 * `data-ratio` 的宽容读取:只认「两个 1..16 的整数」的写法(上界与设置菜单的预设档位
 * 对齐 —— 手工改出 `1:100` 这种比例,卡片只会高得没有意义),其余一律落回海报默认。
 * 命中时按 `宽:高` 归一化返回,不吃下手工文件里的空格与前导零。
 */
function parseGalleryRatio(raw: string | null): string {
  const parts = raw !== null ? raw.split(":") : []
  const width = Number(parts[0])
  const height = Number(parts[1])
  const legal =
    parts.length === 2 &&
    Number.isInteger(width) && width >= 1 && width <= 16 &&
    Number.isInteger(height) && height >= 1 && height <= 16
  return legal ? `${width}:${height}` : GALLERY_RATIO_DEFAULT
}

/**
 * `data-width` 的宽容读取:只认 10..100 的整数(下界挡住手工改出 `5` 这种没有意义的
 * 窄条,上界即铺满),其余一律落回铺满默认。
 */
function parseGalleryWidth(raw: string | null): number {
  const width = Number(raw)
  return Number.isInteger(width) && width >= 10 && width <= 100 ? width : GALLERY_WIDTH_DEFAULT
}

/**
 * 单元格的水平对齐。
 *
 * 认两处写法：内联 `style="text-align:…"`（本项目的导出形态）与旧的 `align` 属性
 * （剪藏页面、Word 导出的 HTML 里很常见）。归一化到三档，别的一律当没设置 ——
 * 编辑器只提供三档，认不出的值迟早会在导出时被抹掉，留着只会造成「编辑器里看着靠左、
 * 文件里却是两端对齐」。`left` 同样归成「没设置」：模型里左对齐不落存储。
 */
function cellAlign(cell: HTMLTableCellElement): TableAlign | undefined {
  const style = cell.style.textAlign
  const value = (style === "" ? cell.getAttribute("align") ?? "" : style).trim().toLowerCase()
  return isTableAlign(value) && value !== "left" ? value : undefined
}

function imageBlockOf(element: Element): ImageBlock {
  return createImageBlock(
    element.getAttribute("src") ?? "",
    element.getAttribute("alt") ?? "",
    element.getAttribute("title") ?? "",
  )
}
