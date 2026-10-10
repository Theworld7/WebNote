import type { BlockType, TableEffect } from "@/types/workspace"

/**
 * 排版规格 —— 视觉常量的唯一真源。
 *
 * 同一套规格有两个消费者，它们必须永远一致，否则会出现「编辑器里看着挺好、
 * 双击打开全变了」：
 *
 * - **编辑器侧**（`BlockItem.vue` / `TableBlockView.vue`）：把这里派生的类名挂到 DOM 上；
 * - **导出侧**（`serialize.ts` 的 `DOC_STYLE`）：把这里派生的 CSS 写进单文件。
 *
 * 所以这个模块只放「数字和由数字派生的字符串」，不放任何组件逻辑。数值口径全部取自
 * Naive UI Typography（naive-ui v2 源码）：
 *
 * - `_styles/common/_common.ts`：fontSize `14px`、lineHeight `1.6`、fontWeightStrong `500`
 * - `typography/styles/_common.ts`：headerFontSize1~6 = `30/22/18/16/16/16px`；
 *   headerMargin1~3 = `28px 0 20px 0`，headerMargin4~6 = `28px 0 18px 0`；pMargin = `16px 0`
 * - `blockquote.cssr.ts` / `hr.cssr.ts`：margin 都是 `12px 0`
 *
 * 验收在 `design/typography-check.html`：它挂真实编辑器、量实际渲染的几何，并对
 * 导出文件重跑同一批断言。改动这里的数字会让那页亮红 —— 那是有意为之。
 */

/** 正文字号，px。 */
export const BODY_FONT_SIZE = 14

/** 全局行高倍率。标题不单独设行高，继承它（naive 的 header.cssr 也是如此）。 */
export const LINE_HEIGHT = 1.6

/** 六级标题的字号，索引 0 对应 h1。 */
export const HEADING_FONT_SIZES = [30, 22, 18, 16, 16, 16] as const

/** 标题字重（naive headerFontWeight）。 */
export const HEADING_FONT_WEIGHT = 500

/** 正文行盒高度：列表标记与复选框都靠它竖直居中。 */
export const BODY_LINE_BOX = BODY_FONT_SIZE * LINE_HEIGHT

/** 手柄按钮边长，与 `BlockToolbar` 的 `TOOL` 类（`size-6`）对应。 */
export const HANDLE_SIZE = 24

/** 表格外框圆角，px。导出侧对应 `--radius-table`。 */
export const TABLE_RADIUS = 8

/** 列表 / 待办的每级缩进，px。 */
export const LIST_INDENT = 22

/**
 * 表格外框里与宽度无关的那半截：圆角、边框、格线、四角内弧。
 *
 * 单独抽出来是因为「表格效果」这个设置要换掉的只有**宽度策略**（`w-full` ↔ `w-max`），
 * 外框几何两种效果下一模一样。让它们共享这一份，改圆角时不会只改到一边。
 * 键在下面的 `TABLE_FRAME_CLASS` 与 `TABLE_*` 两套效果类名里各拼一次。
 */
const FRAME_TAIL = [
  "rounded-[8px] border border-line border-separate border-spacing-0",
  "[&_tr:last-child>*]:border-b-0 [&_tr>*:last-child]:border-r-0",
  "[&_tr:first-child>*:first-child]:rounded-tl-[7px] [&_tr:first-child>*:last-child]:rounded-tr-[7px]",
  "[&_tr:last-child>*:first-child]:rounded-bl-[7px] [&_tr:last-child>*:last-child]:rounded-br-[7px]",
].join(" ")

/**
 * 表格外框的类名（`wrap` 效果的那一份，也是规范形态）。
 *
 * **必须是字面量**：Tailwind 只生成源码里能完整看到的候选，`rounded-[${n}px]` 这类
 * 插值在**生产构建**下扫不到（dev 模式的宽松扫描会让人误以为没问题 —— 构建后
 * 圆角直接变 0，`table-align-check` 在 dev 下也照样全绿）。代价是这里的 `8px` / `7px`
 * 与 `TABLE_RADIUS` 是两份，靠下面的 `frameRadius` 在编译期钉住。
 *
 * `border-collapse: collapse` 下浏览器会忽略 `border-radius`（计算值有、渲染出来是直角），
 * 所以外框与圆角交给 `<table>`（`border-separate` + `border-spacing: 0` 保证相邻格之间
 * 没有缝），格子只留右/下内线；末行末列去掉，否则会与外框贴成 2px。四角格子再各设一档
 * 内弧（外弧减掉 1px 边框），表头底色才跟着弧线走 —— `<table>` 的 `overflow: hidden`
 * 在部分内核上对表格不生效，不指望它裁。
 */
