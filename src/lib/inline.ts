import type { InlineMark, InlineRun } from "@/types/workspace"

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
  { mark: "underline", tag: "u", aliases: ["ins"] },
  { mark: "strike", tag: "s", aliases: ["del", "strike"] },
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
function sameFormat(run: InlineRun, marks: readonly InlineMark[], href: string | undefined): boolean {
  if ((run.href ?? "") !== (href ?? "")) return false
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
    if (previous !== null && sameFormat(previous, marks, run.href)) {
      previous.text += run.text
      continue
    }
    const next: InlineRun = { text: run.text, marks }
    if (run.href !== undefined && run.href !== "") next.href = run.href
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

  // 链接永远是最外层：`<a>` 里套 `<code>` 合法，反过来在语义上也说得通但更难读。
  if (run.href !== undefined && run.href !== "") {
    html = `<a href="${escapeHtml(run.href)}">${html}</a>`
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
