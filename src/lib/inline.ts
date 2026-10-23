import type { InlineMark, InlineRun, LinkShape } from "@/types/workspace"

/**
 * 行内内容的纯字符串层（不碰 DOM）。
 *
 * DOM 侧的采集在 `@/lib/html/runs-dom`；这里只做「runs → HTML 字符串」和规范化，
 * 两个方向共用同一份标记注册表，序列化产物才是稳定的。
 */

/**
 * 行内标记注册表 —— 标记知识的唯一真源。
 *
 * 一个标记有五件相关的事：**序列化标签**、解析时额外认的**别名标签**、**嵌套顺序**、
 * **快捷键**、给按钮用的**名字**。它们以前分散在四个模块里（本文件两处、`runs-dom.ts`
 * 的反查表、`marks.ts` 的快捷键、`InlineToolbar.vue` 的按钮列表），加一个标记要改四处
 * 且顺序要靠记 —— 现在全部从这张表派生。
 *
 * **数组顺序即 `INLINE_MARK_ORDER`**（由外到内）：序列化时按它包裹、归一化时按它排序，
 * 顺序影响产物，所以不能交给调用方，只能由这张表定死。
 */
export interface MarkSpec {
  mark: InlineMark
  /** 序列化时用的标签。 */
  tag: string
  /** 解析时也认作同一标记的别名标签（`<b>` 与 `<strong>` 等价之类）。 */
  aliases?: readonly string[]
  /** 键盘快捷键。`key` 是 `KeyboardEvent.key.toLowerCase()`。 */
  shortcut?: { key: string; shift?: boolean }
  /** 格式条上的名字。/ 没有即不出按钮。 */
  label?: string
}

export const MARK_REGISTRY = [
  { mark: "bold", tag: "strong", aliases: ["b"], shortcut: { key: "b" }, label: "加粗" },
  { mark: "italic", tag: "em", aliases: ["i"] },
  { mark: "underline", tag: "u", aliases: ["ins"], shortcut: { key: "u" }, label: "下划线" },
  { mark: "strike", tag: "s", aliases: ["del", "strike"], label: "删除线" },
  { mark: "code", tag: "code", shortcut: { key: "e" }, label: "行内代码" },
  // 高亮挂 Shift：`Cmd+H` 在 macOS 被系统占用（隐藏窗口）。
  { mark: "highlight", tag: "mark", shortcut: { key: "h", shift: true }, label: "高亮" },
] satisfies readonly MarkSpec[]

/**
 * 序列化时的固定嵌套顺序，由外到内。
 *
 * 它同时是 `marks` 数组的排序依据：解析出来的标记集合一样、来源顺序不同时，
 * 归一化后必须得到同一个数组，否则往返比对会因顺序差异假报不等。
 */
export const INLINE_MARK_ORDER: readonly InlineMark[] = MARK_REGISTRY.map((spec) => spec.mark)

/** 标记 → 序列化标签。 */
const MARK_TAG = new Map<InlineMark, string>(MARK_REGISTRY.map((spec) => [spec.mark, spec.tag]))

/** 标签（含别名）→ 标记。`runs-dom.ts` 采集 DOM 时用它反查。 */
export const TAG_MARKS = new Map<string, InlineMark>(
  MARK_REGISTRY.flatMap((spec) => [
    [spec.tag.toUpperCase(), spec.mark] as const,
    ...(spec.aliases ?? []).map((alias) => [alias.toUpperCase(), spec.mark] as const),
  ]),
)

/** 纯文本 → runs（单个无标记 run）。空串得到空数组，与 normalizeRuns 的约定一致。 */
export function textToRuns(text: string): InlineRun[] {
  return text === "" ? [] : [{ text, marks: [] }]
}

/**
 * 文本色盘 —— 颜色知识的唯一真源。
 *
 * 色板按钮、激活态比对、解析时的落盘值、导出文件的深色规则都从这里出。只收
 * **命名色**：解析到的 `color:` 值不在色盘里时按默认色丢弃 —— 色值一多，
 * 「解析 → 序列化 → 再解析」的归一化就稳不住（`red` 与 `#ff0000` 同色不同串）。
 *
 * `value` 是**浅色外观下的真值**，也是落盘值（盘上 HTML 得脱离样式表也有颜色）。
 * `dark` 只给两处生成式消费者用：编辑器样式的镜像（`style.css` 的 `--run-color-*`，
 * theme-check 核对）与导出文件的 `@media (prefers-color-scheme: dark)`。
 *
 * 取值不是 Notion 原值：原值里黄 2.75:1、橙 3.28:1、红 4.26:1，铺在白底正文上读不出，
 * 灰/棕/绿/蓝/紫/粉也只是刚好卡在 4.5 线上。两套都保 Notion 的色相、只动明度：
 * 浅色压到白底 ≥4.6，深色提到卡片底 #171717 上 ≥4.5。
 */