export const TABLE_FRAME_CLASS = `w-full ${FRAME_TAIL}`

/**
 * 编译期守卫：类名里写死的外弧值必须与 `TABLE_RADIUS` 一致。
 *
 * `TABLE_FRAME_CLASS` 是 `string`（`Array.join` 的结果），类型系统看不见里面的数字，
 * 所以从它反推不可行。改成把那份字面量**同时**声明为类型：`FrameRadius` 必须是
 * `"8"`（即 `TABLE_RADIUS` 的字符串形式）—— 改 `TABLE_RADIUS` 而忘了改类名会在这里报错。
 */
const frameRadius: `${typeof TABLE_RADIUS}` = "8"
void frameRadius

/**
 * 表格效果的两种渲染方式 —— 编辑器侧的查看偏好，**不进导出文件**。
 *
 * 导出侧（`docStyle()`）永远用 `table { width: 100% }` 那份规范形态：单文件笔记要能
 * 被单独拷走双击打开，读不到 `localStorage`，把偏好写进文件反而会让「同一个文件在
 * 两台机器上长得不一样」，「往返一致」这条不变量先碎。所以这里的分叉只存在于编辑器，
 * 设置面板里也明说了这件事。
 *
 * 与 `SPACING_CLASS` / `HEADING_CLASS` 同样的理由要求**字面量**：Tailwind 扫的是源码里
 * 能完整看到的候选，运行时拼的 `whitespace-${x}` 一条规则都不会生成。
 */

/** 表格外层容器：`wrap` 与正文同宽；`scroll` 横向滚动。 */
export interface TableEffectClasses {
  /** 套在 `<table>` 外面的容器。 */
  container: string
  /** `<table>` 自身。 */
  table: string
  /** 单元格（`<th>` / `<td>`）。 */
  cell: string
}

/**
 * `wrap`：文字换行、列被挤窄、表格永远与正文同宽 —— 也就是这个设置存在之前的行为。
 *
 * 容器空字符串：不额外包一层，几何与从前完全一致。`min-w-16` 是格子下限，
 * `break-words` 保证长串（URL、英文单词）也会折断，否则它会把列撑破、等于偷偷变回滚动。
 */
const TABLE_WRAP: TableEffectClasses = {
  container: "",
  table: `w-full ${FRAME_TAIL}`,
  cell: "min-w-16 whitespace-pre-wrap break-words",
}

/**
 * `scroll` 容器为滚动条留的下内边距，**Tailwind 步进单位**（1 = 4px）。
 *
 * 存步进而不是像素：这个值最终要落成 `pb-N` 类名，而 Tailwind 只认源码里能完整看到的
 * 字面量。存步进就能用 `` `pb-${typeof X}` `` 把类名钉成类型（见下面的守卫）；
 * 存像素的话 `8 ≠ "2"`，类型对不上也推不出类名，守卫就只剩注释了。
 */
export const TABLE_SCROLL_GUTTER_STEP = 2

/** 上者的像素值，给探针与断言量几何用。 */
export const TABLE_SCROLL_GUTTER = TABLE_SCROLL_GUTTER_STEP * 4

/**
 * `scroll`：文字不换行，表格按内容撑开，超出正文宽度的部分横向滚动。
 *
 * 五点缺一不可：
 * - 容器 `overflow-x-auto`：真正的滚动条挂在它身上，不是 `<table>`。
 * - `<table>` 从 `w-full` 换成 `w-max`：`w-full` 会被容器宽（= 正文宽）钉死，
 *   内容再宽也只会溢出格子；`w-max` 才让表格按内容要宽度，从而产生可滚动量。
 *   同时补 `min-w-full`：列少的时候表格仍至少铺满一行宽，否则会缩成一小坨。
 * - 格子 `whitespace-nowrap`：不换行，列宽才由内容决定。
 *   `break-words` 要去掉，它和 `nowrap` 同时存在时前者会赢在折行上、`nowrap` 形同虚设。
 * - 容器另带 `table-scrollbar`（见 `style.css`）：把系统那条 15px 的粗滚动条换成
 *   6px 圆角细条。原生观感太重，一进视野就把注意力全吸走 —— 表格本身才是主体。
 * - 容器 `pb-2`（= 8px）：把滚动条从表格底边推开。不加的话滚动条紧贴外框、还会切进
 *   那 8px 圆角里。间距取与外框圆角同档的值，看起来才是一体的。
 *
 * 「右边还有内容」那条内阴影不在这里：它是压在表格**上面**的一层覆盖元素，
 * 由 `TableBlockView` 挂（类名 `table-scroll-shadow` 见 `style.css`），
 * 因为容器背景会被 `th` 底色盖住。它的底边同样要避开这段 padding，见那边的注释。
 */
