import type {
  Block,
  BlockType,
  BlockTypeMeta,
  BookmarkBlock,
  DataTableBlock,
  GalleryBlock,
  ImageBlock,
  InlineRun,
  KanbanBlock,
  LayoutBlock,
  LayoutMode,
  MermaidBlock,
  TableBlock,
  TableCell,
  TextualBlock,
  TextualBlockType,
} from "@/types/workspace"
import { cloneRuns, runsText, textToRuns } from "@/lib/inline"
import { cloneCell } from "@/lib/table"

/**
 * 块类型登记表 —— 类型标识符的唯一真源。
 *
 * `satisfies` 只做校验、不改推断类型：写错或改名某个 type 会在这里报错，
 * 而菜单、marker、序列化都从这张表派生，不存在第二处需要同步的清单。
 *
 * 登记表的**完备性**由下面的 `assertRegistryComplete` 在编译期保证 ——
 * 新增一个块类型却忘了登记，会当场编译报错（`satisfies` 本身查不出漏登记）。
 */
export const BLOCK_TYPES = [
  { type: "text", marker: "¶", label: "文本" },
  { type: "h1", marker: "H1", label: "标题 1" },
  { type: "h2", marker: "H2", label: "标题 2" },
  { type: "h3", marker: "H3", label: "标题 3" },
  { type: "h4", marker: "H4", label: "标题 4" },
  { type: "h5", marker: "H5", label: "标题 5" },
  { type: "h6", marker: "H6", label: "标题 6" },
  { type: "todo", marker: "[ ]", label: "待办列表" },
  { type: "ul", marker: "•", label: "无序列表" },
  { type: "ol", marker: "1.", label: "有序列表" },
  { type: "quote", marker: '"', label: "引用" },
  { type: "code", marker: "</>", label: "代码块" },
  // 紧挨 code：mermaid 的心智来源就是「用代码块写图」，摆一起最容易找。
  { type: "mermaid", marker: "◇", label: "Mermaid 图" },
  { type: "callout", marker: "!", label: "标注" },
  { type: "divider", marker: "—", label: "分割线" },
  { type: "image", marker: "▧", label: "图片" },
  { type: "table", marker: "⊞", label: "表格" },
  // 紧挨 table：数据表在用户眼里就是「更正式的表格」，摆一起最容易找。
  { type: "datatable", marker: "▤", label: "数据表" },
  // 紧挨 datatable：画册展示的就是数据表的数据，只是换了一身衣服。
  { type: "gallery", marker: "▦", label: "画册" },
  // 紧挨 gallery：书签块同样吃数据表的数据，渲染成链接卡片宫格。
  { type: "bookmark", marker: "⚑", label: "书签" },
  // 紧挨 bookmark：看板块同样吃数据表的数据,按某列分组铺成几列,卡片可拖拽改值。
  { type: "kanban", marker: "☰", label: "看板" },
  // 压轴：容器块是「版面级」的重结构,跟在内容块族的最后。
  { type: "layout", marker: "⬚", label: "布局" },
] satisfies readonly BlockTypeMeta[]

/**
 * 登记表里出现过的块类型。
 *
 * `(typeof BLOCK_TYPES)[number]["type"]` 拿到的是各项 `type` 的**字面量**联合 ——
 * 因为 `satisfies` 不改推断，每个 `"text"` 都还是 `"text"` 而不是被拓宽成 `string`。
 */
type RegisteredType = (typeof BLOCK_TYPES)[number]["type"]

/**
 * 编译期完备性自检：`BlockType` 里的每个类型都必须出现在 `BLOCK_TYPES` 里。
 *
 * 漏登记的会从 `Exclude` 里漏出来、`as never` 当场报错。`satisfies` 只能查出
 * 「登记了不存在的类型」，查不出「存在的类型没登记」—— 这一条补上那半边。
 */
const assertRegistryComplete: never[] = [] as Exclude<BlockType, RegisteredType>[]
void assertRegistryComplete

const TYPE_META = new Map<BlockType, BlockTypeMeta>(BLOCK_TYPES.map((meta) => [meta.type, meta]))

export function blockTypeMeta(type: BlockType): BlockTypeMeta {
  const meta = TYPE_META.get(type)
  if (meta === undefined) throw new Error(`未登记的块类型：${type}`)
  return meta
}

/** 带序号的列表类型：这两种要在块左侧渲染 marker。 */
export function isListType(type: BlockType): boolean {
  return type === "ul" || type === "ol"
}

/**
 * 列表族块类型：会合进同一个 `<ul>` / `<ol>` 的三种。
 *
 * `todo` 也算 —— 它渲染成带复选框的 `<li>`，与 `ul` 同族。序列化的分组与
 * 有序列表的序号计算都读这一份判断，两边不能各判一套。
 */
