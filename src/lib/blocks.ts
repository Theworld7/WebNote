import type {
  Block,
  BlockType,
  BlockTypeMeta,
  BookmarkBlock,
  ChatBlock,
  ChatMessage,
  DataTableBlock,
  GalleryBlock,
  HtmlBlock,
  ImageBlock,
  InlineRun,
  KanbanBlock,
  LayoutBlock,
  LayoutMode,
  LedgerBlock,
  LedgerGroupMode,
  LedgerSortDirection,
  MermaidBlock,
  StatBlock,
  SubscriptionBlock,
  TableBlock,
  TableCell,
  TextualBlock,
  TextualBlockType,
} from "@/types/workspace"
import type { SubscriptionRole } from "@/lib/subscription"
import { cloneRuns, runsText, textToRuns } from "@/lib/inline"
import { cloneCell } from "@/lib/table"

/**
 * 菜单分组的名字清单。`group` 字段的取值由此收口 —— 写错组名会当场编译报错,
 * 不会悄悄多出一个没人认识的分组。组的展示顺序即本清单顺序,但菜单实际按
 * 登记表条目的相邻关系切段,同组的条目必须写在一起。
 */
const MENU_GROUPS = ["基础", "列表", "内容", "媒体与数据", "版面"] as const
type MenuGroup = (typeof MENU_GROUPS)[number]

/**
 * 块类型登记表 —— 类型标识符的唯一真源。
 *
 * `satisfies` 只做校验、不改推断类型：写错或改名某个 type 会在这里报错，
 * 而菜单、marker、序列化都从这张表派生，不存在第二处需要同步的清单。
 *
 * 登记表的**完备性**由下面的 `assertRegistryComplete` 在编译期保证 ——
 * 新增一个块类型却忘了登记，会当场编译报错（`satisfies` 本身查不出漏登记）。
 */
/**
 * 登记表条目的校验形状:`group` 用 `MenuGroup` 而不是 `string` —— 组名写错
 * (或新造一个不在 MENU_GROUPS 里的组)会当场编译报错。
 */
type BlockTypeMenuEntry = BlockTypeMeta & { group: MenuGroup }

export const BLOCK_TYPES = [
  { type: "text", group: "基础", marker: "¶", label: "文本", initials: "wb" },
  { type: "h1", group: "基础", marker: "H1", label: "标题 1", initials: "bt1" },
  { type: "h2", group: "基础", marker: "H2", label: "标题 2", initials: "bt2" },
  { type: "h3", group: "基础", marker: "H3", label: "标题 3", initials: "bt3" },
  { type: "h4", group: "基础", marker: "H4", label: "标题 4", initials: "bt4" },
  { type: "h5", group: "基础", marker: "H5", label: "标题 5", initials: "bt5" },
  { type: "h6", group: "基础", marker: "H6", label: "标题 6", initials: "bt6" },
  { type: "todo", group: "列表", marker: "[ ]", label: "待办列表", initials: "dbl" },
  { type: "ul", group: "列表", marker: "•", label: "无序列表", initials: "wxl" },
  { type: "ol", group: "列表", marker: "1.", label: "有序列表", initials: "yxl" },
  { type: "quote", group: "内容", marker: '"', label: "引用", initials: "yy" },
  { type: "code", group: "内容", marker: "</>", label: "代码块", initials: "dmk" },
  // 紧挨 code：mermaid 的心智来源就是「用代码块写图」，摆一起最容易找。
  { type: "mermaid", group: "内容", marker: "◇", label: "Mermaid 图", initials: "mermaidt" },
  // 紧挨 mermaid：HTML 块的心智来源同为「写一段源码」，只是源码直接渲染成内容。
  { type: "html", group: "内容", marker: "<>", label: "HTML", initials: "html" },
  { type: "callout", group: "内容", marker: "!", label: "标注", initials: "bz" },
  { type: "divider", group: "内容", marker: "—", label: "分割线", initials: "fgx" },
  { type: "image", group: "媒体与数据", marker: "▧", label: "图片", initials: "tp" },
  { type: "table", group: "媒体与数据", marker: "⊞", label: "表格", initials: "bg" },
  // 紧挨 table：数据表在用户眼里就是「更正式的表格」，摆一起最容易找。
  { type: "datatable", group: "媒体与数据", marker: "▤", label: "数据表", initials: "sjb" },
  // 紧挨 datatable：画册展示的就是数据表的数据，只是换了一身衣服。
  { type: "gallery", group: "媒体与数据", marker: "▦", label: "画册", initials: "hc" },
  // 紧挨 gallery：书签块同样吃数据表的数据，渲染成链接卡片宫格。
  { type: "bookmark", group: "媒体与数据", marker: "⚑", label: "书签", initials: "sq" },
  // 紧挨 bookmark：看板块同样吃数据表的数据,按某列分组铺成几列,卡片可拖拽改值。
  { type: "kanban", group: "媒体与数据", marker: "☰", label: "看板", initials: "kb" },
  // 紧挨 kanban：账目块同样吃数据表的数据,按财务口径渲染成流水账(收入/支出/余额/小计)。
  { type: "ledger", group: "媒体与数据", marker: "¥", label: "账目", initials: "zm" },
  // 紧挨 ledger：统计块同样吃数据表的数据,把某列的数值求和成一个大数字。
  { type: "stat", group: "媒体与数据", marker: "Σ", label: "统计", initials: "tj" },
  // 紧挨 stat：订阅块同样吃数据表的数据,把每行渲染成一张订阅卡并汇总月 / 年支出。
  { type: "subscription", group: "媒体与数据", marker: "↻", label: "订阅", initials: "dy" },
  // 紧挨 kanban 之后、布局压轴之前:聊天记录是内容块,不是版面级重结构。
  { type: "chat", group: "媒体与数据", marker: "◌", label: "聊天记录", initials: "ltjl" },
  // 压轴：容器块是「版面级」的重结构,跟在内容块族的最后。
  { type: "layout", group: "版面", marker: "⬚", label: "布局", initials: "bj" },
] satisfies readonly BlockTypeMenuEntry[]

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