const TABLE_SCROLL: TableEffectClasses = {
  container: "overflow-x-auto table-scrollbar pb-2",
  table: `w-max min-w-full ${FRAME_TAIL}`,
  cell: "min-w-16 whitespace-nowrap",
}

/**
 * 编译期守卫：`TABLE_SCROLL.container` 与内阴影各自写死的类名，必须与步进常量一致。
 *
 * 与 `frameRadius` 同一手法 —— Tailwind 的 `pb-N` / `bottom-N` 里 N 就是步进值，类型可由
 * 常量直接拼出。改常量为 `3` 而忘了同步类名，两行的字符串字面量就对不上类型而当场报错。
 *
 * 刻意**不**去解析 `TABLE_SCROLL.container` 反推 —— 它是 `string`，类型系统看不见里面的
 * 字面量（`FRAME_TAIL` 注释里说过同一件事）。
 *
 * **覆盖不到的第三处**：`TableBlockView` 模板里那个 `bottom-2`（阴影元素）。模板 class
 * 是普通字符串，类型系统管不着。改步进常量时除了这里，还得手动同步模板，
 * `settings-check` 的「阴影底边避开滚动条」用例会在运行时兜住。
 */
const gutterClass: `pb-${typeof TABLE_SCROLL_GUTTER_STEP}` = "pb-2"
const shadowInsetClass: `bottom-${typeof TABLE_SCROLL_GUTTER_STEP}` = "bottom-2"
void gutterClass
void shadowInsetClass

/** 按偏好取表格类名。两种效果的类名都在上面写死，这里只做分派。 */
export function tableEffectClasses(effect: TableEffect): TableEffectClasses {
  return effect === "scroll" ? TABLE_SCROLL : TABLE_WRAP
}

/**
 * 块间距 —— 上 / 下外边距，px。
 *
 * 必须用 margin 而不是 padding：naive 的「上 28 下 20」是不对称的，相邻块之间的最终
 * 距离由浏览器**折叠**决定（取较大值）。padding 可加，拼不出这种按邻居变化的节奏：
 * 正文挨正文要 16、正文挨标题要 28、标题挨正文又要 20。
 *
 * 代价：块根节点不能有任何垂直 padding，否则折叠被阻断 —— 编辑器侧 `blockClass`
 * 一条 `py-*` 都没有。
 */
export interface BlockSpacing {
  top: number
  bottom: number
}

/** 各类型块的外边距。键缺省即 `DEFAULT_SPACING`。 */
export const BLOCK_SPACING: Readonly<Record<BlockType, BlockSpacing>> = {
  h1: { top: 28, bottom: 20 },
  h2: { top: 28, bottom: 20 },
  h3: { top: 28, bottom: 20 },
  h4: { top: 28, bottom: 18 },
  h5: { top: 28, bottom: 18 },
  h6: { top: 28, bottom: 18 },
  quote: { top: 12, bottom: 12 },
  divider: { top: 12, bottom: 12 },
  text: { top: 16, bottom: 16 },
  todo: { top: 16, bottom: 16 },
  ul: { top: 16, bottom: 16 },
  ol: { top: 16, bottom: 16 },
  code: { top: 16, bottom: 16 },
  callout: { top: 16, bottom: 16 },
  image: { top: 16, bottom: 16 },
  table: { top: 16, bottom: 16 },
  mermaid: { top: 16, bottom: 16 },
}

// ───────────────────────────── 编辑器侧适配器 ─────────────────────────────

/**
 * 外边距类名表。
 *
 * **必须是字面量**：Tailwind 在构建时扫源码抽取类名，运行时的 `` `mt-[${n}px]` ``
 * 拼不出任何候选、整条规则不会生成（表现是间距全变 0）。所以这里逐个写死，
 * 下面 `spacingClass()` 再用 `BLOCK_SPACING` 的数值反查 —— 数值改错、或这里的
 * 类名与数值对不上，`spacingClass()` 会立刻抛错，不会静默失效。
 *
 * 键是 `"上/下"` 的 px 值。
 */
const SPACING_CLASS: Readonly<Record<string, string>> = {
  "28/20": "mt-[28px] mb-[20px]",
  "28/18": "mt-[28px] mb-[18px]",
  "16/16": "my-4",
  "12/12": "my-3",
}

