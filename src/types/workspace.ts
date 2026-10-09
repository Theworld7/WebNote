/**
 * 工作区领域模型。
 *
 * 三条约定：
 *
 * 1. **类型标识符只有一个真源**。菜单项、marker、`/` 转换菜单全部从 `BLOCK_TYPES`
 *    （见 `@/lib/blocks`）派生，避免原型阶段出现过的「类型定义 / CSS / 菜单三处标识符
 *    不一致」问题。
 * 2. **`Block` 是四形态可辨识联合**，`type` 同时充当判别式：`image` / `table` / `mermaid`
 *    各自独占自己的字段，其余十三种走 `TextualBlock`。判别式让编译器兜住穷尽性，因此
 *    全项目不需要一处类型断言。
 * 3. **正文是 `InlineRun[]` 而不是字符串**。解析静态 HTML 必须装得下行内标记
 *    （加粗 / 链接 / 行内代码），一旦只存纯文本，解析结果的信息量就被截断了。
 *    需要纯文本时用 `runsText()` / `blockText()` 投影，不要再另存一份字符串字段 ——
 *    两份表达同一内容必然漂移。
 */

/** 行内标记。链接不在此列 —— 它由 `InlineRun.href` 表达，避免「有 link 标记却没地址」的非法态。 */
export type InlineMark = "bold" | "highlight" | "italic" | "underline" | "strike" | "code"

/**
 * 块内一段连续文本及其生效的行内标记。
 *
 * 规范化不变式（由 `normalizeRuns()` 保证，解析与编辑回读都必须过一遍）：
 * - `text` 非空；
 * - `marks` 已去重，且按 `INLINE_MARK_ORDER` 排序 —— 顺序影响序列化产物，所以不能留给调用方；
 * - 相邻 run 的「标记 + href」必然不同，否则已合并。
 */
export interface InlineRun {
  text: string
  marks: InlineMark[]
  /** 有值即为链接（解析自 `<a href>`）。空串按无链接处理。 */
  href?: string
}

/** 可承载正文的块类型。`divider` 也在内 —— 它只是正文恒为空。 */
export type TextualBlockType =
  | "text"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "todo"
  | "ul"
  | "ol"
  | "quote"
  | "code"
  | "callout"
  | "divider"

/** 全部块类型 = 正文类 + 三个结构类。派生而非常量列表，避免两处维护。 */
export type BlockType = TextualBlockType | "image" | "table" | "mermaid"

/** 正文块。块之间是平铺列表；列表的嵌套层级用 `depth` 表达，不建树。 */
export interface TextualBlock {
  id: string
  type: TextualBlockType
  runs: InlineRun[]
  /** 列表 / 待办的缩进层级，0 起。其它类型恒为 0。 */
  depth: number
  /** 仅 `todo` 使用。 */
  checked?: boolean
  /** 仅 `code` 使用：语言标识，序列化成 `<code class="language-x">`。 */
  lang?: string
}

/** 图片块。`src` 可以是磁盘相对路径，也可以是 data URI。 */
export interface ImageBlock {
  id: string
  type: "image"
  src: string
  alt: string
  title: string
}

/** 单元格水平对齐。取值只有三档，UI 与序列化都按这三档走。 */
export type TableAlign = "left" | "center" | "right"

/** 表格单元格。`header` 对应 `<th>`。 */
export interface TableCell {
  header: boolean
  runs: InlineRun[]
  /**
   * 水平对齐。**缺省即 `left`**，且左对齐不落存储（解析、设置都把它归成「未设置」）——
   * 三处口径必须一致：模型里没有 `"left"`、序列化不为它写 `style`、导出靠 DOC_STYLE
   * 里 `th, td { text-align: left }` 兜默认。
   */
  align?: TableAlign
}

/** 表格块。单元格按 `rows[行][列]` 索引；整表是一个原子块，不拆成多块。 */
export interface TableBlock {
  id: string
  type: "table"
  rows: TableCell[][]
}

/**
 * Mermaid 图块。
 *
 * 源码是**纯字符串**而不是 `InlineRun[]`。两个原因：`*` `_` `-` `#` 在 mermaid 里是
 * 语法字符，走 runs 会被行内标记解析吃掉；而且图源码永远不需要加粗 / 链接这类富文本。
 * 这也是它与 `code` 块的分别 —— 那边承载的是可被行内格式化的正文。
 */
export interface MermaidBlock {
  id: string
  type: "mermaid"
  /** mermaid 源码，原样保存（含换行与缩进）。 */
  source: string
}

export type Block = TextualBlock | ImageBlock | TableBlock | MermaidBlock

/** 块类型元数据：菜单标记 + 中文名。菜单渲染直接消费。 */
export interface BlockTypeMeta {
  type: BlockType
  /** 菜单左侧的等宽字符标记，替代图标 SVG。 */
  marker: string
  label: string
}

/** 文件树的节点。folder 才有 children。 */
export interface FileNode {
  id: string
  name: string
  kind: "folder" | "file"
  children?: FileNode[]
}

/** 已打开的标签页。path 是唯一键，形如 `日记 / 2026-10-08.html`。 */
export interface OpenTab {
  path: string
  dirty: boolean
}

/** 面包屑的一段。最后一段是文件名。 */
export interface Crumb {
  name: string
  isFile: boolean
}

/** 块左侧手柄的菜单打开状态。空串表示两个菜单都关着。 */
export type BlockMenuKind = "" | "type" | "action"

/** 拖拽排序时块的落点标记：指示线画在块的上沿还是下沿。`none` 表示不参与。 */
export type BlockDropEdge = "none" | "before" | "after"

/** 关闭脏标签时用户的选择。 */
export type CloseStrategy = "save" | "discard"