export type ListBlockType = "ul" | "ol" | "todo"

/**
 * 是否是列表族块。
 *
 * 命中时同时把 `type` 收窄成 `ListBlockType` —— 调用方拿到手就能当 `ul` / `ol` / `li`
 * 的归属类型用，不必再判一轮。
 */
export function isListBlock(block: Block): block is TextualBlock & { type: ListBlockType } {
  return block.type === "ul" || block.type === "ol" || block.type === "todo"
}

/**
 * 是否是正文块。
 *
 * 用 `!==` 而不是判断 `"runs" in block`：前者能被编译器用来收窄联合类型，
 * 后者只是运行时成立，拿到手依然是 `Block`。
 *
 * 这里的 `!==` 链必须**逐一列出**结构类 —— 编译器不接受「不在某个集合里」这种收窄。
 * 但新增结构类时不会漏：一旦把新类型加进 `BlockType`，`assertRegistryComplete`
 * 会要求它在 `BLOCK_TYPES` 里登记，而各处的分派（`createBlock` / `cloneBlock` /
 * `blockText` / `serialize`）都在收窄后的分支里取字段，漏一处就编译不过。
 */
export function isTextualBlock(block: Block): block is TextualBlock {
  return (
    block.type !== "image" &&
    block.type !== "table" &&
    block.type !== "mermaid" &&
    block.type !== "datatable" &&
    block.type !== "gallery" &&
    block.type !== "bookmark" &&
    block.type !== "kanban" &&
    block.type !== "layout"
  )
}

/**
 * 格子内插入/转换菜单要滤掉的类型：容器块本身（一层容器）与引用块。
 *
 * 引用块（数据表/画册/书签/看板）要「先有文件才能指」，那条异步分流与选表对话框都长在顶层
 * 编辑器上，格子内不值得为此再铺一条路 —— 引用块放进布局格子的场景也足够边缘。
 */
export const CELL_EXCLUDED_TYPES: readonly BlockType[] = ["layout", "datatable", "gallery", "bookmark", "kanban"]

/** 布局块网格模式的列数档位与缺省值。缺省即 2 不落存储，解析也以它兜底。 */
export const LAYOUT_COLUMNS = [2, 3, 4] as const
export const LAYOUT_COLUMNS_DEFAULT = 2

/** 块是否自带左侧标记（列表符号 / 复选框）。内容区的缩进也以它为准。 */
export function hasLeadingMarker(type: BlockType): boolean {
  return isListType(type) || type === "todo"
}

let seq = 0

/** 块 id 生成。项目目前不落库，先走进程内自增，接 Tauri fs 后换成持久化 id。 */
export function createBlockId(): string {
  seq += 1
  return `b${Date.now().toString(36)}${seq.toString(36)}`
}

/** 造一个正文块。三个形态的默认值都收在这里，解析器与编辑器共用一个入口。 */
export function createTextualBlock(
  type: TextualBlockType,
  runs: InlineRun[] = [],
  fields: { depth?: number; checked?: boolean; lang?: string } = {},
): TextualBlock {
  const block: TextualBlock = { id: createBlockId(), type, runs, depth: fields.depth ?? 0 }
  if (type === "todo") block.checked = fields.checked ?? false
  if (type === "code" && fields.lang !== undefined && fields.lang !== "") block.lang = fields.lang
  return block
}

export function createImageBlock(src = "", alt = "", title = ""): ImageBlock {
  return { id: createBlockId(), type: "image", src, alt, title }
}

export function createTableBlock(rows: TableCell[][] = []): TableBlock {
  return { id: createBlockId(), type: "table", rows }
}

export function createMermaidBlock(source = ""): MermaidBlock {
  return { id: createBlockId(), type: "mermaid", source }
}

export function createDataTableBlock(path = ""): DataTableBlock {
  return { id: createBlockId(), type: "datatable", path }
}

/** 画册卡片图片的默认显示比例(电影海报)。序列化只写非默认值,解析也以它兜底。 */
export const GALLERY_RATIO_DEFAULT = "2:3"

/** 画册卡片图片的默认宽度:100 = 铺满卡片。序列化只写非默认值,解析也以它兜底。 */
export const GALLERY_WIDTH_DEFAULT = 100

/**
 * 造画册块。缺省的设置(响应式列数、海报比例、裁剪填充、全字段可见)是最不意外的起点;
 * 带全参数的调用来自解析器 —— 盘上属性宽容读取后的值在这里收口成合法类型。
 */