export const TEXT_COLORS: readonly { name: string; value: string; dark: string }[] = [
  { name: "默认", value: "", dark: "" },
  { name: "灰色", value: "#767572", dark: "#82817e" },
  { name: "棕色", value: "#9c6951", dark: "#aa755d" },
  { name: "橙色", value: "#b45d02", dark: "#d9730d" },
  { name: "黄色", value: "#9e6b02", dark: "#cb912f" },
  { name: "绿色", value: "#42815f", dark: "#4f8e6b" },
  { name: "蓝色", value: "#307ca6", dark: "#3f89b4" },
  { name: "紫色", value: "#8e63ae", dark: "#9b70bc" },
  { name: "粉色", value: "#bf4a88", dark: "#cd5795" },
  { name: "红色", value: "#cd4541", dark: "#dc544e" },
]

/** 色值在色盘里的位置（1 起，与 CSS 的 `[data-run-color="n"]` 对齐）。默认色与色盘外的值都是 0。 */
export function textColorSlot(value: string): number {
  const index = TEXT_COLORS.findIndex((item) => item.value === value.toLowerCase())
  return index > 0 ? index : 0
}

/**
 * 旧色盘值 → 现值。
 *
 * 色值按对比度重定过一轮，盘上的文件里还留着旧值。读到就折算成新值：老笔记打开
 * 不掉色，保存一次即完成迁移。**别名只增不改** —— 删掉一条，对应的老笔记就会掉色。
 */
const TEXT_COLOR_ALIASES: ReadonlyMap<string, string> = new Map([
  ["#787774", "#767572"],
  ["#9f6b53", "#9c6951"],
  ["#d9730d", "#b45d02"],
  ["#cb912f", "#9e6b02"],
  ["#448361", "#42815f"],
  ["#337ea9", "#307ca6"],
  ["#9065b0", "#8e63ae"],
  ["#c14c8a", "#bf4a88"],
  ["#d44c47", "#cd4541"],
])

/** 把落盘值折到当前色盘上：旧值按别名表迁移，其余原样返回（由调用方用 isTextColor 校验）。 */
export function normalizeTextColor(value: string): string {
  return TEXT_COLOR_ALIASES.get(value) ?? value
}

/** 色盘值集合，解析时校验用。 */
const TEXT_COLOR_VALUES = new Set(TEXT_COLORS.map((item) => item.value))

/** 色值是否在色盘内。空串（默认色）恒真。 */
export function isTextColor(value: string): boolean {
  return TEXT_COLOR_VALUES.has(value.toLowerCase())
}

/** runs → 纯文本投影。`\n` 是 `<br>` 的语义，原样保留。 */
export function runsText(runs: readonly InlineRun[]): string {
  return runs.map((run) => run.text).join("")
}

/** 转义 HTML 特殊字符。只转义不换行 —— 换行是否变 `<br>` 由调用方决定。 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/**
 * 正文文本 → HTML 片段。
 *
 * 换行必须落成 `<br>`：块正文里的 `\n` 就是软换行的语义，只写 `\n` 的话，
 * 编辑器里靠 `white-space: pre-wrap` 还能看见，文件用浏览器直接打开就成了空格。
 * 顺序必须是「先转义再替换」—— 反过来的话 `<br>` 会被自己转义掉。
 */
export function escapeTextToHtml(text: string): string {
  return escapeHtml(text).replace(/\n/g, "<br>")
}

/** 去重并按 `INLINE_MARK_ORDER` 排序。 */
function sortMarks(marks: readonly InlineMark[]): InlineMark[] {
  const seen = new Set(marks)
  return INLINE_MARK_ORDER.filter((mark) => seen.has(mark))
}

/** 两个 run 的格式是否相同（文本之外的部分）。 */
function sameFormat(run: InlineRun, marks: readonly InlineMark[], href: string | undefined, shape: LinkShape | undefined, color: string | undefined): boolean {
  if ((run.href ?? "") !== (href ?? "")) return false
  if ((run.linkShape ?? "text") !== (shape ?? "text")) return false
  if ((run.color ?? "") !== (color ?? "")) return false
  if (run.marks.length !== marks.length) return false
  return run.marks.every((mark, index) => mark === marks[index])
}

/**
 * 合并相邻同格式 run、丢弃空文本 run、统一标记顺序。
 *
 * 解析、编辑回读、序列化前的入口都要过一遍。少了它，「解析 → 序列化 → 再解析」
 * 会因为 `a<strong>b</strong>` 这类碎片拆法不同而得不到同一份数据。
 */