/**
 * 按检索词筛块类型，登记表顺序返回 —— `/` 菜单里敲 `dmk` 就只剩代码块。
 *
 * 前缀匹配、忽略大小写，与中文输入法的「简拼」同一个口径：敲 `d` 列出代码块与待办列表，
 * 敲 `dm` 收窄到代码块。空检索词即全部（滤掉 `exclude` 的那几种）。
 *
 * 菜单渲染与 Enter 落块都走这一处：两边的可见项必须一致 —— 否则「只剩一项」时
 * Enter 落下的块可能根本不在眼前那张清单里。
 */
export function blockTypeOptions(query: string, exclude?: readonly BlockType[]): BlockTypeMeta[] {
  const wanted = query.trim().toLowerCase()
  return BLOCK_TYPES.filter(
    (meta) => exclude?.includes(meta.type) !== true && (wanted === "" || meta.initials.startsWith(wanted)),
  )
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
    block.type !== "ledger" &&
    block.type !== "stat" &&
    block.type !== "subscription" &&
    block.type !== "chat" &&
    block.type !== "layout" &&
    block.type !== "html"
  )
}

/**
 * 引用块族：带 `path` 指针、指向一张 `.tbl` 的结构块 —— 数据是别人的（ADR-0005）。
 *
 * 「哪些块带 path」只在这里说一次：保存前的 preload 收集、布局格子的插入过滤都从
 * 这张表派生。serialize / parse 各自的读写分派虽仍逐块列出（编译器靠穷尽性兜住），
 * 但**凡是凭「有没有 path」区分的行为**都必须走这张表，不再各持一份会腐烂的清单。
 */
export const REFERENCE_BLOCK_TYPES = ["datatable", "gallery", "bookmark", "kanban", "ledger", "stat", "subscription"] as const
export type ReferenceBlockType = (typeof REFERENCE_BLOCK_TYPES)[number]

/** 是否是引用块。命中时收窄到四种带 `path` 的结构块。 */
export function isReferenceBlock(block: Block): block is Extract<Block, { path: string }> {
  return REFERENCE_BLOCK_TYPES.some((type) => block.type === type)
}

/**
 * 收集块列表（含布局格子内）引用的全部 `.tbl` 路径，去重保序。
 *
 * 保存前的 preload 用它：先把引用到的表读进内存，serialize 才能同步取值拼快照。
 * 这份知识只此一份 —— 它曾经在 App.vue 里是一行手写的 type filter，
 * gallery / bookmark 就是从那份拷贝里漏掉的（快照被写成空的现行 bug）。
 * 布局格子要递归：serialize 那边对格子同样递归 lookup，两边口径必须一致。
 */
export function refPathsOf(blocks: readonly Block[]): string[] {
  const paths: string[] = []
  const seen = new Set<string>()
  const visit = (list: readonly Block[]): void => {
    for (const block of list) {
      if (block.type === "layout") {
        for (const cell of block.cells) visit(cell)
        continue
      }
      if (!isReferenceBlock(block)) continue
      if (block.path === "" || seen.has(block.path)) continue
      seen.add(block.path)
      paths.push(block.path)
    }
  }
  visit(blocks)
  return paths
}