/**
 * 块根节点的外边距类。
 *
 * 走 `my-4` / `my-3` 这类命名类而不是等价任意值时，值会藏在 Tailwind 配置里；
 * 但这里两者都写死了，`BLOCK_SPACING` 只负责**校验** —— 数值与类名对不上就抛错，
 * 改规格时两边一起改，漏一边会当场炸。
 */
export function spacingClass(type: BlockType): string {
  const { top, bottom } = BLOCK_SPACING[type]
  const key = `${top}/${bottom}`
  const cls = SPACING_CLASS[key]
  if (cls === undefined) {
    throw new Error(
      `块 ${type} 的间距 ${key} 没有对应的 Tailwind 类名 —— 请同步补进 SPACING_CLASS`,
    )
  }
  return cls
}

/**
 * 标题类名表。字面量理由同 `SPACING_CLASS`：运行时拼接的 `text-[${size}px]`
 * Tailwind 扫不到。
 */
const HEADING_CLASS: Readonly<Record<number, string>> = {
  30: "text-[30px] font-medium leading-[1.6] text-foreground/90",
  22: "text-[22px] font-medium leading-[1.6] text-foreground/90",
  18: "text-[18px] font-medium leading-[1.6] text-foreground/90",
  16: "text-[16px] font-medium leading-[1.6] text-foreground/90",
}

/** 标题 / 引用这类需要按类型区分的正文类名；非标题返回 null。 */
export function headingClass(type: BlockType): string | null {
  switch (type) {
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const size = HEADING_FONT_SIZES[Number(type.slice(1)) - 1]
      const cls = HEADING_CLASS[size]
      if (cls === undefined) {
        throw new Error(`标题 ${type} 的字号 ${size}px 没有对应的 Tailwind 类名 —— 请同步补进 HEADING_CLASS`)
      }
      return cls
    }
    default:
      return null
  }
}

/**
 * 块首行文字的中线相对块根节点上沿的位置（px）—— 手柄靠它竖直居中。
 *
 * 块根节点没有垂直 padding，所以中线就是「半个行盒」；卡片类块（code / callout）
 * 自带 `py-2.5`，得把 10px 上内边距补回来。
 */
export function firstLineCenter(type: BlockType): number {
  switch (type) {
    case "h1":
      return (HEADING_FONT_SIZES[0] * LINE_HEIGHT) / 2
    case "h2":
      return (HEADING_FONT_SIZES[1] * LINE_HEIGHT) / 2
    case "h3":
      return (HEADING_FONT_SIZES[2] * LINE_HEIGHT) / 2
    case "h4":
    case "h5":
    case "h6":
      return (HEADING_FONT_SIZES[3] * LINE_HEIGHT) / 2
    case "code":
      return 10 + (12.5 * 1.7) / 2
    case "callout":
      return 10 + (BODY_FONT_SIZE * LINE_HEIGHT) / 2
    // 分割线只有 1px 高，手柄中心压在线上。
    case "divider":
      return 0.5
    // 图片 / 表格 / mermaid 图没有文字行，手柄贴顶（留 2px 视觉余量）。
    case "image":
    case "table":
    case "mermaid":
      return HANDLE_SIZE / 2 + 2
    default:
      // text / todo / ul / ol / quote：正文 14px × 1.6。
      return BODY_LINE_BOX / 2
  }
}

/** 列表标记 13px / 1.6 行高，竖直居中于正文首行。 */
export const MARKER_TOP = `${(BODY_LINE_BOX / 2 - (13 * LINE_HEIGHT) / 2).toFixed(1)}px`

/** 复选框 14px 见方，同样居中于正文首行。 */
export const CHECKBOX_TOP = `${(BODY_LINE_BOX / 2 - BODY_FONT_SIZE / 2).toFixed(1)}px`

/** 正文的字号行高与字色（naive pFontSize / pLineHeight / pTextColor）。字面量理由同上。 */
export const BODY_TEXT_CLASS = "text-sm leading-[1.6] text-foreground/90"

/** 缩进用 margin-left 而不是 padding-left：手柄是绝对定位，padding 推不动它。 */
export function indentStyle(depth: number): string {
  const clamped = Math.min(depth, 6)
  return clamped === 0 ? "0px" : `${clamped * LIST_INDENT}px`
}

// ───────────────────────────── 导出侧适配器 ─────────────────────────────