export function createGalleryBlock(
  path = "",
  columns: "auto" | number = "auto",
  fit: "cover" | "contain" = "cover",
  hiddenFields: string[] = [],
  ratio: string = GALLERY_RATIO_DEFAULT,
  group = "",
  groupBy = "",
  groupOrder: string[] = [],
  width: number = GALLERY_WIDTH_DEFAULT,
): GalleryBlock {
  return { id: createBlockId(), type: "gallery", path, columns, fit, hiddenFields, ratio, group, groupBy, groupOrder, width }
}

/**
 * 造书签块。名称列 / 链接列缺省为空 = 「尚未挑选字段」，视图显示提示态引导去
 * 悬浮条里选；带全参数的调用来自解析器 —— 盘上属性宽容读取后的值在这里收口。
 */
export function createBookmarkBlock(
  path = "",
  nameColumn = "",
  urlColumn = "",
  columns: "auto" | number = "auto",
  iconColumn = "",
  groupBy = "",
): BookmarkBlock {
  const block: BookmarkBlock = { id: createBlockId(), type: "bookmark", path, nameColumn, urlColumn, columns }
  // 缺省不落盘:不设图标列/分组字段时字段干脆不存在,与 linkShape 缺省不写同一立场。
  if (iconColumn !== "") block.iconColumn = iconColumn
  if (groupBy !== "") block.groupBy = groupBy
  return block
}

/**
 * 造看板块。缺省不带分组列与显示字段 —— 视图显示提示态引导去选分组列;选好后分组
 * 铺成几列、卡片显示分组列以外的全部字段。带全参数的调用来自解析器 —— 盘上属性
 * 宽容读取后的值在这里收口成合法类型。
 */
export function createKanbanBlock(
  path = "",
  groupColumnId = "",
  displayColumnIds: string[] = [],
  groupOrder: string[] = [],
  showEmptyGroups = false,
): KanbanBlock {
  return { id: createBlockId(), type: "kanban", path, groupColumnId, displayColumnIds, groupOrder, showEmptyGroups }
}

/**
 * 造布局块。`cells` 缺省为空 = 「尚未选择布局方式」，视图显示网格/弹性选择器；
 * 选择后由操作层初始化两个格子（各含一个空文本块，光标有处落）。
 * 带全参数的调用来自解析器 —— 盘上属性宽容读取后的值在这里收口成合法类型。
 */
export function createLayoutBlock(mode: LayoutMode = "grid", columns?: number, cells: Block[][] = []): LayoutBlock {
  return { id: createBlockId(), type: "layout", mode, columns, cells }
}

/** 按类型造块。`text` 会被包成单个无标记 run —— 组件层新建块走这条，不必手搓 runs。 */
export function createBlock(type: BlockType, text = ""): Block {
  if (type === "image") return createImageBlock()
  if (type === "table") return createTableBlock()
  if (type === "mermaid") return createMermaidBlock()
  if (type === "datatable") return createDataTableBlock()
  if (type === "gallery") return createGalleryBlock()
  if (type === "bookmark") return createBookmarkBlock()
  if (type === "kanban") return createKanbanBlock()
  if (type === "layout") return createLayoutBlock()
  return createTextualBlock(type, textToRuns(text))
}

/**
 * 块类型切换。
 *
 * 内容一并清空 —— 与原型行为一致，而且必须这么做：切换时 DOM 会被清掉，
 * 数据若不同步清空，切走标签再切回来又会把旧内容渲染出来（`/` 触发转换时尤其明显）。
 */
export function retypeBlock(block: Block, type: BlockType): Block {
  if (type === "image" || type === "table" || type === "mermaid" || type === "datatable" || type === "gallery" || type === "bookmark" || type === "kanban" || type === "layout") {
    return createBlock(type)
  }
  if (!isTextualBlock(block)) return createTextualBlock(type)
  return createTextualBlock(type, [], { depth: block.depth, checked: block.checked })
}

/**
 * 深拷一个块并指定 id。
 *
 * 浅拷（`{ ...block }`）在旧模型下够用，现在不够 —— `runs` / `rows` 都是数组，
 * 浅拷会让两份块共享同一批 run 对象，改一处动两处。表格的格子走 `cloneCell()`
 * （`table.ts`），拷格子的口径 —— runs 深拷、对齐只在非左时才带 —— 收在那一边一处。
 * id 由调用方给：拷进工作区状态时沿用原 id，「复制块」时换成新的。
 *
 * `source` 是字符串，图片块那种平坦形态浅拷即可。
 */