export function normalizeRuns(runs: readonly InlineRun[]): InlineRun[] {
  const result: InlineRun[] = []
  let previous: InlineRun | null = null

  for (const run of runs) {
    if (run.text === "") continue
    const marks = sortMarks(run.marks)
    if (previous !== null && sameFormat(previous, marks, run.href, run.linkShape, run.color)) {
      previous.text += run.text
      continue
    }
    const next: InlineRun = { text: run.text, marks }
    if (run.href !== undefined && run.href !== "") next.href = run.href
    // 形态跟着链接走：没有 href 的形态是非法态（与「link 标记却没地址」同一条立场）。
    if (next.href !== undefined && run.linkShape !== undefined && run.linkShape !== "text") {
      next.linkShape = run.linkShape
    }
    // 颜色与链接同一立场：空串按默认色处理，缺省态不落盘。
    if (run.color !== undefined && run.color !== "") next.color = run.color
    result.push(next)
    previous = next
  }

  return result
}

/**
 * 掐掉首个 run 的前导空白与末个 run 的尾随空白。
 *
 * 只给解析静态 HTML 用：源码里的缩进换行在浏览器里不占位置，不该进正文。
 * 读 contenteditable 时不能调 —— 用户敲的空格是有意义的。
 */
export function trimRuns(runs: readonly InlineRun[]): InlineRun[] {
  const result = runs.map((run) => ({ ...run, marks: [...run.marks], text: run.text }))
  if (result.length === 0) return result

  const first = result[0]
  const last = result[result.length - 1]
  first.text = first.text.replace(/^\s+/, "")
  last.text = last.text.replace(/\s+$/, "")

  return result.filter((run) => run.text !== "")
}

/**
 * 书签卡片的图标字符：取站点域名的首字母。
 *
 * 图标是 href 的**派生**而非存储：盘上只写派生结果（`data-icon`），读回时不认它 ——
 * 避免手改文件后「图标与地址」两份事实漂移。解析不出域名（相对路径、垃圾串）时
 * 退回地址首字符，再不行就是问号。
 */
export function linkIcon(href: string): string {
  const source = (() => {
    try {
      return new URL(href).host
    } catch {
      return href
    }
  })()
  const first = source.trim().charAt(0)
  return first === "" ? "?" : first.toUpperCase()
}

/**
 * 书签卡片的副标题：站点域名（去掉 `www.`）。
 *
 * 与 `linkIcon` 同一立场 —— 域名是地址的派生，盘上不存第二份事实。解析不出域名
 * （相对路径、垃圾串）时原样返回地址，让用户至少能看出指向哪儿；空地址落空串，
 * 由视图决定不画这一行。
 */
export function linkDomain(href: string): string {
  const text = href.trim()
  if (text === "") return ""
  try {
    return new URL(text).hostname.replace(/^www\./, "")
  } catch {
    return text
  }
}

/** 单个 run → HTML 片段。 */
export function runToHtml(run: InlineRun): string {
  let html = escapeTextToHtml(run.text)

  // 反向遍历：先包的留在内层，最终嵌套顺序与 INLINE_MARK_ORDER 一致。
  for (let index = INLINE_MARK_ORDER.length - 1; index >= 0; index -= 1) {
    const mark = INLINE_MARK_ORDER[index]
    if (!run.marks.includes(mark)) continue
    const tag = MARK_TAG.get(mark)
    if (tag === undefined) continue
    html = `<${tag}>${html}</${tag}>`
  }

  // 颜色套在标记外面：色值是整段文字的属性，与加粗等语义标记不在一个层级。
  // 只写色盘内的值，序列化产物稳定（见 TEXT_COLORS）。
  // `data-run-color` 是给深色外观用的下标（见 style.css）：inline style 压不过
  // 换肤规则，只能靠 `!important` 的 `[data-run-color]` 选择器接手；同时它让
  // 「这段是第几号色」不必从 hex 反推。
  if (run.color !== undefined && isTextColor(run.color) && run.color !== "") {
    html = `<span data-run-color="${textColorSlot(run.color)}" style="color: ${run.color}">${html}</span>`
  }

  // 链接永远是最外层：`<a>` 里套 `<code>` 合法，反过来在语义上也说得通但更难读。
  // 卡片形态的属性只写非默认值：图标字符是伪元素的内容源（见 linkIcon），DOM 里
  // 不占节点，读回时 textContent 不受污染。
  if (run.href !== undefined && run.href !== "") {
    let attributes = ` href="${escapeHtml(run.href)}"`
    if (run.linkShape === "card") {
      attributes += ` data-link-shape="card" data-icon="${escapeHtml(linkIcon(run.href))}"`
    }
    html = `<a${attributes}>${html}</a>`
  }

  return html
}

/** runs → HTML 片段。 */
export function runsToHtml(runs: readonly InlineRun[]): string {
  return runs.map(runToHtml).join("")
}

/**
 * 深拷 runs。
 *
 * 不能浅拷：`marks` 是数组，浅拷会让两份块共享同一个 marks —— 在那里加一个加粗，
 * 另一处也跟着变。表格 / 图片块的克隆、表格几何操作都走这里。
 */
export function cloneRuns(runs: readonly InlineRun[]): InlineRun[] {
  return runs.map((run) => ({ ...run, marks: [...run.marks] }))
}