/**
 * 单文件笔记的自包含样式。
 *
 * 笔记文件要能直接双击在浏览器里看，所以样式内联、不引外部 css —— 引用同级 css 的话，
 * 文件被单独拷走就没样式了。
 *
 * `color-scheme` 必须写在 `:root` 的声明块里：裸放在样式表顶层不是合法规则，
 * 解析器会把它和紧随的 `:root {}` 当成一条选择器去解析、两条一起丢掉 ——
 * 表现是浅色模式下所有变量都取不到值（引用块、表头全没底色）。
 *
 * 表格外框与圆角也在这套「两边同一值」的约定里：`collapse` 下浏览器忽略
 * `border-radius`，所以外框由 `<table>` 自己画、格子只留右/下内线，四角格子再各设
 * 一档内弧（外弧减 1px 边框）。
 */
export function docStyle(): string {
  const headingRules = HEADING_FONT_SIZES.map(
    (size, index) => `    h${index + 1} { font-size: ${size}px; }`,
  ).join("\n")

  const h = BLOCK_SPACING.h1
  const hTail = BLOCK_SPACING.h4

  return `    :root { color-scheme: light dark; --fg: #1c1c1e; --muted: #6b7280; --line: #e4e4e7; --bg-soft: #f4f4f5; --accent-bg: #eef2ff; --accent-fg: #313d6b; --mark-bg: #fdf3b0; --radius-table: ${TABLE_RADIUS}px; }
    @media (prefers-color-scheme: dark) {
      :root { --fg: #e6e6e8; --muted: #9ca3af; --line: #33333a; --bg-soft: #1e1e22; --accent-bg: #232a45; --accent-fg: #c3ccff; --mark-bg: #4a4120; }
    }
    body { max-width: 46rem; margin: 0 auto; padding: 3rem 1.5rem 6rem; background: Canvas; color: var(--fg);
      font: ${BODY_FONT_SIZE}px/${LINE_HEIGHT} -apple-system, "PingFang SC", "Helvetica Neue", sans-serif; -webkit-font-smoothing: antialiased; }
    h1, h2, h3, h4, h5, h6 { margin: ${h.top}px 0 ${h.bottom}px; font-weight: ${HEADING_FONT_WEIGHT}; }
${headingRules}
    h4, h5, h6 { margin-bottom: ${hTail.bottom}px; }
    p { margin: ${BLOCK_SPACING.text.top}px 0; }
    ul, ol { margin: ${BLOCK_SPACING.ul.top}px 0; padding-left: 2em; }
    li { margin: 0.25em 0 0; }
    blockquote { margin: ${BLOCK_SPACING.quote.top}px 0; padding-left: 12px; border-left: 4px solid var(--line); }
    aside { margin: ${BLOCK_SPACING.callout.top}px 0; padding: 0.8em 1.1em; background: var(--accent-bg); border-radius: 0.6em; color: var(--accent-fg); }
    pre { margin: ${BLOCK_SPACING.code.top}px 0; padding: 0.9em 1.1em; background: var(--bg-soft); border-radius: 0.6em; overflow-x: auto; }
    code { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 0.9em; line-height: 1.4;
      display: inline-block; padding: 0.05em 0.35em 0; border-radius: 2px; background: var(--bg-soft); }
    pre code { font-size: 0.86em; display: inline; padding: 0; background: none; }
    hr { height: 1px; margin: ${BLOCK_SPACING.divider.top}px 0; border: 0; background: var(--line); }
    img { display: block; max-width: 100%; margin: ${BLOCK_SPACING.image.top}px 0; border-radius: 0.6em; }
    table { width: 100%; margin: ${BLOCK_SPACING.table.top}px 0; border-collapse: separate; border-spacing: 0;
      border: 1px solid var(--line); border-radius: var(--radius-table); }
    th, td { padding: 0.45em 0.7em; text-align: left; vertical-align: top;
      border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); }
    tr > *:last-child { border-right: 0; }
    table > *:last-child > tr:last-child > * { border-bottom: 0; }
    table > *:first-child > tr:first-child > *:first-child { border-top-left-radius: calc(var(--radius-table) - 1px); }
    table > *:first-child > tr:first-child > *:last-child { border-top-right-radius: calc(var(--radius-table) - 1px); }
    table > *:last-child > tr:last-child > *:first-child { border-bottom-left-radius: calc(var(--radius-table) - 1px); }
    table > *:last-child > tr:last-child > *:last-child { border-bottom-right-radius: calc(var(--radius-table) - 1px); }
    th { font-weight: 600; background: var(--bg-soft); }
    mark { background-color: var(--mark-bg); color: inherit; }
    body > :first-child { margin-top: 0; } body > :last-child { margin-bottom: 0; }`
}