export function cloneBlock(block: Block, id: string): Block {
  if (block.type === "image" || block.type === "mermaid" || block.type === "datatable" || block.type === "bookmark") {
    return { ...block, id }
  }
  // 画册的 hiddenFields 是数组：更新总以整体替换发生，但拷贝不该共享同一份。
  if (block.type === "gallery") {
    return { ...block, id, hiddenFields: [...block.hiddenFields] }
  }
  // 看板的 displayColumnIds / groupOrder 是数组：整体替换,但拷贝要独立。
  if (block.type === "kanban") {
    return { ...block, id, displayColumnIds: [...block.displayColumnIds], groupOrder: [...block.groupOrder] }
  }
  if (block.type === "table") {
    return { ...block, id, rows: block.rows.map((row) => row.map(cloneCell)) }
  }
  // 布局块的格子各自持有块列表：递归深拷、子块全部换新 id —— 复制出来的是一份
  // 独立副本，不是共享子块的浅壳。
  if (block.type === "layout") {
    return { ...block, id, cells: block.cells.map((cell) => cell.map((item) => cloneBlock(item, createBlockId()))) }
  }
  return { ...block, id, runs: cloneRuns(block.runs) }
}

/**
 * 块的纯文本投影。
 *
 * 图片取 alt、表格把单元格拼起来、mermaid 取图源码 —— 至少字数统计与检索不必对这
 * 三种块特殊处理。不要把它当数据源用：改文本要改 `runs`，投影只是只读视图。
 */
export function blockText(block: Block): string {
  if (block.type === "image") return block.alt
  if (block.type === "mermaid") return block.source
  // 引用块只带路径 —— 表格内容不在笔记里，投影拿不到它，也不该为此去读盘
  // （字数统计是同步的纯函数）。取路径是这里唯一诚实的选择。
  if (block.type === "datatable") return block.path
  // 画册同样只带路径 —— 设置（列数、填充、字段显隐）不是文本，不进投影。
  if (block.type === "gallery") return block.path
  // 书签块只带路径 —— 名称列 / 链接列 / 列数是展示设置，不是文本。
  if (block.type === "bookmark") return block.path
  // 看板块只带路径 —— 分组列 / 显示列是展示设置,不是文本。
  if (block.type === "kanban") return block.path
  // 布局块把格子里的块递归拼起来 —— 字数统计因此覆盖容器内的内容。
  if (block.type === "layout") {
    return block.cells.map((cell) => cell.map((item) => blockText(item)).join(" ")).join(" ")
  }
  if (block.type === "table") {
    return block.rows.map((row) => row.map((cell) => runsText(cell.runs)).join(" ")).join("\n")
  }
  return runsText(block.runs)
}

/** 字数统计口径：去掉所有空白后的字符数（与原型一致）。 */
export function countChars(blocks: readonly Block[]): number {
  return blocks.reduce((total, block) => total + blockText(block).replace(/\s/g, "").length, 0)
}

/**
 * 有序列表块的显示序号，键是块 id。
 *
 * 规则与 `serialize.ts` 的分组**逐条对齐** —— 序号只在同一个 `<ol>` 元素内部递增，
 * 所以凡是会让导出结果新起一个 `<ol>` 的情形都要重新从 1 数：
 *
 * - 被非列表块隔开（中间夹段落、引用、表格…）；
 * - 回到同一层时类型变了（`ol → ul → ol` 会被拆成两个 `<ol>`）；
 * - 更深一层有自己的计数器，回到浅层时接着原来的数（`1. a / 1.1 / 2. b`）。
 *
 * 后两条镜像 `buildLevels` 的「同层 kind 相同才复用当前层」。两边一旦漂移，
 * 编辑器里的序号就会与导出文件里浏览器渲染出来的对不上。
 */
export function orderedIndexes(blocks: readonly Block[]): Map<string, number> {
  const map = new Map<string, number>()

  /** 每个深度上当前打开的那一层：归属类型 + 已数到的值。整段列表被非列表块打断时清空。 */
  const levels: { kind: ListBlockType; count: number }[] = []

  for (const block of blocks) {
    if (!isListBlock(block)) {
      levels.length = 0
      continue
    }

    // 越级的 depth 夹到「最多比当前深一层」，与 buildLevels 的夹取口径一致。
    const depth = Math.min(block.depth, levels.length)
    const open = depth < levels.length ? levels[depth] : undefined

    if (open !== undefined && open.kind === block.type) {
      open.count += 1
      levels.length = depth + 1
    } else {
      levels.length = depth
      levels.push({ kind: block.type, count: 1 })
    }

    if (block.type === "ol") {
      const current = levels[depth]
      if (current !== undefined) map.set(block.id, current.count)
    }
  }

  return map
}