/**
 * 格子内插入/转换菜单要滤掉的类型：容器块本身（一层容器）与大部分引用块。
 *
 * stat 是唯一的例外：它可以空指针创建（`createStatBlock()` 不带 path），落进格子后
 * 由视图的「设置」菜单补指向，不需要顶层的选表对话框 —— 所以放行。其余引用块
 * （数据表/画册/书签/看板/账目）要「先有文件才能指」，那条异步分流都长在顶层
 * 编辑器上，格子内不值得为此再铺一条路。名单从 `REFERENCE_BLOCK_TYPES` 派生，
 * 不另立清单；`moveBlockIntoCell`（拖块进格子）用同一份名单把关。
 */
export const CELL_EXCLUDED_TYPES: readonly BlockType[] = [
  "layout",
  ...REFERENCE_BLOCK_TYPES.filter((type) => type !== "stat"),
]

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

/** 造自定义 HTML 块。缺省空原文 = 尚未编写，视图直接摊开编辑区。 */
export function createHtmlBlock(source = ""): HtmlBlock {
  return { id: createBlockId(), type: "html", source }
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
 * 造账目块。缺省不设收入 / 支出列、不分组、不排序 —— 视图显示提示态引导去设置;
 * 新建路径(`useWorkspace.insertLedgerBlock`)会按预置列把收入 / 支出指好、并按
 * 「日期列 + 倒序」起手,开箱即录。
 * 带全参数的调用来自解析器 —— 盘上属性宽容读取后的值在这里收口成合法类型。
 * `showBalance` 缺省 true;`groupMode` 传 month / column 时必须带 `groupColumnId`;
 * `sortColumnId` 空串即不排序(方向此时无意义,留着不影响往返)。
 */
export function createLedgerBlock(
  path = "",
  incomeColumnId = "",
  expenseColumnId = "",
  showBalance = true,
  groupMode: LedgerGroupMode = "none",
  groupColumnId = "",
  sortColumnId = "",
  sortDirection: LedgerSortDirection = "desc",
): LedgerBlock {
  const block: LedgerBlock = {
    id: createBlockId(),
    type: "ledger",
    path,
    incomeColumnId,
    expenseColumnId,
    showBalance,
    groupMode,
    groupColumnId,
    sortColumnId,
    sortDirection,
  }
  if (groupMode === "none") block.groupColumnId = ""
  return block
}

/** 造聊天记录块。缺省空消息列表 = 空白记录，视图给出「添加消息」入口。 */
export function createChatBlock(messages: ChatMessage[] = []): ChatBlock {
  return { id: createBlockId(), type: "chat", messages }
}

/** 造统计块。缺省不指列 —— 视图显示提示态引导去设置;解析器带全参数调用在此收口。 */
export function createStatBlock(path = "", columnId = ""): StatBlock {
  return { id: createBlockId(), type: "stat", path, columnId }
}

/**
 * 造订阅块。字段映射缺省全空 = 按列名与类型自动识别 —— 参考表插进来即可用。
 * 新建路径会带上预设表的列 id(列名再改也不影响);已有表则留空走识别。
 */
export function createSubscriptionBlock(
  path = "",
  roles: Partial<Record<SubscriptionRole, string>> = {},
): SubscriptionBlock {
  return {
    id: createBlockId(),
    type: "subscription",
    path,
    nameColumnId: roles.name ?? "",
    iconColumnId: roles.icon ?? "",
    amountColumnId: roles.amount ?? "",
    cycleColumnId: roles.cycle ?? "",
    autoRenewColumnId: roles.autoRenew ?? "",
    trialEndColumnId: roles.trialEnd ?? "",
    startColumnId: roles.start ?? "",
    endColumnId: roles.end ?? "",
    cancelledColumnId: roles.cancelled ?? "",
    paidColumnId: roles.paid ?? "",
  }
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
  if (type === "ledger") return createLedgerBlock()
  if (type === "stat") return createStatBlock()
  if (type === "subscription") return createSubscriptionBlock()
  if (type === "chat") return createChatBlock()
  if (type === "layout") return createLayoutBlock()
  if (type === "html") return createHtmlBlock()
  return createTextualBlock(type, textToRuns(text))
}

/**
 * 块类型切换 —— 内容尽可能跟着走。
 *
 * - 正文族之间:`runs` 原样带过去,换标题 / 待办 / 引用不该丢字(缩进与勾选态同程保留)。
 * - 转成 mermaid:内容压成纯文本收进源码 —— mermaid 的心智来源就是「用代码块写图」。
 * - 结构块转回正文:取纯文本投影,字至少还在。
 * - 转成其余结构块(图片 / 表格 / 聊天 / 布局):目标形态没有正文的自然落点,只能空着起步。
 *   DOM 层的配套在 BlockItem:类型变化时按新 `runs` 重画正文,不再无脑清空。
 */
export function retypeBlock(block: Block, type: BlockType): Block {
  if (type === "mermaid" || type === "html") {
    // 两个「源码即内容」的块：转换时把纯文本投影收进源码 —— 字至少还在，
    // 心智也一致（都从「写一段源码」开始）。
    const source = isTextualBlock(block) ? runsText(block.runs) : blockText(block)
    return type === "mermaid" ? { ...createMermaidBlock(), source } : { ...createHtmlBlock(), source }
  }
  if (type === "image" || type === "table" || type === "datatable" || type === "gallery" || type === "bookmark" || type === "kanban" || type === "ledger" || type === "stat" || type === "subscription" || type === "chat" || type === "layout") {
    return createBlock(type)
  }
  if (!isTextualBlock(block)) return createTextualBlock(type, textToRuns(blockText(block)))
  return createTextualBlock(type, cloneRuns(block.runs), { depth: block.depth, checked: block.checked })
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
  // 平坦形态浅拷即可：账目块与数据表 / 书签 / 统计一样全是原始值字段。
  if (block.type === "image" || block.type === "mermaid" || block.type === "html" || block.type === "datatable" || block.type === "bookmark" || block.type === "ledger" || block.type === "stat" || block.type === "subscription") {
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
  // 聊天记录的消息是对象数组：拷贝不得共享同一批消息对象。
  if (block.type === "chat") {
    return { ...block, id, messages: block.messages.map((message) => ({ ...message })) }
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
  // HTML 块取原文 —— 标记字符跟着进投影，与 mermaid 的图源码同一立场：
  // 原文就是这块的全部内容，投影不再另作解析（那需要 DOM，字数统计是同步纯函数）。
  if (block.type === "html") return block.source
  // 引用块只带路径 —— 表格内容不在笔记里，投影拿不到它，也不该为此去读盘
  // （字数统计是同步的纯函数）。取路径是这里唯一诚实的选择。
  if (block.type === "datatable") return block.path
  // 画册同样只带路径 —— 设置（列数、填充、字段显隐）不是文本，不进投影。
  if (block.type === "gallery") return block.path
  // 书签块只带路径 —— 名称列 / 链接列 / 列数是展示设置，不是文本。
  if (block.type === "bookmark") return block.path
  // 看板块只带路径 —— 分组列 / 显示列是展示设置,不是文本。
  if (block.type === "kanban") return block.path
  // 账目块只带路径 —— 收入 / 支出列与分组是财务展示设置,不是文本。
  if (block.type === "ledger") return block.path
  // 统计块只带路径 —— 求和列是展示设置,不是文本。
  if (block.type === "stat") return block.path
  // 订阅块只带路径 —— 字段映射是展示设置,不是文本。
  if (block.type === "subscription") return block.path
  // 布局块把格子里的块递归拼起来 —— 字数统计因此覆盖容器内的内容。
  if (block.type === "layout") {
    return block.cells.map((cell) => cell.map((item) => blockText(item)).join(" ")).join(" ")
  }
  // 聊天记录把每条消息拼起来 —— 字数统计因此覆盖整段对话。
  if (block.type === "chat") {
    return block.messages.map((message) => message.text).join("\n")
  }
  if (block.type === "table") {
    return block.rows.map((row) => row.map((cell) => runsText(cell.runs)).join(" ")).join("\n")
  }
  return runsText(block.runs)
}

/**
 * 表格块的 TSV 投影:格间 `\t`、行间 `\n`,粘进 Excel 按网格落格。
 *
 * 单元格内的制表符与换行会把一格拉成多格多行,统一压成空格 —— 保住网格优先于保住
 * 单元格内的排版。与 `blockText` 的空格拼接并存而不合并:字数统计要的是连续文本,
 * 剪贴板要的是网格,两种投影口径不同。
 */
export function tableToTsv(rows: readonly (readonly TableCell[])[]): string {
  return rows
    .map((row) => row.map((cell) => runsText(cell.runs).replace(/[\t\n\r]+/g, " ")).join("\t"))
    .join("\n")
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
