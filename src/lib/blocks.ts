import type {
  Block,
  BlockType,
  BlockTypeMeta,
  ImageBlock,
  InlineRun,
  MermaidBlock,
  TableBlock,
  TableCell,
  TextualBlock,
  TextualBlockType,
} from "@/types/workspace"
import { cloneRuns, runsText, textToRuns } from "@/lib/inline"

/**
 * 块类型登记表 —— 类型标识符的唯一真源。
 *
 * `satisfies` 只做校验、不改推断类型：写错或改名某个 type 会在这里报错，
 * 而菜单、marker、序列化都从这张表派生，不存在第二处需要同步的清单。
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
] satisfies readonly BlockTypeMeta[]

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
 * **新增结构类块（不承载 runs 的形态）时，这里必须跟着补一条 `!==`** ——
 * 漏了不会报错，只会把新块当成正文块，`runs` 处取到 `undefined` 然后静默崩在别处。
 */
export function isTextualBlock(block: Block): block is TextualBlock {
  return block.type !== "image" && block.type !== "table" && block.type !== "mermaid"
}

/** 块是否自带左侧标记（列表符号 / 复选框）。 */
export function hasLeadingMarker(type: BlockType): boolean {
  return isListType(type) || type === "todo"
}

/** 内容区是否需要为左侧标记让出缩进。 */
export function bodyHasMarkerIndent(type: BlockType): boolean {
  return hasLeadingMarker(type)
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

/** 按类型造块。`text` 会被包成单个无标记 run —— 组件层新建块走这条，不必手搓 runs。 */
export function createBlock(type: BlockType, text = ""): Block {
  if (type === "image") return createImageBlock()
  if (type === "table") return createTableBlock()
  if (type === "mermaid") return createMermaidBlock()
  return createTextualBlock(type, textToRuns(text))
}

/**
 * 块类型切换。
 *
 * 内容一并清空 —— 与原型行为一致，而且必须这么做：切换时 DOM 会被清掉，
 * 数据若不同步清空，切走标签再切回来又会把旧内容渲染出来（`/` 触发转换时尤其明显）。
 */
export function retypeBlock(block: Block, type: BlockType): Block {
  if (type === "image" || type === "table" || type === "mermaid") return createBlock(type)
  if (!isTextualBlock(block)) return createTextualBlock(type)
  return createTextualBlock(type, [], { depth: block.depth, checked: block.checked })
}

/**
 * 深拷一个块并指定 id。
 *
 * 浅拷（`{ ...block }`）在旧模型下够用，现在不够 —— `runs` / `rows` 都是数组，
 * 浅拷会让两份块共享同一批 run 对象，改一处动两处。id 由调用方给：
 * 拷进工作区状态时沿用原 id，「复制块」时换成新的。
 *
 * `source` 是字符串，图片块那种平坦形态浅拷即可。
 */
export function cloneBlock(block: Block, id: string): Block {
  if (block.type === "image" || block.type === "mermaid") return { ...block, id }
  if (block.type === "table") {
    const rows = block.rows.map((row) => row.map((cell) => ({ header: cell.header, runs: cloneRuns(cell.runs) })))
    return { ...block, id, rows }
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
